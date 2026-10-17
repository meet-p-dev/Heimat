-- Where each iPhone copy of the app was installed from, so "a new build is out" only goes
-- to the people who update through TestFlight.
--
-- Until now announce_app_update notified every 'apns:' device — fine while every copy came
-- from TestFlight, wrong from the App Store launch on: App Store users would be told to
-- "update it in TestFlight", which they don't have. The apps now say where they came from
-- when they save their device:
--   'testflight'  a TestFlight copy (updates come from TestFlight; the app announces them)
--   'appstore'    an App Store copy (the App Store updates it by itself — never told)
--   'development' run from Xcode
-- Builds from before this (all TestFlight) send nothing: null, and they keep hearing about
-- new builds. A value this database doesn't know yet is kept as null rather than refused,
-- so a newer app can never lose its notifications over it.
--
-- save_push_device gains p_source (last, optional). The old four-argument version is
-- dropped in the same transaction: two versions with defaults would make a call with two
-- arguments ambiguous. Every existing call (iPhone with two named arguments, the web and
-- Android with four) matches the new one.

alter table public.push_subscriptions
  add column if not exists install_source text
  check (install_source in ('testflight', 'appstore', 'development'));

drop function if exists public.save_push_device(text, text, text, text);

create or replace function public.save_push_device(
  p_endpoint text, p_platform text, p_p256dh text default null, p_auth text default null,
  p_source text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  src text := case when p_source in ('testflight', 'appstore', 'development') then p_source end;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_platform is null or p_platform not in ('web', 'ios', 'android') then
    raise exception 'Unknown kind of device' using errcode = '22023';
  end if;
  if p_endpoint is null then
    raise exception 'That device address doesn''t look right' using errcode = '22023';
  end if;

  if p_platform = 'ios' then
    -- a device token is 32 bytes today; Apple says it may grow, so allow up to 100 bytes
    if p_endpoint !~ '^apns(-dev)?:[0-9A-Fa-f]{64,200}$' then
      raise exception 'That device address doesn''t look right' using errcode = '22023';
    end if;
  elsif p_platform = 'android' then
    if left(p_endpoint, 4) <> 'fcm:' or char_length(p_endpoint) not between 5 and 4100 then
      raise exception 'That device address doesn''t look right' using errcode = '22023';
    end if;
  else
    if left(p_endpoint, 8) <> 'https://' or char_length(p_endpoint) > 2048 then
      raise exception 'That device address doesn''t look right' using errcode = '22023';
    end if;
    -- a browser can't read a notification without its two encryption keys
    if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
      raise exception 'A browser needs its notification keys' using errcode = '22023';
    end if;
  end if;

  -- the same phone moving from TestFlight to the App Store keeps its token: the newest
  -- save says where it comes from now
  insert into push_subscriptions (user_id, endpoint, platform, p256dh, auth, install_source, created_at)
  values (me, p_endpoint, p_platform, p_p256dh, p_auth, src, now())
  on conflict (endpoint) do update
    set user_id        = auth.uid(),
        platform       = excluded.platform,
        p256dh         = excluded.p256dh,
        auth           = excluded.auth,
        install_source = excluded.install_source,
        created_at     = now();
end;
$function$;

revoke all on function public.save_push_device(text, text, text, text, text) from public, anon;
grant execute on function public.save_push_device(text, text, text, text, text) to authenticated;
