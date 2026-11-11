// Vercel serverless function: estimates the food and nutrition in a photo with Claude.
// The API key stays on the server (ANTHROPIC_API_KEY environment variable); the browser never sees it.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export const config = { maxDuration: 60 };

const MAX_IMAGE_BASE64 = 4_000_000;            // ~3 MB image; the app downsizes photos well below this
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const Estimate = z.object({
  is_food: z.boolean().describe('false when the photo shows no food or drink'),
  items: z.array(z.object({
    name: z.string().describe('Short common name, e.g. "Dal tadka" or "Roti"'),
    portion: z.string().describe('The amount visible, e.g. "2 medium rotis" or "1 katori (about 150 g)"'),
    grams: z.number().describe('Estimated weight of that amount in grams'),
    calories: z.number().describe('kcal for the amount visible'),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    fiber_g: z.number(),
    confidence: z.enum(['low', 'medium', 'high'])
  })),
  note: z.string().describe('One short sentence on the biggest uncertainty, or an empty string')
});

const SYSTEM = `You estimate the nutrition of a meal from one photo for a calorie-tracking app. The person will review your estimate before it is logged, so a realistic best estimate is more useful than a cautious range.

List each distinct food or drink in the photo as its own item. Judge the amount of each from visual cues such as the plate, bowl, cutlery or a hand, and give calories and macros for the amount actually visible, not per 100 g. Assume typical home or restaurant preparation for the cuisine shown, including the oil, ghee, butter or sugar that such dishes normally contain even when it cannot be seen. If the person adds a description, treat it as more reliable than the photo for what the food is and how much there is.

Set confidence to "low" when the dish is hard to identify or the amount is mostly hidden. Use the note for the single thing that would most change the numbers, such as hidden cooking fat or an unclear portion size. If the photo contains no food or drink, set is_food to false and return no items.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  // Only accept calls from this site's own pages, so other websites cannot spend the API key.
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* malformed Origin header */ }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Not allowed from this site.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ code: 'no_key', error: 'Photo recognition is not set up yet: add ANTHROPIC_API_KEY to the project’s environment variables and redeploy.' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  const { image, mediaType, hint } = body || {};
  if (typeof image !== 'string' || !image || !MEDIA_TYPES.includes(mediaType)) return res.status(400).json({ error: 'Send a JPEG, PNG or WebP photo.' });
  if (image.length > MAX_IMAGE_BASE64) return res.status(413).json({ error: 'That photo is too large.' });
  const description = typeof hint === 'string' ? hint.trim().slice(0, 300) : '';

  try {
    const client = new Anthropic();   // reads ANTHROPIC_API_KEY from the environment
    const message = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'low', format: betaZodOutputFormat(Estimate) },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: description ? `The person describes this meal as: ${description}` : 'Estimate the nutrition of this meal.' }
        ]
      }]
    });

    if (message.stop_reason === 'refusal') return res.status(422).json({ error: 'The AI could not analyse this photo. Try a different one.' });
    const out = message.parsed_output;
    if (!out) return res.status(502).json({ error: 'The AI returned an incomplete answer. Please try again.' });

    const n = v => Math.max(0, Math.round((Number(v) || 0) * 10) / 10);
    return res.status(200).json({
      isFood: out.is_food,
      note: out.note,
      items: out.is_food ? out.items.map(i => ({
        name: i.name, portion: i.portion, grams: Math.round(n(i.grams)), cal: Math.round(n(i.calories)),
        protein: n(i.protein_g), carbs: n(i.carbs_g), fat: n(i.fat_g), fiber: n(i.fiber_g), confidence: i.confidence
      })) : []
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return res.status(503).json({ code: 'bad_key', error: 'The ANTHROPIC_API_KEY on the server was rejected. Check it and redeploy.' });
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'The AI service is busy. Wait a moment and try again.' });
    if (err instanceof Anthropic.BadRequestError) { console.error(err); return res.status(400).json({ error: 'The AI service could not read that photo. Try another one.' }); }
    if (err instanceof Anthropic.APIConnectionError) return res.status(504).json({ error: 'Could not reach the AI service. Try again.' });
    if (err instanceof Anthropic.APIError) { console.error(err); return res.status(502).json({ error: 'The AI service returned an error. Try again shortly.' }); }
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong analysing the photo.' });
  }
}

function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
