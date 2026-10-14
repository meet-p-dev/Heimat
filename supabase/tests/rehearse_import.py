#!/usr/bin/env python3
"""Rehearse the import migration (20261016000000_import.sql) against the real database
without changing it — the same method as rehearse_friends.py.

One DO block: snapshots every real person's flat_balance, runs the migration, imports
throwaway Splitwise groups as throwaway accounts (through RLS and grants), checks the
scenarios below, and ends with RAISE EXCEPTION, so everything rolls back. Results come back
as JSON in the error; `mig_md5` must equal the md5 printed here.

  python3 supabase/tests/rehearse_import.py /tmp/import.sql
  → run its contents with the Supabase MCP execute_sql; every entry must match
    <out>.expect.json."""
import sys, pathlib, hashlib, json

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = (ROOT / 'supabase/migrations/20261016000000_import.sql').read_text()
assert '$mig$' not in MIG and '$dry$' not in MIG
MIGS = '\n'.join(l.strip() for l in MIG.split('\n') if l.strip() and not l.strip().startswith('--'))

tests = []
expect = {}

def q(s):
    return "'" + s.replace("'", "''") + "'"

def ok(name, body, result, want='ok'):
    expect[name] = want
    tests.append(f"""
  begin
{body}
    r := r || jsonb_build_object('{name}', {result});
  exception when others then
    r := r || jsonb_build_object('{name}', 'ERR: ' || sqlerrm);
  end;""")

def fails(name, body, pattern, after="'ok'"):
    """body must raise an error matching the LIKE pattern; `after` is checked once it has rolled back"""
    expect[name] = 'ok'
    tests.append(f"""
  begin
    begin
{body}
      r := r || jsonb_build_object('{name}', 'FAIL: no error');
    exception when others then
      reset role; perform pg_temp.jwt(null);
      r := r || jsonb_build_object('{name}', case when sqlerrm like {q(pattern)} then {after} else 'FAIL: ' || sqlerrm end);
    end;
  end;""")

def as_user(u, body):
    return f"""    set local role authenticated; perform pg_temp.jwt({u});
{body}
    reset role; perform pg_temp.jwt(null);"""

def check(cond):
    return f"case when {cond} then 'ok' else 'FAIL' end"

# A Splitwise group of three: A (me, key "0"), Priya ("1"), Tom ("2").
# 1. Rewe 30,00 € paid by A, equal                → A +20, P −10, T −10
# 2. Rent 900,00 € paid by A 600 + P 300, split 300 each → A +300, P 0, T −300
# 3. Taxi 25,00 USD paid by T, A and T only, 12,50 each → A −12,50, T +12,50
# 4. Priya pays A 10,00 €                          → P +10, A −10
# EUR: A 20+300−10 = 310, P −10+10 = 0, T −10−300 = −310   USD: A −1250, T +1250
GOOD = {
    'source': 'splitwise', 'hash': 'h' * 32, 'name': 'Dry WG', 'kind': 'group', 'me': '0',
    'people': [{'key': '0', 'name': 'Alex'}, {'key': '1', 'name': 'Priya'}, {'key': '2', 'name': 'Tom'}],
    'expenses': [
        {'d': '2025-03-01', 't': 'Rewe', 'c': 'groceries', 'cur': 'EUR', 'total': 3000,
         'paid': {'0': 3000}, 'owed': {'0': 1000, '1': 1000, '2': 1000}},
        {'d': '2025-03-02', 't': 'Rent', 'c': 'rent', 'cur': 'EUR', 'total': 90000,
         'paid': {'0': 60000, '1': 30000}, 'owed': {'0': 30000, '1': 30000, '2': 30000}},
        {'d': '2025-03-03', 't': 'Taxi', 'c': 'nonsense', 'cur': 'usd', 'total': 2500,
         'paid': {'2': 2500}, 'owed': {'0': 1250, '2': 1250}},
    ],
    'payments': [{'d': '2025-03-04', 'from': '1', 'to': '0', 'cur': 'EUR', 'total': 1000}],
    'balances': {'0|EUR': 31000, '1|EUR': 0, '2|EUR': -31000, '0|USD': -1250, '2|USD': 1250},
}
def payload(**over):
    # the sample group is declared once in the block (`base`); a test changes only what it names
    return '(base || ' + q(json.dumps(over)) + '::jsonb)' if over else 'base'

def imp(var, **over):
    return f"    v := import_group({payload(**over)}); {var} := (v -> 'flat' ->> 'id')::uuid; imp := (v ->> 'import')::uuid;"

def bal(f, who, cur):
    return f"to_minor(flat_balance_in({f}, {who}, '{cur}'), '{cur}')"

def pl(f, name):  # the placeholder with that name in the group
    return f"(select user_id from flat_members where flat_id = {f} and display_name = {q(name)})"

ok('real_balances_unchanged', "", "(select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6))", 0)

ok('import_ok', as_user('A', imp('g1')),
   check("(select kind from flats where id = g1) = 'group' and (select name from flats where id = g1) = 'Dry WG'"))
ok('people', "", "(select string_agg(display_name || ':' || (claimed_at is not null)::text || ':' || (invite_token is not null)::text || ':' || (invite_email is null)::text, ',' order by display_name) from flat_members where flat_id = g1)",
   'Alex:true:false:true,Priya:false:true:true,Tom:false:true:true')
ok('me_is_alex', "", check("exists (select 1 from flat_members where flat_id = g1 and user_id = A and display_name = 'Alex')"))
ok('counts', "", "(select count(*) from expenses where flat_id = g1) || ' ' || (select count(*) from settlements where flat_id = g1)", '3 1')
ok('balances', "", f"{bal('g1','A','EUR')} || ' ' || {bal('g1', pl('g1','Priya'), 'EUR')} || ' ' || {bal('g1', pl('g1','Tom'), 'EUR')} || ' ' || {bal('g1','A','USD')} || ' ' || {bal('g1', pl('g1','Tom'), 'USD')}",
   '31000 0 -31000 -1250 1250')
ok('rent_two_payers', "", f"(select (payers ->> A::text) || ' ' || (payers ->> {pl('g1','Priya')}::text) || ' ' || (paid_by = A)::text || ' ' || split_type from expenses where flat_id = g1 and description = 'Rent')",
   '60000 30000 true exact')
ok('shares_exact', "", f"(select string_agg(description || '=' || (shares ->> A::text), ',' order by description) from expenses where flat_id = g1 and shares ? A::text)",
   'Rent=30000,Rewe=1000,Taxi=1250')
ok('dates_and_categories', "", "(select string_agg(description || ':' || spent_on || ':' || category || ':' || currency, ',' order by description) from expenses where flat_id = g1)",
   'Rent:2025-03-02:rent:EUR,Rewe:2025-03-01:groceries:EUR,Taxi:2025-03-03:other:USD')
ok('payment', "", f"(select (from_user = {pl('g1','Priya')})::text || ' ' || (to_user = A)::text || ' ' || amount || ' ' || settled_on from settlements where flat_id = g1)",
   'true true 10.00 2025-03-04')
ok('one_feed_line', "", "(select string_agg(kind || ':' || coalesce(subject, '') || ':' || (meta ->> 'expenses') || ':' || (meta ->> 'payments'), ',') from activity where flat_id = g1)",
   'imported:Splitwise:3:1')
ok('no_pushes', "", "(select count(*) from net.http_request_queue where id > q0)", 0)
ok('import_row_visible_to_owner', as_user('A', "    cnt := (select count(*) from imports where flat_id = g1);"), 'cnt', 1)
ok('import_row_hidden_from_others', as_user('B', "    cnt := (select count(*) from imports);"), 'cnt', 0)

fails('same_file_twice', as_user('A', imp('g2')), 'import: already')
fails('balances_must_match', as_user('A', imp('g2', hash='b' * 32, balances={'0|EUR': 31001, '1|EUR': -1, '2|EUR': -31000, '0|USD': -1250, '2|USD': 1250})),
      'import: balances_differ', check("not exists (select 1 from flats where name = 'Dry WG' and id <> g1)"))
fails('missing_currency_book', as_user('A', imp('g2', hash='c' * 32, balances={'0|EUR': 31000, '2|EUR': -31000})), 'import: balances_differ')
fails('pick_yourself', as_user('A', imp('g2', hash='d' * 32, me='9')), 'import: pick_yourself')
fails('unknown_person', as_user('A', imp('g2', hash='e' * 32, payments=[{'d': '2025-03-04', 'from': '7', 'to': '0', 'cur': 'EUR', 'total': 1000}])), 'import: bad_row')
fails('shares_must_add_up', as_user('A', imp('g2', hash='f' * 32, expenses=[{'d': '2025-03-01', 't': 'x', 'c': 'other', 'cur': 'EUR', 'total': 3000, 'paid': {'0': 3000}, 'owed': {'1': 1000}}], payments=[], balances={})), '%')
fails('future_date', as_user('A', imp('g2', hash='g' * 32, payments=[{'d': '2999-01-01', 'from': '1', 'to': '0', 'cur': 'EUR', 'total': 1000}])), 'import: bad_row')
fails('nothing_in_it', as_user('A', imp('g2', hash='i' * 32, expenses=[], payments=[], balances={})), 'import: empty')
fails('signed_out', imp('g2', hash='j' * 32), 'Not signed in')
ok('flat_kind', as_user('A', imp('g3', hash='k' * 32, kind='flat', name='Dry flat')),
   check("(select kind from flats where id = g3) = 'flat'"))

# Priya opens her link: she takes over her name and every cent stays where it was
ok('priya_claims', "    select invite_token into tx from flat_members where flat_id = g1 and display_name = 'Priya';\n" + as_user('B', "    perform claim_invite(tx);"),
   f"{bal('g1','B','EUR')} || ' ' || {bal('g1','A','EUR')} || ' ' || (select count(*) from flat_members where flat_id = g1 and claimed_at is not null)", '0 31000 2')
fails('cannot_remove_after_someone_joined', as_user('A', "    perform remove_import((select id from imports where flat_id = g1));"), 'import: someone_joined')

# feed and pushes work as before once an import is done
ok('normal_life_after', as_user('A', "    insert into expenses (flat_id, description, amount, currency, paid_by, split_among, split_type, split, payers) values (g1, 'After', 10, 'EUR', A, array[A, B], 'equal', null, null);"),
   "(select count(*) from activity where flat_id = g1 and kind = 'expense_added') || ' ' || ((select count(*) from net.http_request_queue where id > q0) > 0)::text", '1 true')

# take one back: the group and everything in it is gone, and the same file may come in again
ok('remove', as_user('A', imp('g4', hash='m' * 32, name='Dry remove') + "\n    i4 := imp;\n    perform remove_import(i4);"),
   check("not exists (select 1 from flats where id = g4) and not exists (select 1 from expenses where flat_id = g4) and not exists (select 1 from flat_members where flat_id = g4) and not exists (select 1 from activity where flat_id = g4) and (select flat_id from imports where id = i4) is null"))
ok('remove_sends_nothing', "", "(select count(*) from net.http_request_queue hq where hq.id > q0 and convert_from(hq.body, 'UTF8') not like '%After%')", 0)
ok('again_after_remove', as_user('A', imp('g5', hash='m' * 32, name='Dry again')), check("g5 is not null and g5 <> g4"))
fails('remove_someone_elses', as_user('B', "    perform remove_import(i4);"), 'import: gone')
fails('remove_twice', as_user('A', "    perform remove_import(i4);"), 'import: gone')

ok('real_balances_unchanged_at_end', "", "(select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6))", 0)
ok('audit_clean', "", "(select count(*) from ledger_audit() la where la::text like any (array['%' || g1 || '%', '%' || g3 || '%', '%' || g5 || '%']))", 0)

script = f"""do $dry$
declare
  r jsonb := '{{}}';
  A uuid := gen_random_uuid(); B uuid := gen_random_uuid();
  base jsonb := {q(json.dumps(GOOD))};
  g1 uuid; g2 uuid; g3 uuid; g4 uuid; g5 uuid; imp uuid; i4 uuid; v jsonb; cnt bigint; q0 bigint; tx text;
  mig text := $mig${MIGS}$mig$;
begin
  create temp table dry_bal on commit drop as
    select m.flat_id, m.user_id, public.flat_balance(m.flat_id, m.user_id) as bal from flat_members m;
  r := r || jsonb_build_object('mig_md5', md5(mig));
  execute mig;
  create function pg_temp.jwt(u uuid) returns void language plpgsql as
    $j$ begin perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true); end $j$;
  insert into auth.users (id, email, aud, role, email_confirmed_at)
    select uid_, ('dryrun-' || uid_ || '@example.invalid'), 'authenticated', 'authenticated', now() from unnest(array[A, B]) uid_;
  q0 := coalesce((select max(id) from net.http_request_queue), 0);
{''.join(tests)}

  raise exception 'DRYRUN %', r;
end $dry$;
"""
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'import-rehearsal.sql')
script = '\n'.join(l.strip() for l in script.split('\n') if l.strip())
out.write_text(script)
print(len(script), 'bytes,', len(tests), 'tests ->', out, ' migration md5', hashlib.md5(MIGS.encode()).hexdigest())
pathlib.Path(str(out) + '.expect.json').write_text(json.dumps(expect, indent=1, default=str))
