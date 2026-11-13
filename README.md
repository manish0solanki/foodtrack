# FoodTrack

A mobile-first calorie, nutrition and weight-loss tracker. It is a static site (no build step, no server) that stores everything on your own device and works offline once opened.

## What it does

**Today**
- Calorie ring showing what is left (or how far over) against your daily target
- Protein, carbs, fat and fiber progress against personal targets
- A short coaching tip based on the day so far
- Water tracker in litres (250 ml per glass), with a daily goal based on body weight
- Step tracker: enter the day's steps, or upload a screenshot of your phone's health app and let AI read the count, to see calories burned walking, distance, progress to a step goal, and how much is extra beyond your usual activity (optionally add half of that to the day's food budget)
- Add food from a built-in list of about 530 foods: Indian dishes, sandwiches, wraps and continental food, with regional names (phulka, golgappa, puliyogare…), your recent foods, packaged foods from Open Food Facts, a barcode, or a custom entry
- Take or choose a photo of a meal and let AI estimate the foods, portions and calories; you review and correct before it is logged
- Choose the portion (servings or grams) and the meal (breakfast, lunch, dinner, snacks)
- Meal ideas that fit the calories you have left, for breakfast, lunch, dinner or snacks, filtered by your preferences: vegetarian / veg + egg / non-veg, things to avoid (dairy, wheat, nuts, seafood, red meat) and foods you dislike; one tap logs the whole idea
- Tap a logged item to edit it (name, amount, calories, macros, meal) or delete it
- Save any meal as a favourite (“My usual breakfast”) and log it again in one tap
- Move between days to review or fill in past days; copy yesterday's meals

**Progress**
- Weight log with trend chart, goal line, BMI and distance to goal
- Projected goal date, plus your actual weekly trend
- 14-day calorie chart against target, daily average, days on target and logging streak

**Plan**
- Personal calorie target from sex, age, height, weight, activity and chosen pace (Mifflin-St Jeor), with a safe minimum of 1200 / 1500 kcal
- Self-adjusting target: after about two weeks of logging and weigh-ins, the app measures what you really burn (calories eaten minus weight change × 7700 kcal/kg) and tunes the target from that; can be switched off
- The target adjusts automatically as your logged weight changes; you can also set a custom target
- Data stays on the device: the app asks the browser to protect it from automatic clean-up, shows when the last backup was made, and reminds you to save a backup file every two weeks
- Optional cloud backup: sign in with a MarketPulse account (Supabase Auth) and every change is copied to a private row a few seconds later; signing in on another device loads the data there
- Export / import a backup file, or erase all data

## Running it

Open `index.html` through any static web server (for example GitHub Pages), or locally:

```bash
python3 -m http.server 8000
```

Barcode scanning with the camera needs HTTPS and a browser with the BarcodeDetector API (Chrome on Android). Elsewhere, type the barcode number into the search box.

## AI photo recognition setup

The photo feature calls a Moonshot (Kimi) vision model from a small server function (`api/analyze.js`) so the API key never reaches the browser. It works on Vercel:

1. Create an API key at https://platform.moonshot.ai and make sure the account has credit.
2. In the Vercel project: Settings → Environment Variables → add `MOONSHOT_API_KEY` with that key.
3. Redeploy the project.

Optional variables: `MOONSHOT_MODEL` (default `kimi-k3`) and `MOONSHOT_BASE_URL` (default `https://api.moonshot.ai/v1`; keys from the China platform need `https://api.moonshot.cn/v1`).

Each photo analysed is billed to that key. The function only accepts requests from the site's own pages. Without the key, the rest of the app works and the photo screen says it is not set up.

## Files

- `index.html`, `style.css`, `app.js` — the app
- `foods.js` — built-in food list (approximate values per serving)
- `api/analyze.js`, `package.json` — serverless function for photo recognition
- `supabase/foodtrack_backups.sql` — the cloud backup table and its row-level security policies
- `sw.js`, `manifest.json`, `icon*.{svg,png}` — installable PWA / offline support

## Notes

- Nutrition values, AI photo estimates and calorie targets are estimates, not medical advice.
- Photos are sent to the server function for analysis and are not stored by the app.
