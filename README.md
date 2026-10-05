# FoodTrack

A mobile-first calorie, nutrition and weight-loss tracker.

## MVP
- Daily calorie target and remaining calories
- Protein, carbs, fat and fiber tracking
- Meal logging and deletion
- Weight tracking
- Open Food Facts packaged-food search
- Camera/photo upload UI
- PWA support
- Local-first storage

## Planned AI flow
Photo -> server-side vision model -> food detection -> portion estimate -> nutrition database -> user confirmation -> meal log.

Photo-based calories are estimates, not exact measurements. AI secrets will stay server-side.

## Next build stages
1. Supabase authentication and database
2. Indian-food nutrition database
3. AI image recognition
4. Portion confirmation/editing
5. Weight-loss planner and progress dashboard
6. Barcode scanning and better food search
