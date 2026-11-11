# FoodTrack

A mobile-first calorie, nutrition and weight-loss tracker. It is a static site (no build step, no server) that stores everything on your own device and works offline once opened.

## What it does

**Today**
- Calorie ring showing what is left (or how far over) against your daily target
- Protein, carbs, fat and fiber progress against personal targets
- A short coaching tip based on the day so far
- Water tracker (8 glasses)
- Add food from a built-in list of ~75 common foods (many Indian dishes), your recent foods, packaged foods from Open Food Facts, a barcode, or a custom entry
- Choose the portion (servings or grams) and the meal (breakfast, lunch, dinner, snacks)
- Move between days to review or fill in past days; copy yesterday's meals

**Progress**
- Weight log with trend chart, goal line, BMI and distance to goal
- Projected goal date, plus your actual weekly trend
- 14-day calorie chart against target, daily average, days on target and logging streak

**Plan**
- Personal calorie target from sex, age, height, weight, activity and chosen pace (Mifflin-St Jeor), with a safe minimum of 1200 / 1500 kcal
- The target adjusts automatically as your logged weight changes; you can also set a custom target
- Export / import a backup file, or erase all data

## Running it

Open `index.html` through any static web server (for example GitHub Pages), or locally:

```bash
python3 -m http.server 8000
```

Barcode scanning with the camera needs HTTPS and a browser with the BarcodeDetector API (Chrome on Android). Elsewhere, type the barcode number into the search box.

## Files

- `index.html`, `style.css`, `app.js` — the app
- `foods.js` — built-in food list (approximate values per serving)
- `sw.js`, `manifest.json`, `icon*.{svg,png}` — installable PWA / offline support

## Notes

- Nutrition values and calorie targets are estimates, not medical advice.
- Photo-based AI food recognition is not included: it needs a server-side vision model so that API keys stay off the device. It remains a possible next stage, along with sign-in and cloud sync.
