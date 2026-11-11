// Vercel serverless function: estimates the food and nutrition in a photo with a Moonshot (Kimi) vision model.
// The API key stays on the server (MOONSHOT_API_KEY environment variable); the browser never sees it.

export const config = { maxDuration: 60 };

const BASE_URL = (process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');  // use https://api.moonshot.cn/v1 for keys from the China platform
const MODEL = process.env.MOONSHOT_MODEL || 'kimi-k3';
const MAX_IMAGE_BASE64 = 4_000_000;            // ~3 MB image; the app downsizes photos well below this
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const SYSTEM = `You estimate the nutrition of a meal from one photo for a calorie-tracking app. The person will review your estimate before it is logged, so a realistic best estimate is more useful than a cautious range.

List each distinct food or drink in the photo as its own item. Judge the amount of each from visual cues such as the plate, bowl, cutlery or a hand, and give calories and macros for the amount actually visible, not per 100 g. Assume typical home or restaurant preparation for the cuisine shown, including the oil, ghee, butter or sugar that such dishes normally contain even when it cannot be seen. If the person adds a description, treat it as more reliable than the photo for what the food is and how much there is.

Reply with one JSON object and nothing else, in exactly this shape:
{"is_food": true, "items": [{"name": "Dal tadka", "portion": "1 katori (about 150 g)", "grams": 150, "calories": 150, "protein_g": 8, "carbs_g": 20, "fat_g": 4.5, "fiber_g": 5, "confidence": "medium"}], "note": ""}

"name" is a short common name. "portion" describes the amount visible in everyday terms. All numbers are for that amount. "confidence" is "low", "medium" or "high": use "low" when the dish is hard to identify or the amount is mostly hidden. "note" is one short sentence on the single thing that would most change the numbers, or an empty string. If the photo contains no food or drink, reply {"is_food": false, "items": [], "note": ""}.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  // Only accept calls from this site's own pages, so other websites cannot spend the API key.
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* malformed Origin header */ }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Not allowed from this site.' });
  }
  const key = process.env.MOONSHOT_API_KEY;
  if (!key) {
    return res.status(503).json({ code: 'no_key', error: 'Photo recognition is not set up yet: add MOONSHOT_API_KEY to the project’s environment variables and redeploy.' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  const { image, mediaType, hint } = body || {};
  if (typeof image !== 'string' || !image || !MEDIA_TYPES.includes(mediaType)) return res.status(400).json({ error: 'Send a JPEG, PNG or WebP photo.' });
  if (image.length > MAX_IMAGE_BASE64) return res.status(413).json({ error: 'That photo is too large.' });
  const description = typeof hint === 'string' ? hint.trim().slice(0, 300) : '';

  const request = {
    model: MODEL,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
        { type: 'text', text: description ? `The person describes this meal as: ${description}` : 'Estimate the nutrition of this meal.' }
      ] }
    ]
  };
  if (MODEL.startsWith('kimi-k3')) request.reasoning_effort = 'low';   // these models always reason; "low" keeps the wait short

  let upstream, payload;
  try {
    // The service occasionally answers 5xx; one retry clears most of those.
    for (let attempt = 1; ; attempt++) {
      upstream = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(attempt === 1 ? 35000 : 20000)
      });
      if (upstream.status < 500 || attempt === 2) break;
    }
    payload = safeJson(await upstream.text());
  } catch (err) {
    console.error(err);
    const slow = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return res.status(504).json({ error: slow ? 'The AI service took too long to answer. Try again.' : 'Could not reach the AI service. Try again.' });
  }

  if (!upstream.ok) {
    console.error('Moonshot error', upstream.status, JSON.stringify(payload)?.slice(0, 500));
    if (upstream.status === 401) return res.status(503).json({ code: 'bad_key', error: 'The MOONSHOT_API_KEY on the server was rejected. Check it and redeploy.' });
    if (upstream.status === 429) return res.status(429).json({ error: 'The AI service is busy or the account is out of credit. Try again in a moment.' });
    if (upstream.status === 400) return res.status(400).json({ error: 'The AI service could not read that photo. Try another one.' });
    return res.status(502).json({ error: 'The AI service returned an error. Try again shortly.' });
  }

  const out = extractJson(payload?.choices?.[0]?.message?.content);
  if (!out || typeof out.is_food !== 'boolean' || !Array.isArray(out.items)) {
    return res.status(502).json({ error: 'The AI returned an incomplete answer. Please try again.' });
  }

  const n = v => Math.max(0, Math.round((Number(v) || 0) * 10) / 10);
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const items = !out.is_food ? [] : out.items
    .filter(i => i && typeof i === 'object' && text(i.name, 80))
    .slice(0, 20)
    .map(i => ({
      name: text(i.name, 80), portion: text(i.portion, 80) || '1 serving', grams: Math.round(n(i.grams)), cal: Math.round(n(i.calories)),
      protein: n(i.protein_g), carbs: n(i.carbs_g), fat: n(i.fat_g), fiber: n(i.fiber_g),
      confidence: ['low', 'medium', 'high'].includes(i.confidence) ? i.confidence : 'medium'
    }));
  return res.status(200).json({ isFood: out.is_food && items.length > 0, note: text(out.note, 300), items });
}

function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
// Accepts a bare JSON object, or one wrapped in a code fence or surrounding prose.
function extractJson(content) {
  if (typeof content !== 'string') return null;
  const start = content.indexOf('{'), end = content.lastIndexOf('}');
  return start >= 0 && end > start ? safeJson(content.slice(start, end + 1)) : null;
}
