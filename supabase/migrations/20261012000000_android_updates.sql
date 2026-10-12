-- "A new update is available" on Android too (20261007000000_app_updates.sql did iPhone).
--
-- Android testers install the app from an APK the owner shares, so the update is a
-- download link rather than TestFlight. announce_app_update('android', <versionCode>,
-- '<https link to the APK>') records it as the latest one and sends every Android phone
-- that has notifications on one notification; tapping it opens the link. Each time the
-- app opens it asks app_update('android', <its own versionCode>), and while a newer one
-- is out Home shows an Update card that opens the link too.
--
-- Kept in app_config, next to the iPhone's two:
--   android_latest_build  the newest versionCode, e.g. '16'
--   android_update_url    where Update goes — an https link to the APK (required: there is
--                         no store to fall back on)
--
-- iPhone answers and checks exactly as before.

create or replace function public.app_update(p_platform text, p_build int)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_latest text;
  v_url text;
begin
  if p_platform not in ('ios', 'android') or p_build is null then return null; end if;
  select value into v_latest from app_config where key = p_platform || '_latest_build' limit 1;
  select value into v_url    from app_config where key = p_platform || '_update_url'   limit 1;
  if v_latest is null or v_latest !~ '^[0-9]{1,9}$' or v_latest::int <= p_build then return null; end if;
  if p_platform = 'android' then
    -- no link, no card: there is nowhere to send them
    if v_url is null or v_url !~ '^https://' then return null; end if;
    return jsonb_build_object('build', v_latest::int, 'url', v_url);
  end if;
  return jsonb_build_object('build', v_latest::int, 'url', coalesce(nullif(v_url, ''), 'itms-beta://'));
end;
$function$;

create or replace function public.announce_app_update(p_platform text, p_build int, p_url text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_platform not in ('ios', 'android') then
    raise exception 'Which app — ios or android?' using errcode = '22023';
  end if;
  if p_build is null or p_build < 1 then
    raise exception 'Which build?' using errcode = '22023';
  end if;
  if p_platform = 'ios' then
    -- only TestFlight (the app or one of its links), never any other address
    if p_url is not null and p_url !~ '^(itms-beta://.*|https://testflight\.apple\.com/.+)$' then
      raise exception 'That isn''t a TestFlight link' using errcode = '22023';
    end if;
  else
    -- the APK's download: an https link, and one is needed the first time
    if p_url is not null and p_url !~ '^https://[^\s]+$' then
      raise exception 'The download link must start with https://' using errcode = '22023';
    end if;
    if p_url is null and not exists (select 1 from app_config where key = 'android_update_url') then
      raise exception 'Give the link to the APK the first time' using errcode = '22023';
    end if;
  end if;

  -- app_config has no unique key, so replace rather than upsert
  delete from app_config where key = p_platform || '_latest_build';
  insert into app_config (key, value) values (p_platform || '_latest_build', p_build::text);
  if p_url is not null then
    delete from app_config where key = p_platform || '_update_url';
    insert into app_config (key, value) values (p_platform || '_update_url', p_url);
  end if;

  perform push_notify(jsonb_build_object('event', 'app_update', 'platform', p_platform, 'build', p_build));
end;
$function$;

revoke all on function public.app_update(text, int)                from public;
grant execute on function public.app_update(text, int)             to anon, authenticated;
revoke all on function public.announce_app_update(text, int, text) from public, anon, authenticated;
