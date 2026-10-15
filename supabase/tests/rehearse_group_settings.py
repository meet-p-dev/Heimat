#!/usr/bin/env python3
"""Rehearse 20261017000000_group_settings.sql against the real database, rolled back (the
method of rehearse_import.py): renaming and "what it's for" by anyone in the group, renaming
people (yourself, someone waiting to join — not someone who joined), deleting a group only
when no debt can disappear, and every real balance unchanged.

  python3 supabase/tests/rehearse_group_settings.py /tmp/gs.sql → run with execute_sql"""
import sys, pathlib, hashlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = (ROOT / 'supabase/migrations/20261017000000_group_settings.sql').read_text()
MIGS = '\n'.join(l.strip() for l in MIG.split('\n') if l.strip() and not l.strip().startswith('--'))
tests = []
def q(s): return "'" + s.replace("'", "''") + "'"
def ok(name, body, result):
    tests.append(f"""
  begin
{body}
    r := r || jsonb_build_object('{name}', {result});
  exception when others then reset role; perform pg_temp.jwt(null); r := r || jsonb_build_object('{name}', 'ERR: ' || sqlerrm);
  end;""")
def fails(name, body):
    tests.append(f"""
  begin
{body}
    r := r || jsonb_build_object('{name}', 'FAIL: no error');
  exception when others then reset role; perform pg_temp.jwt(null); r := r || jsonb_build_object('{name}', sqlerrm);
  end;""")
def as_user(u, body): return f"    set local role authenticated; perform pg_temp.jwt({u});\n{body}\n    reset role; perform pg_temp.jwt(null);"

ok('setup', as_user('A', "    g := (create_group('Dry WG', 'Ana')).id;") + """
    insert into flat_members (flat_id, user_id, display_name, invite_token, invited_by) values (g, P, 'Pri', 'tokdry' || g, A);
    select join_code into code from flats where id = g;""" + "\n" + as_user('B', "    perform join_flat(code, 'Ben');") + "\n" +
   as_user('A', "    insert into expenses (flat_id, description, amount, currency, paid_by, split_among, split_type, split, payers) values (g, 'Dry', 10, 'EUR', A, array[A, B], 'equal', null, null);"),
   "(select count(*) from flat_members where flat_id = g)")
ok('rename_by_anyone', as_user('B', "    perform update_group(g, '  WG Küche  ', 'home');"),
   "(select name || '|' || purpose from flats where id = g) || '|' || (select string_agg(subject || '<' || (meta ->> 'was'), ',') from activity where flat_id = g and kind = 'renamed')")
ok('same_name_no_line', as_user('A', "    perform update_group(g, 'WG Küche', 'trip');"),
   "(select purpose from flats where id = g) || '|' || (select count(*) from activity where flat_id = g and kind = 'renamed')")
fails('empty_name', as_user('A', "    perform update_group(g, '   ', null);"))
fails('bad_purpose', as_user('A', "    perform update_group(g, 'X', 'party');"))
fails('outsider', as_user('C', "    perform update_group(g, 'Mine now', null);"))
ok('rename_self', as_user('A', "    perform rename_member(g, A, 'Ana K.');"), "(select display_name from flat_members where flat_id = g and user_id = A)")
ok('rename_waiting', as_user('B', "    perform rename_member(g, P, 'Priya Nair');"), "(select display_name from flat_members where flat_id = g and user_id = P)")
fails('rename_someone_who_joined', as_user('A', "    perform rename_member(g, B, 'Benny');"))
fails('delete_while_owed', as_user('A', "    perform delete_group(g);"))
ok('settle_then_delete', as_user('B', "    insert into settlements (flat_id, from_user, to_user, amount, currency) values (g, B, A, 5, 'EUR');") + "\n    q0 := coalesce((select max(id) from net.http_request_queue), 0);\n" + as_user('B', "    perform delete_group(g);"),
   "(select count(*) from flats where id = g) || '|' || (select count(*) from flat_members where flat_id = g) || '|' || (select count(*) from net.http_request_queue where id > q0)")
ok('alone_with_debt_to_placeholder', as_user('A', "    h := (create_group('Solo', 'Ana')).id;") + "\n    insert into flat_members (flat_id, user_id, display_name, invite_token, invited_by) values (h, P, 'Pri', 'tokdry2' || h, A);\n" +
   as_user('A', "    insert into expenses (flat_id, description, amount, currency, paid_by, split_among, split_type, split, payers) values (h, 'Dry', 10, 'EUR', A, array[A, P], 'equal', null, null);\n    perform delete_group(h);"),
   "(select count(*) from flats where id = h)")
ok('real_balances_changed', "", "(select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6))")

script = f"""do $dry$
declare r jsonb := '{{}}'; A uuid := gen_random_uuid(); B uuid := gen_random_uuid(); C uuid := gen_random_uuid(); P uuid := gen_random_uuid();
  g uuid; h uuid; code text; q0 bigint;
  mig text := $mig${MIGS}$mig$;
begin
  create temp table dry_bal on commit drop as select m.flat_id, m.user_id, public.flat_balance(m.flat_id, m.user_id) as bal from flat_members m;
  r := r || jsonb_build_object('mig_md5', md5(mig));
  execute mig;
  create function pg_temp.jwt(u uuid) returns void language plpgsql as
    $j$ begin perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true); end $j$;
  insert into auth.users (id, email, aud, role, email_confirmed_at) select x, 'dryrun-' || x || '@example.invalid', 'authenticated', 'authenticated', now() from unnest(array[A, B, C]) x;
{''.join(tests)}
  raise exception 'DRYRUN %', r;
end $dry$;"""
script = '\n'.join(l.strip() for l in script.split('\n') if l.strip())
pathlib.Path(sys.argv[1]).write_text(script)
print(len(script), 'bytes; migration md5', hashlib.md5(MIGS.encode()).hexdigest())
