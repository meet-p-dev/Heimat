-- Heimat and MoneyTrack are two separate products that happen to share one
-- Supabase project: one Postgres, one auth.users, one set of email templates.
-- That buys a single sign-in but leaves no record of WHICH app an account
-- belongs to, so neither app can tell "no account here yet" from "wrong
-- password", and neither has anywhere to keep a per-app profile.
--
-- app_users draws that line. One row per (account, app): membership, the name
-- that app shows, and a free-form prefs bag. The password stays shared — it
-- lives in auth.users and there is only one of those — but everything above it
-- is now per app.
create table if not exists public.app_users (
  user_id      uuid not null references auth.users(id) on delete cascade,
  app          text not null check (app in ('heimat', 'moneytrack')),
  display_name text,
  prefs        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, app)
);

create index if not exists app_users_app_idx on public.app_users (app);

alter table public.app_users enable row level security;

-- A row is readable and writable only by the account it describes. Nothing here
-- is shared between users, so there is no cross-user read path at all.
drop policy if exists app_users_own_select on public.app_users;
create policy app_users_own_select on public.app_users
  for select using (auth.uid() = user_id);

drop policy if exists app_users_own_insert on public.app_users;
create policy app_users_own_insert on public.app_users
  for insert with check (auth.uid() = user_id);

drop policy if exists app_users_own_update on public.app_users;
create policy app_users_own_update on public.app_users
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists app_users_own_delete on public.app_users;
create policy app_users_own_delete on public.app_users
  for delete using (auth.uid() = user_id);

-- Backfill from the data each app already has. Heimat accounts are the ones
-- that joined a flat; MoneyTrack accounts are the ones that reached the bank
-- half. Anonymous Heimat sessions are skipped — they are devices, not accounts.
insert into public.app_users (user_id, app)
select distinct m.user_id, 'heimat'
from public.flat_members m
join auth.users u on u.id = m.user_id
where u.email is not null
on conflict (user_id, app) do nothing;

insert into public.app_users (user_id, app)
select distinct p.user_id, 'moneytrack'
from public.mt_user_prefs p
on conflict (user_id, app) do nothing;

insert into public.app_users (user_id, app)
select distinct c.user_id, 'moneytrack'
from public.mt_bank_connections c
on conflict (user_id, app) do nothing;
