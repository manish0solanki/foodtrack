-- Cloud backup table for FoodTrack (already applied to the Supabase project the app signs in to).
-- One private row per signed-in user; row-level security limits every operation to the owner.
create table public.foodtrack_backups (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.foodtrack_backups enable row level security;

revoke all on public.foodtrack_backups from anon;
grant select, insert, update, delete on public.foodtrack_backups to authenticated;

create policy "foodtrack: read own backup" on public.foodtrack_backups
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "foodtrack: create own backup" on public.foodtrack_backups
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "foodtrack: update own backup" on public.foodtrack_backups
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "foodtrack: delete own backup" on public.foodtrack_backups
  for delete to authenticated using ((select auth.uid()) = user_id);
