#!/usr/bin/env python3
"""Rehearse the bills and chores migration (20261002000000_bills_and_chores.sql) against
the real database without changing it — the same method as rehearse_friends.py.

One DO block: snapshots every real person's flat_balance, runs the migration, builds
throwaway accounts and groups, exercises bills, ticks, contracts, the chores rota,
skips, swaps, points and the reminders — as the server and as signed-in people
(through RLS and grants) on pinned days (heimat.today) — and ends with RAISE
EXCEPTION, so everything, migration included, rolls back. Queued pushes are read
from net.http_request_queue before they roll back with the rest.

  python3 supabase/tests/rehearse_bills_chores.py /tmp/bc.sql
  → run its contents with the Supabase MCP execute_sql; every entry must equal
    /tmp/bc.sql.expect.json, balances_changed 0."""
import sys, pathlib, hashlib, json

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = (ROOT / 'supabase/migrations/20261002000000_bills_and_chores.sql').read_text()
assert '$mig$' not in MIG and '$dry$' not in MIG
MIGS = '\n'.join(l.strip() for l in MIG.split('\n') if l.strip() and not l.strip().startswith('--'))

tests, expect = [], {}

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

def fails(name, body, pattern):
    expect[name] = 'ok'
    tests.append(f"""
  begin
{body}
    r := r || jsonb_build_object('{name}', 'FAIL: no error');
  exception when others then
    r := r || jsonb_build_object('{name}', case when sqlerrm like {q(pattern)} then 'ok' else 'FAIL: ' || sqlerrm end);
  end;""")

def as_user(u, body):
    return f"""    set local role authenticated; perform pg_temp.jwt({u});
{body}
    reset role; perform pg_temp.jwt(null);"""

def day(d):
    return f"    perform set_config('heimat.today', '{d}', true);"

def bill_state(u, b):  # what my_bills says about bill b, for u
    return as_user(u, f"    select coalesce(string_agg(x.state || ' ' || x.due_on || coalesce(' by=' || (x.paid_by = B), ''), ';'), 'none') into tt from my_bills() x where x.bill_id = {b};")

def turns(u, c):  # my_chores for chore c: n:assignee-letter:state, current and next
    return as_user(u, f"    select string_agg(x.n || ':' || pg_temp.who(x.assignee) || ':' || x.state, ' ' order by x.n) into tt from my_chores() x where x.chore_id = {c};")

def queued(cond):
    return f"(select count(*) from net.http_request_queue hq, lateral (select convert_from(hq.body, 'UTF8')::jsonb as bq) x where hq.id > q0 and {cond})"

fixtures = """
  insert into auth.users (id, email, aud, role, email_confirmed_at)
    select uid_, ('dryrun-' || uid_ || '@example.invalid'), 'authenticated', 'authenticated', now() from unnest(array[A, B, C, Z]) uid_;
  insert into flats (id, name, join_code, created_by, kind) values
    (F, 'dryflat', upper('DRF' || substr(md5(F::text), 1, 7)), A, 'flat'),
    (G, 'drycircle', upper('DRC' || substr(md5(G::text), 1, 7)), A, 'direct');
  insert into flat_members (flat_id, user_id, display_name, claimed_at) values
    (F, A, 'Ann', now()), (F, B, 'Bea', now()), (F, C, 'Cy', now()), (G, A, 'Ann', now()), (G, B, 'Bea', now());
  execute format('create function pg_temp.who(u uuid) returns text language sql as $w$ select case when u is null then %L when u = %L::uuid then %L when u = %L::uuid then %L when u = %L::uuid then %L when u = %L::uuid then %L else %L end $w$',
                 '-', A, 'A', B, 'B', C, 'C', Z, 'Z', '?');
  select coalesce(max(id), 0) into q0 from net.http_request_queue;
"""

# ----------------------------------------------------------------- dates
ok('occ_month_end', "", "occurrence_on('2026-01-31', 'monthly', '2026-02-28') || ',' || occurrence_on('2026-01-31', 'monthly', '2026-02-27') || ',' || occurrence_on('2026-01-31', 'monthly', '2026-03-31')", '1,0,2')
ok('occ_before', "", "occurrence_on('2026-10-01', 'weekly', '2026-09-30') || ',' || occurrence_on('2026-10-01', 'weekly', '2026-10-14') || ',' || occurrence_on('2026-10-01', 'yearly', '2027-10-01')", '-1,1,1')
ok('occ_quarter', "", "occurrence_on('2026-01-15', 'quarterly', '2026-07-14') || ',' || occurrence_on('2026-01-15', 'quarterly', '2026-07-15')", '1,2')

# ----------------------------------------------------------------- bills
ok('bill_shared', as_user('A', "    insert into bills (flat_id, name, amount, anchor_on, payer) values (F, '  Rent ', 900, '2026-10-01', B) returning id into b1;"),
   "(select name || ' by=' || (created_by = A) || ' ' || cadence from bills where id = b1)", 'Rent by=true monthly')
ok('bill_hidden_from_outsider', as_user('Z', "    select count(*) into cnt from bills where id = b1;"), "cnt", 0)
fails('bill_outsider_cannot_add', as_user('Z', "    insert into bills (flat_id, name, anchor_on) values (F, 'x', '2026-10-01');"), '%row-level security%')
fails('bill_payer_outsider', as_user('A', "    insert into bills (flat_id, name, anchor_on, payer) values (F, 'x', '2026-10-01', Z);"), 'bills: who pays it must be in the group')
fails('bill_not_in_circle', as_user('A', "    insert into bills (flat_id, name, anchor_on) values (G, 'x', '2026-10-01');"), 'bills: bills belong to a group')
fails('bill_needs_name', as_user('A', "    insert into bills (flat_id, name, anchor_on) values (F, '   ', '2026-10-01');"), 'bills: give it a name%')
ok('bill_personal', as_user('A', "    insert into bills (owner_id, name, amount, anchor_on, payer) values (A, 'Phone', 20, '2026-10-01', B) returning id into b2;"),
   "(select (payer = A)::text from bills where id = b2)", 'true')
ok('bill_personal_hidden', as_user('B', "    select count(*) into cnt from bills where id = b2;"), "cnt", 0)
fails('bill_personal_for_someone_else', as_user('A', "    insert into bills (owner_id, name, anchor_on) values (B, 'x', '2026-10-01');"), '%row-level security%')
fails('bill_cannot_move', as_user('A', "    update bills set flat_id = null, owner_id = A where id = b1;"), 'bills: a bill stays where it was made')
ok('bill_due_today', day('2026-10-01') + "\n" + bill_state('A', 'b1'), "tt", 'due 2026-10-01')
ok('bill_overdue', day('2026-10-05') + "\n" + bill_state('A', 'b1'), "tt", 'overdue 2026-10-01')
ok('bill_tick', as_user('B', "    perform tick_bill(b1, '2026-10-01');") + "\n" + bill_state('A', 'b1'), "tt", 'paid 2026-11-01 by=true')
ok('bill_tick_twice_is_fine', as_user('A', "    perform tick_bill(b1, '2026-10-01');"), "(select count(*) || ' ' || bool_and(paid_by = B) from bill_payments where bill_id = b1)", '1 true')
ok('bill_overdue_stays', day('2026-12-02') + "\n" + bill_state('A', 'b1'), "tt", 'overdue 2026-11-01 by=true')
fails('bill_tick_wrong_day', as_user('A', "    perform tick_bill(b1, '2026-11-15');"), 'bills: that is not one of its due dates')
fails('bill_tick_too_early', as_user('A', "    perform tick_bill(b1, '2027-02-01');"), 'bills: that is not one of its due dates')
ok('bill_tick_ahead', as_user('A', "    perform tick_bill(b1, '2026-11-01'); perform tick_bill(b1, '2026-12-01'); perform tick_bill(b1, '2027-01-01');") + "\n" + bill_state('B', 'b1'),
   "tt", 'paid 2027-02-01 by=false')
ok('bill_untick', as_user('B', "    perform tick_bill(b1, '2026-12-01', false);") + "\n" + bill_state('B', 'b1'), "tt", 'overdue 2026-12-01 by=false')
fails('bill_outsider_cannot_tick', as_user('Z', "    perform tick_bill(b1, '2026-12-01');"), 'bills: that bill is not yours to tick')
fails('bill_no_direct_ticks', as_user('A', "    insert into bill_payments (bill_id, due_on) values (b1, '2026-12-01');"), 'permission denied%')
ok('bill_contract', as_user('A', "    insert into bills (flat_id, name, anchor_on, payer, contract_ends_on, notice_amount, notice_unit) values (F, 'Internet', '2026-10-15', A, '2027-03-31', 3, 'month') returning id into b3;")
   + "\n" + as_user('B', "    select cancel_by::text into tt from my_bills() where bill_id = b3;"), "tt", '2026-12-31')
ok('bill_contract_weeks', "", "bill_cancel_by(row(null, null, null, null, 'x', null, 'EUR', 'other', 'monthly', '2026-01-01', null, '2026-06-30', 2, 'week', null, now())::bills)::text", '2026-06-16')
ok('bill_notice_needs_end', as_user('A', "    insert into bills (flat_id, name, anchor_on, notice_amount, notice_unit) values (F, 'Gym', '2026-10-01', 1, 'month') returning id into t;"),
   "(select coalesce(notice_amount::text, 'none') from bills where id = t)", 'none')

# ----------------------------------------------------------------- bill reminders
ok('remind_bill_due', day('2026-11-01') + "\n    perform run_reminders(); perform run_reminders();",
   queued("bq ->> 'event' = 'reminder' and bq ->> 'to_user' = B::text and bq ->> 'title' = 'Pay Rent today'") + " || ' ' || "
   + queued("bq ->> 'event' = 'reminder' and bq ->> 'to_user' = A::text and bq ->> 'title' = 'Pay Phone today'"), '0 1')
ok('remind_bill_due_when_unticked', day('2026-12-01') + "\n    perform run_reminders();",
   queued("bq ->> 'to_user' = B::text and bq ->> 'title' = 'Pay Rent today'") + " || ' ' || "
   + queued("bq ->> 'to_user' = B::text and bq ->> 'message' like '900,00 EUR · dryflat%'"), '1 1')
ok('remind_cancel_4w', day('2026-12-03') + "\n    perform run_reminders(); perform run_reminders();",
   queued("bq ->> 'to_user' = A::text and bq ->> 'title' = 'Internet: cancel by 31.12.2026'"), 1)
ok('remind_cancel_1w', day('2026-12-24') + "\n    perform run_reminders();",
   queued("bq ->> 'title' = 'Internet: cancel by 31.12.2026'"), 2)
ok('remind_archived_quiet', "    update bills set archived_at = now() where id = b2;\n" + day('2027-01-01') + "\n    perform run_reminders();",
   queued("bq ->> 'title' = 'Pay Phone today' and bq ->> 'to_user' = A::text"), 2)

# ----------------------------------------------------------------- chores
fails('chore_outsider_on_rota', as_user('A', "    insert into chores (flat_id, name, anchor_on, rota) values (F, 'x', '2026-10-05', array[A, Z]);"), 'chores: everyone on the rota must be in the group')
fails('chore_empty_rota', as_user('A', "    insert into chores (flat_id, name, anchor_on, rota) values (F, 'x', '2026-10-05', '{}');"), 'chores: choose who takes part')
fails('chore_not_in_circle', as_user('A', "    insert into chores (flat_id, name, anchor_on, rota) values (G, 'x', '2026-10-05', array[A]);"), 'chores: chores belong to a group')
fails('chore_outsider_cannot_add', as_user('Z', "    insert into chores (flat_id, name, anchor_on, rota) values (F, 'x', '2026-10-05', array[A]);"), '%row-level security%')
ok('chore_new', as_user('A', "    insert into chores (flat_id, name, anchor_on, points, rota) values (F, 'Bathroom', '2026-10-05', 2, array[A, B, A, C]) returning id into c1;"),
   "(select array_length(rota, 1) from chores where id = c1)", 3)
ok('chore_turns_first', day('2026-10-05') + "\n" + turns('B', 'c1'), "tt", '0:A:open 1:B:open')
ok('chore_before_start', day('2026-10-01') + "\n" + turns('B', 'c1') + "\n" + day('2026-10-05'), "tt", '0:A:open 1:B:open')
fails('chore_outsider_cannot_tick', as_user('Z', "    perform chore_tick(c1, 0);"), 'chores: that chore is not in your group')
fails('chore_next_not_started', as_user('B', "    perform chore_tick(c1, 1);"), "chores: that turn hasn't started yet")
ok('chore_tick_and_undo', as_user('B', "    perform chore_tick(c1, 0); select pg_temp.who(done_by) || points into tt from chore_turns where chore_id = c1 and n = 0; perform chore_tick(c1, 0, false);"),
   "tt || ' ' || (select state from chore_turns where chore_id = c1 and n = 0)", 'B2 open')
fails('chore_skip_not_mine', as_user('B', "    perform chore_skip(c1, 0);"), 'chores: only an open turn of yours can be skipped')
ok('chore_skip', as_user('A', "    perform chore_skip(c1, 0);") + "\n" + turns('C', 'c1'),
   "tt || ' push=' || " + queued("bq ->> 'event' = 'reminder' and bq ->> 'to_user' = B::text and bq ->> 'title' = 'Bathroom' and bq ->> 'message' like 'Ann skipped%'"), '0:B:open 1:A:open push=1')
ok('chore_swap_ask', as_user('B', "    select chore_swap_ask(c1, 0, C) into s1;"),
   queued("bq ->> 'to_user' = C::text and bq ->> 'message' = 'Bea asks if you can take their turn'"), 1)
fails('chore_swap_wrong_person_answers', as_user('A', "    perform chore_swap_answer(s1, true);"), "chores: that request isn't for you")
ok('chore_swap_accept', as_user('C', "    perform chore_swap_answer(s1, true);") + "\n" + turns('A', 'c1'),
   "tt || ' push=' || " + queued("bq ->> 'to_user' = B::text and bq ->> 'message' = 'Cy will take your turn'"), '0:C:open 1:A:open push=1')
fails('chore_swap_answer_twice', as_user('C', "    perform chore_swap_answer(s1, false);"), 'chores: that request has already been answered')
fails('chore_swap_ask_self', as_user('C', "    perform chore_swap_ask(c1, 0, C);"), 'chores: ask someone in the group')
ok('chore_swap_decline', as_user('C', "    select chore_swap_ask(c1, 0, B) into s1;") + "\n" + as_user('B', "    perform chore_swap_answer(s1, false);") + "\n" + turns('A', 'c1'), "tt", '0:C:open 1:A:open')
ok('chore_swap_stale', as_user('C', "    select chore_swap_ask(c1, 0, B) into s1; perform chore_tick(c1, 0);")
   + "\n    begin\n" + as_user('B', "    perform chore_swap_answer(s1, true);") + "\n    exception when others then tt := sqlerrm; end;",
   "tt || ' ' || (select answer from chore_swaps where id = s1)", 'chores: that request has already been answered withdrawn')
ok('chore_points', "", "(select pg_temp.who(done_by) || ':' || points from chore_turns where chore_id = c1 and n = 0)", 'C:2')
ok('chore_next_week', day('2026-10-12') + "\n" + turns('A', 'c1'), "tt", '1:A:open 2:C:open')
ok('chore_missed', day('2026-10-19') + "\n" + turns('A', 'c1'),
   "tt || ' ' || (select state from chore_turns where chore_id = c1 and n = 1)", '2:C:open 3:A:open missed')
ok('chore_leaver_passed_over', "    update flat_members set left_at = now() where flat_id = F and user_id = C;\n" + day('2026-10-26') + "\n" + turns('A', 'c1'),
   "tt", '3:A:open 4:A:open')
ok('chore_rota_change_redoes_open', as_user('A', "    update chores set rota = array[B, A] where id = c1;") + "\n" + turns('A', 'c1'), "tt", '3:A:open 4:B:open')
ok('chore_done_kept', "", "(select count(*) from chore_turns where chore_id = c1 and state = 'done')", 1)

# ----------------------------------------------------------------- chore reminders
ok('remind_chore_start', day('2026-10-26') + "\n    perform run_reminders(); perform run_reminders();",
   queued("bq ->> 'to_user' = A::text and bq ->> 'title' = 'Your turn: Bathroom'"), 1)
ok('remind_chore_last', day('2026-11-01') + "\n    perform run_reminders();",
   queued("bq ->> 'to_user' = A::text and bq ->> 'title' = 'Bathroom is still open'"), 1)
ok('chore_archived_turns_go', as_user('A', "    update chores set archived_at = now() where id = c1;"),
   "(select count(*) from chore_turns where chore_id = c1 and state = 'open') || ' ' || (select count(*) from chore_turns where chore_id = c1)", '0 3')
fails('chore_no_direct_turns', as_user('A', "    update chore_turns set state = 'done' where chore_id = c1;\n    get diagnostics cnt = row_count; if cnt = 0 then raise exception 'nothing changed'; end if;"), 'permission denied%')

ok('balances_changed', "", "(select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6))", 0)

vars_uuid = ['A', 'B', 'C', 'Z', 'F', 'G']
declares = "\n".join(f"  {i} uuid := gen_random_uuid();" for i in vars_uuid)
fx = fixtures


script = f"""do $dry$
declare
  r jsonb := '{{}}';
{declares}
  b1 uuid; b2 uuid; b3 uuid; c1 uuid; s1 uuid; t uuid; tt text; cnt bigint; q0 bigint;
  mig text := $mig${MIGS}$mig$;
begin
  create temp table dry_bal on commit drop as
    select m.flat_id, m.user_id, public.flat_balance(m.flat_id, m.user_id) as bal from flat_members m;
  r := r || jsonb_build_object('mig_md5', md5(mig));
  execute mig;
  create function pg_temp.jwt(u uuid) returns void language plpgsql as
    $j$ begin perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true); end $j$;
{fx}
{''.join(tests)}

  raise exception 'DRYRUN %', r;
end $dry$;
"""
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'bills-chores-rehearsal.sql')
script = '\n'.join(l.strip() for l in script.split('\n') if l.strip())
out.write_text(script)
print(len(script), 'bytes,', len(tests), 'tests ->', out, ' migration md5', hashlib.md5(MIGS.encode()).hexdigest())
pathlib.Path(str(out) + '.expect.json').write_text(json.dumps(expect, indent=1, default=str))
