#!/usr/bin/env python3
"""Rehearse 20261016010000_import_sources.sql against the real database, rolled back (the
same method as rehearse_import.py): imports from each new source, a source that isn't one,
and every real balance unchanged.

  python3 supabase/tests/rehearse_import_sources.py /tmp/sources.sql → run with execute_sql"""
import sys, pathlib, hashlib, json
ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = (ROOT / 'supabase/migrations/20261016010000_import_sources.sql').read_text()
MIGS = '\n'.join(l.strip() for l in MIG.split('\n') if l.strip() and not l.strip().startswith('--'))
BASE = {'hash': 'h' * 32, 'name': 'Dry', 'kind': 'group', 'me': '0',
        'people': [{'key': '0', 'name': 'A'}, {'key': '1', 'name': 'B'}],
        'expenses': [{'d': '2025-03-01', 't': 'Rewe', 'c': 'groceries', 'cur': 'EUR', 'total': 3000, 'paid': {'0': 3000}, 'owed': {'0': 1500, '1': 1500}}],
        'payments': [], 'balances': {'0|EUR': 1500, '1|EUR': -1500}}
def p(**o):
    d = dict(BASE); d.update(o); return "'" + json.dumps(d).replace("'", "''") + "'::jsonb"
tests = []
def ok(name, src, hsh):
    tests.append(f"""
  begin
    set local role authenticated; perform pg_temp.jwt(A);
    v := import_group({p(source=src, hash=hsh)}); g := (v -> 'flat' ->> 'id')::uuid;
    reset role; perform pg_temp.jwt(null);
    r := r || jsonb_build_object('{name}', (select source from imports where flat_id = g) || '|' || (select subject from activity where flat_id = g and kind = 'imported') || '|' || to_minor(flat_balance_in(g, A, 'EUR'), 'EUR'));
  exception when others then reset role; r := r || jsonb_build_object('{name}', 'ERR: ' || sqlerrm);
  end;""")
ok('tricount', 'tricount', 'a' * 32)
ok('settleup', 'settleup', 'b' * 32)
ok('splid', 'splid', 'c' * 32)
ok('other', 'other', 'd' * 32)
ok('splitwise', 'splitwise', 'e' * 32)
tests.append(f"""
  begin
    set local role authenticated; perform pg_temp.jwt(A);
    v := import_group({p(source='bogus', hash='f' * 32)});
    r := r || jsonb_build_object('bogus', 'FAIL: no error');
  exception when others then reset role; r := r || jsonb_build_object('bogus', sqlerrm);
  end;""")
script = f"""do $dry$
declare r jsonb := '{{}}'; A uuid := gen_random_uuid(); v jsonb; g uuid;
  mig text := $mig${MIGS}$mig$;
begin
  create temp table dry_bal on commit drop as select m.flat_id, m.user_id, public.flat_balance(m.flat_id, m.user_id) as bal from flat_members m;
  r := r || jsonb_build_object('mig_md5', md5(mig));
  execute mig;
  create function pg_temp.jwt(u uuid) returns void language plpgsql as
    $j$ begin perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true); end $j$;
  insert into auth.users (id, email, aud, role, email_confirmed_at) values (A, 'dryrun-' || A || '@example.invalid', 'authenticated', 'authenticated', now());
{''.join(tests)}
  r := r || jsonb_build_object('real_balances_changed', (select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6)));
  raise exception 'DRYRUN %', r;
end $dry$;"""
script = '\n'.join(l.strip() for l in script.split('\n') if l.strip())
pathlib.Path(sys.argv[1]).write_text(script)
print(len(script), 'bytes; migration md5', hashlib.md5(MIGS.encode()).hexdigest())
