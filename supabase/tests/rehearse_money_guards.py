#!/usr/bin/env python3
"""Rehearse the money guards (20261002030000_money_guards.sql) against the real database
without changing it: one DO block runs the migration, builds a throwaway group with every
split type, several payers and payments, takes places over — onto a new account and onto
one already in the group (a merge) — and checks that nobody's balance moved by a cent.
Then it puts the old, re-splitting share rule back to prove the guard refuses a claim
that would move money, and breaks a bill to prove ledger_audit() finds it. Everything,
migration included, rolls back (RAISE at the end).

  python3 supabase/tests/rehearse_money_guards.py /tmp/mg.sql
  → run its contents with the Supabase MCP execute_sql; compare with /tmp/mg.sql.expect.json"""
import sys, pathlib, json, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
def strip(sql): return '\n'.join(l.strip() for l in sql.split('\n') if l.strip() and not l.strip().startswith('--'))
MIG = strip((ROOT / 'supabase/migrations/20261002030000_money_guards.sql').read_text())
# the share rule from before 20261002020000: equal and adjusted splits re-split on every rename
v2 = (ROOT / 'supabase/migrations/20260925000000_engine_v2.sql').read_text()
OLD_RULE = strip(re.search(r'create or replace function public\.expense_postings\(.*?\$function\$.*?\$function\$;', v2, re.S).group(0))
for s in (MIG, OLD_RULE): assert '$mig$' not in s and '$old$' not in s

expect = {
  'audit_clean_group': 0, 'rename_ok': 'ok', 'rename_a': 'same', 'rename_b': 'same', 'rename_new_holds_old': 'same',
  'merge_ok': 'ok', 'merge_a': 'same', 'merge_b': 'same', 'merge_t_holds_both': 'same', 'merge_places_left': 0,
  'old_rule_refused': 'money_guard', 'old_rule_left_no_trace': 'yes', 'audit_finds_broken_bill': 'shares_sum',
  'real_balances_changed': 0,
}
sql = f"""do $dry$
declare r jsonb := '{{}}';
A uuid := gen_random_uuid(); B uuid := gen_random_uuid(); T uuid := gen_random_uuid(); N uuid := gen_random_uuid(); M uuid := gen_random_uuid();
P uuid := gen_random_uuid(); Q uuid := gen_random_uuid(); W uuid := gen_random_uuid(); F uuid := gen_random_uuid();
tp text := md5(random()::text); tq text := md5(random()::text); tw text := md5(random()::text); i int; e uuid;
bal jsonb; msg text;
begin
create temp table dry_bal on commit drop as select m.flat_id, m.user_id, public.flat_balance(m.flat_id, m.user_id) as bal from flat_members m;
execute $mig${MIG}$mig$;
r := r || jsonb_build_object('real_problems_now', (select coalesce(jsonb_object_agg(kind, cnt), '{{}}') from (select kind, count(*) cnt from ledger_audit() group by kind) y));
create function pg_temp.jwt(u uuid) returns void language plpgsql as $j$ begin perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true); end $j$;
create function pg_temp.bal(f uuid, u uuid) returns jsonb language sql as $b$ select coalesce(jsonb_object_agg(c, public.flat_balance_in(f, u, c)), '{{}}') from (select distinct currency c from expenses where flat_id = f and deleted_at is null union select distinct currency from settlements where flat_id = f) x $b$;
insert into auth.users (id, email, aud, role, email_confirmed_at) select u, 'dryrun-' || u || '@example.invalid', 'authenticated', 'authenticated', now() from unnest(array[A, B, T, N, M]) u;
insert into flats (id, name, join_code, created_by, kind) values (F, 'dryflat', upper('DRG' || substr(md5(F::text), 1, 7)), A, 'flat');
insert into flat_members (flat_id, user_id, display_name, claimed_at) values (F, A, 'Ann', now()), (F, B, 'Bea', now()), (F, T, 'Tom', now());
-- Quin was invited by Tom's own address, so Tom taking it over is a merge (a link-only invite can't be merged)
insert into flat_members (flat_id, user_id, display_name, invite_token, invited_by) values (F, P, 'Pat', tp, A), (F, W, 'Wren', tw, A);
insert into flat_members (flat_id, user_id, display_name, invite_token, invite_email, invited_by) values (F, Q, 'Quin', tq, 'dryrun-' || T || '@example.invalid', A);
-- every split type, odd cents, two currencies; P (taken over by a new account) and Q (merged into Tom) in all of them
for i in 1..8 loop
  insert into expenses (flat_id, description, amount, currency, paid_by, split_among, category, spent_on, created_by)
    values (F, 'eq' || i, 10 + i * 0.01, case when i = 8 then 'CHF' else 'EUR' end, case i % 4 when 0 then P when 1 then Q else A end, array[A, B, T, P, Q], 'food', current_date, A);
end loop;
insert into expenses (flat_id, description, amount, currency, paid_by, split_among, split_type, split, category, spent_on, created_by) values
 (F, 'adj', 25.01, 'EUR', A, array[A, B, P, Q, T], 'adjust', jsonb_build_object('values', jsonb_build_object(B::text, 100, P::text, -50)), 'food', current_date, A),
 (F, 'exact', 30, 'EUR', T, array[A, P, Q], 'exact', jsonb_build_object('values', jsonb_build_object(A::text, 1000, P::text, 1500, Q::text, 500)), 'food', current_date, A),
 (F, 'pct', 19.99, 'EUR', B, array[A, P, Q], 'percent', jsonb_build_object('values', jsonb_build_object(A::text, 3333, P::text, 3333, Q::text, 3334)), 'food', current_date, A),
 (F, 'shr', 17, 'EUR', P, array[A, B, P, Q], 'shares', jsonb_build_object('values', jsonb_build_object(A::text, 1, B::text, 2, P::text, 1.5, Q::text, 0.5)), 'food', current_date, A),
 (F, 'items', 41.37, 'EUR', A, array[A, P, Q, T], 'itemized', jsonb_build_object('items', jsonb_build_array(
     jsonb_build_object('minor', 1299, 'among', jsonb_build_array(A::text, P::text)), jsonb_build_object('minor', 2238, 'among', jsonb_build_array(Q::text, T::text, P::text))),
     'tax', 300, 'tip', 300, 'discount', 0), 'food', current_date, A);
insert into expenses (flat_id, description, amount, currency, paid_by, payers, split_among, category, spent_on, created_by) values
 (F, 'payers', 50, 'EUR', A, jsonb_build_object(A::text, 2000, P::text, 1700, Q::text, 1300), array[A, B, P, Q, T], 'food', current_date, A);
insert into settlements (flat_id, from_user, to_user, amount, currency, settled_on) values
 (F, P, A, 7.5, 'EUR', current_date), (F, B, Q, 3.33, 'EUR', current_date), (F, Q, T, 2, 'EUR', current_date), (F, T, Q, 0.5, 'EUR', current_date);
r := r || jsonb_build_object('audit_clean_group', (select count(*) from ledger_audit() a where a.flat_id = F));
bal := jsonb_build_object('A', pg_temp.bal(F, A), 'B', pg_temp.bal(F, B), 'T', pg_temp.bal(F, T), 'P', pg_temp.bal(F, P), 'Q', pg_temp.bal(F, Q));
-- a takeover onto a brand-new account
begin set local role authenticated; perform pg_temp.jwt(N); perform claim_invite(tp); reset role; perform pg_temp.jwt(null); r := r || '{{"rename_ok":"ok"}}';
exception when others then r := r || jsonb_build_object('rename_ok', sqlerrm); end;
r := r || jsonb_build_object('rename_a', case when pg_temp.bal(F, A) = bal -> 'A' then 'same' else (pg_temp.bal(F, A))::text end,
  'rename_b', case when pg_temp.bal(F, B) = bal -> 'B' then 'same' else (pg_temp.bal(F, B))::text end,
  'rename_new_holds_old', case when pg_temp.bal(F, N) = bal -> 'P' then 'same' else (pg_temp.bal(F, N))::text || ' vs ' || (bal -> 'P')::text end);
-- a takeover onto an account already in the group and on the same bills (a merge)
begin set local role authenticated; perform pg_temp.jwt(T); perform claim_invite(tq); reset role; perform pg_temp.jwt(null); r := r || '{{"merge_ok":"ok"}}';
exception when others then r := r || jsonb_build_object('merge_ok', sqlerrm); end;
r := r || jsonb_build_object('merge_a', case when pg_temp.bal(F, A) = bal -> 'A' then 'same' else (pg_temp.bal(F, A))::text end,
  'merge_b', case when pg_temp.bal(F, B) = bal -> 'B' then 'same' else (pg_temp.bal(F, B))::text end,
  'merge_t_holds_both', case when pg_temp.bal(F, T) = (select jsonb_object_agg(k, coalesce((bal->'T'->>k)::numeric,0) + coalesce((bal->'Q'->>k)::numeric,0)) from jsonb_object_keys(bal->'T') k) then 'same' else (pg_temp.bal(F, T))::text end,
  'merge_places_left', (select count(*) from flat_members where user_id = Q));
-- put the old share rule back: a takeover would re-split equal bills and move cents — the guard must refuse it
execute $old${OLD_RULE}$old$;
insert into expenses (flat_id, description, amount, currency, paid_by, split_among, category, spent_on, created_by)
  select F, 'odd' || g, 10 + g * 0.01, 'EUR', A, array[A, B, W], 'food', current_date, A from generate_series(1, 12) g;
bal := jsonb_build_object('A', pg_temp.bal(F, A), 'W', pg_temp.bal(F, W));
begin set local role authenticated; perform pg_temp.jwt(M); perform claim_invite(tw); reset role; perform pg_temp.jwt(null); r := r || '{{"old_rule_refused":"FAIL: claim went through"}}';
exception when others then r := r || jsonb_build_object('old_rule_refused', case when sqlerrm like 'money_guard:%' then 'money_guard' else sqlerrm end); end;
reset role; perform pg_temp.jwt(null);
r := r || jsonb_build_object('old_rule_left_no_trace', case when pg_temp.bal(F, A) = bal -> 'A' and pg_temp.bal(F, W) = bal -> 'W'
  and (select count(*) from flat_members where user_id = M) = 0 then 'yes' else 'no' end);
-- a broken bill is found by the nightly check
alter table expenses disable trigger expense_postings;
update expenses set shares = jsonb_set(shares, array[A::text], to_jsonb(jint(shares -> A::text) + 1)) where flat_id = F and description = 'odd1';
alter table expenses enable trigger expense_postings;
r := r || jsonb_build_object('audit_finds_broken_bill', (select string_agg(distinct kind, ',') from ledger_audit() a where a.flat_id = F and a.kind <> 'not_zero'));
r := r || jsonb_build_object('real_balances_changed', (select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6)));
raise exception 'DRYRUN %', r;
end $dry$;"""
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'money-guards-rehearsal.sql')
out.write_text(sql)
pathlib.Path(str(out) + '.expect.json').write_text(json.dumps(expect, indent=1))
print(len(sql), 'bytes ->', out)
