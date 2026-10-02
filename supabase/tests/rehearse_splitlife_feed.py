#!/usr/bin/env python3
"""Rehearse 20261002040000_splitlife_feed.sql against the real database without changing it:
loads the random groups of tests/pairwise-vectors.json (made by tests/make-pairwise-vectors.ts
from the web engine) as throwaway people, groups, bills and payments, and checks that
my_pairwise() gives every person exactly what the web engine's person page gives — then
rolls everything back.

  python3 supabase/tests/rehearse_splitlife_feed.py /tmp/sf.sql   → run with execute_sql"""
import sys, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def strip(s): return '\n'.join(l.strip() for l in s.split('\n') if l.strip() and not l.strip().startswith('--'))
MIG = strip((ROOT / 'supabase/migrations/20261002040000_splitlife_feed.sql').read_text())
V = json.loads((ROOT / 'tests/pairwise-vectors.json').read_text())
# only what the database needs to rebuild each group
slim = [{'people': g['people'], 'expect': g['expect'],
         'expenses': [{k: e[k] for k in ('id', 'amount', 'currency', 'paid_by', 'payers', 'split_among')} for e in g['expenses']],
         'settles': [{k: s[k] for k in ('from_user', 'to_user', 'amount', 'currency')} for s in g['settles']]} for g in V]
data = json.dumps(slim, separators=(',', ':')).replace("'", "''")
assert '$mig$' not in MIG
sql = f"""do $dry$
declare r jsonb := '{{}}'; g jsonb; e jsonb; s jsonb; u text; gid uuid; got jsonb; bad int := 0; checked int := 0; feed int := 0;
begin
create temp table dry_bal on commit drop as select m.flat_id, m.user_id, public.flat_balance(m.flat_id, m.user_id) as bal from flat_members m;
execute $mig${MIG}$mig$;
create function pg_temp.jwt(u text) returns void language plpgsql as $j$ begin perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u, 'role', 'authenticated')::text end, true); end $j$;
for g in select value from jsonb_array_elements('{data}'::jsonb) loop
  gid := gen_random_uuid();
  insert into auth.users (id, email, aud, role, email_confirmed_at)
    select x::uuid, 'dryrun-' || x || '@example.invalid', 'authenticated', 'authenticated', now() from jsonb_array_elements_text(g -> 'people') x;
  insert into flats (id, name, join_code, created_by, kind) values (gid, 'dry', upper('DRP' || substr(md5(gid::text), 1, 7)), (g -> 'people' ->> 0)::uuid, 'group');
  insert into flat_members (flat_id, user_id, display_name, claimed_at) select gid, x::uuid, 'p' || x, now() from jsonb_array_elements_text(g -> 'people') x;
  for e in select value from jsonb_array_elements(g -> 'expenses') loop
    insert into expenses (id, flat_id, description, amount, currency, paid_by, payers, split_among, category, spent_on, created_by)
    values ((e ->> 'id')::uuid, gid, 'dry', (e ->> 'amount')::numeric, e ->> 'currency', (e ->> 'paid_by')::uuid,
            case when jsonb_typeof(e -> 'payers') = 'object' then e -> 'payers' end,
            array(select x::uuid from jsonb_array_elements_text(e -> 'split_among') x), 'other', current_date, (g -> 'people' ->> 0)::uuid);
  end loop;
  for s in select value from jsonb_array_elements(g -> 'settles') loop
    insert into settlements (flat_id, from_user, to_user, amount, currency, settled_on)
    values (gid, (s ->> 'from_user')::uuid, (s ->> 'to_user')::uuid, (s ->> 'amount')::numeric, s ->> 'currency', current_date);
  end loop;
  for u in select jsonb_array_elements_text(g -> 'people') loop
    set local role authenticated; perform pg_temp.jwt(u);
    select coalesce(jsonb_object_agg(c, o), '{{}}') into got from (
      select x.currency c, jsonb_object_agg(x.person::text, x.minor) o from my_pairwise() x where x.place = gid group by x.currency) z;
    feed := feed + (select count(*) from splitlife_feed() f where f.place = gid);
    reset role; perform pg_temp.jwt(null);
    checked := checked + 1;
    if got is distinct from coalesce(g -> 'expect' -> u, '{{}}') then
      bad := bad + 1;
      if bad <= 3 then r := r || jsonb_build_object('mismatch_' || bad, jsonb_build_object('want', g -> 'expect' -> u, 'got', got)); end if;
    end if;
  end loop;
end loop;
r := r || jsonb_build_object('people_checked', checked, 'mismatches', bad, 'feed_rows', feed,
  'real_balances_changed', (select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6)));
raise exception 'DRYRUN %', r;
end $dry$;"""
out = pathlib.Path(sys.argv[1]); out.write_text(sql); print(len(sql), 'bytes')
