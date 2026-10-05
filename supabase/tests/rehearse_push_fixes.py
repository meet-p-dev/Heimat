#!/usr/bin/env python3
"""Rehearse 20261005000000_push_fixes.sql against the real database without changing it:
runs the migration, then plays two throwaway people (A and B) sharing one phone:

  - A saves the phone; B signs in on the same phone and saves it → the row is now B's
  - A can't forget it any more; B can
  - addresses that don't match the kind of device are refused, and so is a browser
    without its keys; someone not signed in is refused
  - the anon role can't call either function, nor can a signed-in user call push_notify
  - push_notify now waits 15 seconds, and nobody's real devices were touched

and ends with raise exception 'DRYRUN …' so every change rolls back.

  python3 supabase/tests/rehearse_push_fixes.py /tmp/pf.sql   → run with execute_sql"""
import sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def strip(s): return '\n'.join(l.strip() for l in s.split('\n') if l.strip() and not l.strip().startswith('--'))
MIG = strip((ROOT / 'supabase/migrations/20261005000000_push_fixes.sql').read_text())
assert '$mig$' not in MIG

# (platform, endpoint expression, p256dh, auth) that must all be refused
BAD = [
    ("'ios'",     "'fcm:abc'",                               'null', 'null'),
    ("'ios'",     "'apns:' || repeat('g', 64)",              'null', 'null'),   # not hex
    ("'ios'",     "'apns:' || repeat('a', 63)",              'null', 'null'),   # too short
    ("'ios'",     "'apns:' || repeat('a', 201)",             'null', 'null'),   # too long
    ("'ios'",     "'apns:' || repeat('a', 64) || ' '",       'null', 'null'),   # trailing junk
    ("'ios'",     "'apns-sandbox:' || repeat('a', 64)",      'null', 'null'),
    ("'ios'",     "'https://push.example.invalid/x'",        "'k'",  "'a'"),
    ("'android'", "'apns:' || repeat('a', 64)",              'null', 'null'),
    ("'android'", "'fcm:'",                                  'null', 'null'),   # empty token
    ("'android'", "'fcm:' || repeat('x', 4097)",             'null', 'null'),
    ("'web'",     "'http://push.example.invalid/x'",         "'k'",  "'a'"),
    ("'web'",     "'apns:' || repeat('a', 64)",              "'k'",  "'a'"),
    ("'web'",     "'https://' || repeat('x', 2041)",         "'k'",  "'a'"),   # 2049 long
    ("'web'",     "'https://push.example.invalid/nokeys'",   'null', 'null'),
    ("'web'",     "'https://push.example.invalid/nop'",      'null', "'a'"),
    ("'web'",     "'https://push.example.invalid/noa'",      "'k'",  'null'),
    ("'web'",     "'https://push.example.invalid/empty'",    "''",   "''"),
    ("'desktop'", "'https://push.example.invalid/x'",        "'k'",  "'a'"),
    ('null',      "'apns:' || repeat('a', 64)",              'null', 'null'),
    ("'ios'",     'null',                                    'null', 'null'),
]
bad_sql = '\n'.join(
    f"""  begin perform public.save_push_device({e}, {p}, {k}, {a}); oks := oks || jsonb_build_array({i}); exception when others then
    refused := refused + 1; if sqlstate <> '22023' then odd := odd || jsonb_build_object('bad_{i}', sqlerrm); end if; end;"""
    for i, (p, e, k, a) in enumerate(BAD))

sql = f"""do $dry$
declare
  r jsonb := '{{}}'; oks jsonb := '[]'; odd jsonb := '{{}}'; refused int := 0;
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  ep text := 'apns:' || md5(random()::text) || md5(random()::text);
  ep_dev text := 'apns-dev:' || md5(random()::text) || md5(random()::text) || md5(random()::text) || md5(random()::text) || md5(random()::text);
  ep_fcm text := 'fcm:dryrun-' || md5(random()::text) || ':APA91b_-x';
  ep_web text := 'https://push.example.invalid/dryrun/' || md5(random()::text);
  fp_before text; fp_after text; acl_before text; acl_after text;
  owner_after_a uuid; owner_after_b uuid; rows_after_b int; after_a_forget int; after_b_forget int;
  web_ok boolean; dev_ok boolean; fcm_ok boolean; resave_ok boolean; dev_kept boolean;
  not_signed_in text := 'accepted'; forget_signed_out text := 'no error';
  anon_save text := 'allowed'; anon_forget text := 'allowed'; auth_notify text := 'allowed';
begin
  select md5(coalesce(string_agg(id::text || user_id::text || endpoint || platform || coalesce(p256dh, '') || coalesce(auth, '') || created_at, ',' order by id), '')) into fp_before from push_subscriptions;
  select proacl::text into acl_before from pg_proc where oid = 'public.push_notify(jsonb)'::regprocedure;

  execute $mig${MIG}$mig$;

  create function pg_temp.jwt(u uuid) returns void language plpgsql as $j$ begin perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u, 'role', 'authenticated')::text end, true); end $j$;
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (ua, 'dryrun-' || ua || '@example.invalid', 'authenticated', 'authenticated', now()),
    (ub, 'dryrun-' || ub || '@example.invalid', 'authenticated', 'authenticated', now());

  -- A saves the phone
  set local role authenticated; perform pg_temp.jwt(ua);
  perform public.save_push_device(ep, 'ios');
  reset role;
  select user_id into owner_after_a from push_subscriptions where endpoint = ep;

  -- A saves it again: still one row
  set local role authenticated; perform pg_temp.jwt(ua);
  perform public.save_push_device(ep, 'ios');
  reset role;
  resave_ok := (select count(*) = 1 and bool_and(user_id = ua) from push_subscriptions where endpoint = ep);

  -- B signs in on the same phone
  set local role authenticated; perform pg_temp.jwt(ub);
  perform public.save_push_device(ep, 'ios');
  reset role;
  select user_id, (select count(*) from push_subscriptions where endpoint = ep) into owner_after_b, rows_after_b from push_subscriptions where endpoint = ep;

  -- A can't forget B's phone
  set local role authenticated; perform pg_temp.jwt(ua);
  perform public.forget_push_device(ep);
  reset role;
  select count(*) into after_a_forget from push_subscriptions where endpoint = ep and user_id = ub;

  -- B can
  set local role authenticated; perform pg_temp.jwt(ub);
  perform public.forget_push_device(ep);
  reset role;
  select count(*) into after_b_forget from push_subscriptions where endpoint = ep;

  -- the other good shapes are accepted
  set local role authenticated; perform pg_temp.jwt(ua);
  perform public.save_push_device(ep_dev, 'ios');
  perform public.save_push_device(ep_fcm, 'android');
  perform public.save_push_device(ep_web, 'web', 'BKey-p256dh', 'auth-secret');
  reset role;
  dev_ok := exists (select 1 from push_subscriptions where endpoint = ep_dev and user_id = ua and platform = 'ios');
  fcm_ok := exists (select 1 from push_subscriptions where endpoint = ep_fcm and user_id = ua and platform = 'android');
  web_ok := exists (select 1 from push_subscriptions where endpoint = ep_web and user_id = ua and platform = 'web' and p256dh = 'BKey-p256dh' and auth = 'auth-secret');

  -- the bad shapes are refused
  set local role authenticated; perform pg_temp.jwt(ua);
{bad_sql}
  reset role;

  -- not signed in
  set local role authenticated; perform pg_temp.jwt(null);
  begin perform public.save_push_device(ep, 'ios'); exception when others then not_signed_in := sqlerrm; end;
  begin perform public.forget_push_device(ep_dev); exception when others then forget_signed_out := sqlerrm; end;
  reset role;
  dev_kept := exists (select 1 from push_subscriptions where endpoint = ep_dev and user_id = ua);

  -- the anon role can't call either; a signed-in user can't call push_notify
  set local role anon; perform pg_temp.jwt(null);
  begin perform public.save_push_device(ep, 'ios'); exception when insufficient_privilege then anon_save := 'refused'; end;
  begin perform public.forget_push_device(ep_dev); exception when insufficient_privilege then anon_forget := 'refused'; end;
  reset role;
  set local role authenticated; perform pg_temp.jwt(ua);
  begin perform public.push_notify('{{}}'::jsonb); exception when insufficient_privilege then auth_notify := 'refused'; end;
  reset role; perform pg_temp.jwt(null);

  select proacl::text into acl_after from pg_proc where oid = 'public.push_notify(jsonb)'::regprocedure;
  delete from push_subscriptions where endpoint in (ep, ep_dev, ep_fcm, ep_web);
  select md5(coalesce(string_agg(id::text || user_id::text || endpoint || platform || coalesce(p256dh, '') || coalesce(auth, '') || created_at, ',' order by id), '')) into fp_after from push_subscriptions;

  r := jsonb_build_object(
    'a_saved', owner_after_a = ua,
    'a_resave_one_row', resave_ok,
    'moved_to_b', owner_after_b = ub and rows_after_b = 1,
    'a_cannot_forget', after_a_forget = 1,
    'b_forgot', after_b_forget = 0,
    'dev_fcm_web_saved', dev_ok and fcm_ok and web_ok,
    'refused', refused || '/' || {len(BAD)},
    'wrongly_accepted', oks,
    'other_errors', odd,
    'not_signed_in', not_signed_in,
    'forget_signed_out', forget_signed_out, 'signed_out_forget_kept_row', dev_kept,
    'anon_save', anon_save, 'anon_forget', anon_forget, 'authenticated_push_notify', auth_notify,
    'push_notify_acl_kept', acl_after = acl_before,
    'timeout_15s', pg_get_functiondef('public.push_notify(jsonb)'::regprocedure) like '%timeout_milliseconds := 15000%',
    'save_acl', (select proacl::text from pg_proc where oid = 'public.save_push_device(text,text,text,text)'::regprocedure),
    'real_rows_untouched', fp_after = fp_before);
  raise exception 'DRYRUN %', r;
end $dry$;"""
out = pathlib.Path(sys.argv[1]); out.write_text(sql); print(len(sql), 'bytes')
