#!/usr/bin/env python3
"""Rehearse 20261018000000_install_source.sql against the real database without changing it:
runs the migration, then one throwaway person saves devices the way each app does:

  - an old iPhone build (two named arguments, no source) → saved, source unknown (null)
  - the web and Android (four arguments) → still saved
  - an App Store copy → 'appstore'; the same phone saving again from TestFlight → 'testflight'
  - a source this database doesn't know → kept as null, the device still saved
  - only the new five-argument function exists; anon still can't call it
  - who announce_app_update would reach (the push function's filter) leaves out 'appstore'
  - nobody's real devices change

and ends with raise exception 'DRYRUN …' so every change rolls back.

  python3 supabase/tests/rehearse_install_source.py /tmp/is.sql   → run with execute_sql"""
import sys, pathlib, hashlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = (ROOT / 'supabase/migrations/20261018000000_install_source.sql').read_text()
def strip(s): return '\n'.join(l.strip() for l in s.split('\n') if l.strip() and not l.strip().startswith('--'))
MIG = strip(RAW)
assert '$mig$' not in MIG

sql = f"""do $dry$
declare
  r jsonb; u uuid := gen_random_uuid();
  ep_old text := 'apns:' || md5(random()::text) || md5(random()::text);
  ep_store text := 'apns:' || md5(random()::text) || md5(random()::text);
  ep_odd text := 'apns:' || md5(random()::text) || md5(random()::text);
  ep_web text := 'https://push.example.invalid/dryrun/' || md5(random()::text);
  ep_fcm text := 'fcm:dryrun-' || md5(random()::text);
  fp_before text; fp_after text; reach_before int; reach_after int;
  old_src text := 'x'; store_src text; resaved_src text; odd_src text := 'x'; odd_saved boolean;
  web_ok boolean; fcm_ok boolean; anon_save text := 'allowed'; reach_mine int;
begin
  select md5(coalesce(string_agg(id::text || user_id::text || endpoint || platform || coalesce(p256dh, '') || coalesce(auth, '') || created_at, ',' order by id), '')) into fp_before from push_subscriptions;
  select count(*) into reach_before from push_subscriptions where endpoint like 'apns:%';

  execute $mig${MIG}$mig$;

  create function pg_temp.jwt(u uuid) returns void language plpgsql as $j$ begin perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u, 'role', 'authenticated')::text end, true); end $j$;
  insert into auth.users (id, email, aud, role, email_confirmed_at) values (u, 'dryrun-' || u || '@example.invalid', 'authenticated', 'authenticated', now());

  set local role authenticated; perform pg_temp.jwt(u);
  perform public.save_push_device(p_endpoint => ep_old, p_platform => 'ios');
  perform public.save_push_device(p_endpoint => ep_web, p_platform => 'web', p_p256dh => 'BKey', p_auth => 'secret');
  perform public.save_push_device(p_endpoint => ep_fcm, p_platform => 'android', p_p256dh => null, p_auth => null);
  perform public.save_push_device(p_endpoint => ep_store, p_platform => 'ios', p_source => 'appstore');
  reset role;
  select install_source into old_src from push_subscriptions where endpoint = ep_old;
  select install_source into store_src from push_subscriptions where endpoint = ep_store;
  web_ok := exists (select 1 from push_subscriptions where endpoint = ep_web and user_id = u and p256dh = 'BKey' and auth = 'secret');
  fcm_ok := exists (select 1 from push_subscriptions where endpoint = ep_fcm and user_id = u);

  -- who an announcement would reach now: the push function's filter
  select count(*) into reach_mine from push_subscriptions
   where user_id = u and endpoint like 'apns:%' and (install_source is null or install_source <> 'appstore');

  set local role authenticated; perform pg_temp.jwt(u);
  perform public.save_push_device(p_endpoint => ep_store, p_platform => 'ios', p_source => 'testflight');
  perform public.save_push_device(p_endpoint => ep_odd, p_platform => 'ios', p_source => 'beta');
  reset role;
  select install_source into resaved_src from push_subscriptions where endpoint = ep_store;
  select install_source, true into odd_src, odd_saved from push_subscriptions where endpoint = ep_odd;

  set local role anon; perform pg_temp.jwt(null);
  begin perform public.save_push_device(ep_old, 'ios'); exception when insufficient_privilege then anon_save := 'refused'; end;
  reset role;

  delete from push_subscriptions where user_id = u;
  select md5(coalesce(string_agg(id::text || user_id::text || endpoint || platform || coalesce(p256dh, '') || coalesce(auth, '') || created_at, ',' order by id), '')) into fp_after from push_subscriptions;
  select count(*) into reach_after from push_subscriptions where endpoint like 'apns:%' and (install_source is null or install_source <> 'appstore');

  r := jsonb_build_object(
    'old_iphone_null', old_src is null,
    'web_android_saved', web_ok and fcm_ok,
    'appstore_saved', store_src = 'appstore',
    'announcement_skips_appstore', reach_mine = 1,
    'resaved_testflight', resaved_src = 'testflight',
    'unknown_kept_null', odd_saved and odd_src is null,
    'versions', (select jsonb_agg(p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_push_device'),
    'anon_save', anon_save,
    'acl', (select proacl::text from pg_proc where oid = 'public.save_push_device(text,text,text,text,text)'::regprocedure),
    'real_devices_still_reached', reach_after || '/' || reach_before,
    'real_rows_untouched', fp_after = fp_before,
    'mig_md5', md5($mig${MIG}$mig$));
  raise exception 'DRYRUN %', r;
end $dry$;"""
out = pathlib.Path(sys.argv[1]); out.write_text(sql)
print(len(sql), 'bytes; migration md5', hashlib.md5(MIG.encode()).hexdigest())
