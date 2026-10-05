-- Notifications follow the phone, not the first account that used it.
--
-- A phone's notification address (push_subscriptions.endpoint) can only be stored once.
-- When someone tried the app as a guest and later signed in to their real account, the
-- app tried to save the same address again for the new account — but the row still
-- belonged to the guest, and people may only change their own rows, so the save quietly
-- failed and every notification went to the forgotten guest account instead.
--
-- save_push_device(endpoint, platform, keys) is now the one way the apps save a device:
-- it checks the address looks like what that kind of device sends, and if the address is
-- already known it moves it to whoever is signed in now. forget_push_device(endpoint)
-- lets you remove your own device (on sign-out, or when you switch notifications off) —
-- never anyone else's.
--
-- Addresses by kind of device:
--   iPhone app (App Store / TestFlight)  'apns:'     + the device token in hex
--   iPhone app (built from Xcode)        'apns-dev:' + the device token in hex (Apple's test server)
--   Android app                          'fcm:'      + the Firebase token
--   browser                              the push service's https:// address, plus its two keys
--
-- push_notify gives the notification sender 15 seconds instead of 5: a sender that has
-- been asleep can take longer than 5 seconds to wake up, and the notification was lost.

create or replace function public.save_push_device(
  p_endpoint text, p_platform text, p_p256dh text default null, p_auth text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
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

  insert into push_subscriptions (user_id, endpoint, platform, p256dh, auth, created_at)
  values (me, p_endpoint, p_platform, p_p256dh, p_auth, now())
  on conflict (endpoint) do update
    set user_id    = auth.uid(),
        platform   = excluded.platform,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        created_at = now();
end;
$function$;

create or replace function public.forget_push_device(p_endpoint text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  -- signed out already: there is nothing of yours to forget
  if auth.uid() is null then return; end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$function$;

revoke all on function public.save_push_device(text, text, text, text) from public, anon;
revoke all on function public.forget_push_device(text)                 from public, anon;
grant execute on function public.save_push_device(text, text, text, text) to authenticated;
grant execute on function public.forget_push_device(text)                 to authenticated;

-- unchanged apart from the timeout (5 seconds by default)
create or replace function public.push_notify(p jsonb)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_url text;
  v_token text;
begin
  select value into v_url   from app_config where key = 'push_url';
  select value into v_token from app_config where key = 'push_token';
  if v_url is null or v_token is null then return; end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := p || jsonb_build_object('token', v_token),
    timeout_milliseconds := 15000
  );
end;
$function$;
