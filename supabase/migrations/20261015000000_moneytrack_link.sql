-- MoneyTrack ↔ Splitlife with two different logins.
--
-- MoneyTrack reads your Splitlife shares through splitlife_feed and my_pairwise, which answer
-- for whoever is signed in. Someone who uses one email for MoneyTrack and another for
-- Splitlife links the two once: MoneyTrack (signed in as A) asks for a one-time code, then
-- signs in to the Splitlife account (B) in the background and hands the code over as B. Only
-- someone who can sign in as both can make the link. After that, linked_splitlife_feed and
-- linked_pairwise answer for B when A asks — read-only, the same two summaries, nothing else.
-- Either side can unlink at any time. Splitlife's own functions are unchanged.

create table if not exists public.app_links (
  mt_user uuid primary key references auth.users(id) on delete cascade,
  sl_user uuid not null references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now(),
  check (mt_user <> sl_user)
);
alter table public.app_links enable row level security;
drop policy if exists app_links_own on public.app_links;
create policy app_links_own on public.app_links for select to authenticated
  using (mt_user = auth.uid() or sl_user = auth.uid());
revoke all on public.app_links from anon, authenticated;
grant select on public.app_links to authenticated;

-- one-time codes: never readable from outside, gone after use or ten minutes
create table if not exists public.app_link_codes (
  code text primary key,
  mt_user uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.app_link_codes enable row level security;
revoke all on public.app_link_codes from anon, authenticated;

-- step 1, signed in to MoneyTrack: a code to hand to the Splitlife account
create or replace function public.begin_splitlife_link()
returns text language plpgsql security definer set search_path to 'public'
as $$
declare me uuid := auth.uid(); v_code text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  delete from app_link_codes where mt_user = me or expires_at < now();
  v_code := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into app_link_codes (code, mt_user, expires_at) values (v_code, me, now() + interval '10 minutes');
  return v_code;
end; $$;

-- step 2, signed in to the Splitlife account: accept the code; MoneyTrack's account may now
-- read this account's Splitlife summaries
create or replace function public.confirm_splitlife_link(p_code text)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare me uuid := auth.uid(); v_mt uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  delete from app_link_codes where code = p_code and expires_at > now() returning mt_user into v_mt;
  if v_mt is null then raise exception 'That link request has expired — try again' using errcode = '22023'; end if;
  -- the same account in both apps needs no link
  if v_mt = me then delete from app_links where mt_user = me; return; end if;
  insert into app_links (mt_user, sl_user) values (v_mt, me)
  on conflict (mt_user) do update set sl_user = excluded.sl_user, linked_at = now();
end; $$;

-- either side ends it
create or replace function public.unlink_splitlife()
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from app_links where mt_user = auth.uid() or sl_user = auth.uid();
end; $$;

-- for MoneyTrack's Settings: which Splitlife account it reads (its email), if any
create or replace function public.splitlife_link()
returns table (email text, linked_at timestamptz)
language sql stable security definer set search_path to 'public'
as $$ select u.email::text, l.linked_at from app_links l join auth.users u on u.id = l.sl_user where l.mt_user = auth.uid() $$;

-- Ask the two summaries as the linked Splitlife account (or as yourself, unlinked). Who
-- "you" are is switched for this call only and put back before returning, so the summaries
-- themselves stay exactly the functions Splitlife uses.
create or replace function public.linked_splitlife_feed(p_from date default null)
returns table (kind text, id uuid, place uuid, place_name text, place_kind text, on_date date, description text,
               category text, currency text, amount numeric, my_share bigint, i_paid bigint, person uuid,
               person_name text, direction text)
language plpgsql security definer set search_path to 'public'
as $$
declare me uuid := auth.uid(); v_target uuid; v_claims text := current_setting('request.jwt.claims', true);
        v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if me is null then raise exception 'Not signed in'; end if;
  v_target := coalesce((select sl_user from app_links where mt_user = me), me);
  perform set_config('request.jwt.claims', jsonb_set(coalesce(nullif(v_claims, ''), '{}')::jsonb, '{sub}', to_jsonb(v_target::text))::text, true);
  perform set_config('request.jwt.claim.sub', v_target::text, true);
  return query select * from splitlife_feed(p_from);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
end; $$;

create or replace function public.linked_pairwise()
returns table (place uuid, place_name text, place_kind text, person uuid, person_name text, currency text, minor bigint)
language plpgsql security definer set search_path to 'public'
as $$
declare me uuid := auth.uid(); v_target uuid; v_claims text := current_setting('request.jwt.claims', true);
        v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if me is null then raise exception 'Not signed in'; end if;
  v_target := coalesce((select sl_user from app_links where mt_user = me), me);
  perform set_config('request.jwt.claims', jsonb_set(coalesce(nullif(v_claims, ''), '{}')::jsonb, '{sub}', to_jsonb(v_target::text))::text, true);
  perform set_config('request.jwt.claim.sub', v_target::text, true);
  return query select * from my_pairwise();
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
end; $$;

revoke execute on function public.begin_splitlife_link() from public, anon;
revoke execute on function public.confirm_splitlife_link(text) from public, anon;
revoke execute on function public.unlink_splitlife() from public, anon;
revoke execute on function public.splitlife_link() from public, anon;
revoke execute on function public.linked_splitlife_feed(date) from public, anon;
revoke execute on function public.linked_pairwise() from public, anon;
grant execute on function public.begin_splitlife_link() to authenticated;
grant execute on function public.confirm_splitlife_link(text) to authenticated;
grant execute on function public.unlink_splitlife() to authenticated;
grant execute on function public.splitlife_link() to authenticated;
grant execute on function public.linked_splitlife_feed(date) to authenticated;
grant execute on function public.linked_pairwise() to authenticated;
