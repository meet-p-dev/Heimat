-- "A new update is available": testers hear about a new build and get to TestFlight in one tap.
--
-- When a build is ready for the testers, announce_app_update('ios', <build>) records it as
-- the latest one and sends every iPhone that has notifications on one notification; tapping
-- it opens TestFlight (the app reads the `url` the notification carries). Someone who missed
-- it still finds out: each time the app opens it asks app_update('ios', <its own build>), and
-- while a newer build is out Home shows an Update card that opens TestFlight too.
--
-- What is kept, in app_config (which the apps cannot read directly):
--   ios_latest_build  the newest build testers can install, e.g. '16'
--   ios_update_url    where Update goes — the public TestFlight link when there is one,
--                     otherwise 'itms-beta://', which opens the TestFlight app
--
-- Only the owner announces (from the dashboard or the SQL editor): announce_app_update is
-- not callable from the apps at all. app_update only ever answers those two values.

create or replace function public.app_update(p_platform text, p_build int)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_latest text;
  v_url text;
begin
  if p_platform is distinct from 'ios' or p_build is null then return null; end if;
  select value into v_latest from app_config where key = 'ios_latest_build' limit 1;
  select value into v_url    from app_config where key = 'ios_update_url'   limit 1;
  if v_latest is null or v_latest !~ '^[0-9]{1,9}$' or v_latest::int <= p_build then return null; end if;
  return jsonb_build_object('build', v_latest::int, 'url', coalesce(nullif(v_url, ''), 'itms-beta://'));
end;
$function$;

create or replace function public.announce_app_update(p_platform text, p_build int, p_url text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_platform is distinct from 'ios' then
    raise exception 'Only iPhone updates can be announced so far' using errcode = '22023';
  end if;
  if p_build is null or p_build < 1 then
    raise exception 'Which build?' using errcode = '22023';
  end if;
  -- only TestFlight (the app or one of its links), never any other address
  if p_url is not null and p_url !~ '^(itms-beta://.*|https://testflight\.apple\.com/.+)$' then
    raise exception 'That isn''t a TestFlight link' using errcode = '22023';
  end if;

  -- app_config has no unique key, so replace rather than upsert
  delete from app_config where key = 'ios_latest_build';
  insert into app_config (key, value) values ('ios_latest_build', p_build::text);
  if p_url is not null then
    delete from app_config where key = 'ios_update_url';
    insert into app_config (key, value) values ('ios_update_url', p_url);
  end if;

  perform push_notify(jsonb_build_object('event', 'app_update', 'platform', 'ios', 'build', p_build));
end;
$function$;

revoke all on function public.app_update(text, int)                from public;
grant execute on function public.app_update(text, int)             to anon, authenticated;
revoke all on function public.announce_app_update(text, int, text) from public, anon, authenticated;
