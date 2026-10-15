#!/usr/bin/env python3
"""Rehearse 20261017010000_chores_on_the_day.sql against the real database, rolled back (the
method of rehearse_import.py): a chore on its day (its turn is that day only, missed the day
after), the evening-before and morning reminders, other chores unchanged, switching a chore
to its day, and "Remind them" — once a day, never yourself, only while a turn is open.

  python3 supabase/tests/rehearse_chores_on_the_day.py /tmp/ch.sql → run with execute_sql"""
import sys, pathlib, hashlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = (ROOT / 'supabase/migrations/20261017010000_chores_on_the_day.sql').read_text()
MIGS = '\n'.join(l.strip() for l in MIG.split('\n') if l.strip() and not l.strip().startswith('--'))
tests = []
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
def day(d): return f"    perform set_config('heimat.today', '{d}', true);"
def turns(ch): return f"(select string_agg(n || ':' || starts_on || '>' || ends_on || ':' || state || ':' || case assignee when A then 'A' when B then 'B' else '?' end, ' ' order by n) from chore_turns where chore_id = {ch})"
def pushes(cond): return f"(select count(*) from net.http_request_queue hq, lateral (select convert_from(hq.body, 'UTF8')::jsonb as bq) x where hq.id > q0 and {cond})"

ok('setup', as_user('A', "    g := (create_group('Dry WG', 'Ana')).id;") + "\n    select join_code into code from flats where id = g;\n" + as_user('B', "    perform join_flat(code, 'Ben');") + "\n" + day('2026-10-19') + "\n" +
   as_user('A', "    insert into chores (flat_id, name, cadence, anchor_on, points, rota, on_day) values (g, 'Bins', 'weekly', '2026-10-20', 1, array[A, B], true) returning id into ch;\n    insert into chores (flat_id, name, cadence, anchor_on, points, rota) values (g, 'Bathroom', 'weekly', '2026-10-20', 2, array[A, B]) returning id into ch2;\n    perform my_chores();"),
   f"{turns('ch')} || ' | ' || {turns('ch2')}")
ok('evening_before', "    q0 := coalesce((select max(id) from net.http_request_queue), 0);\n    perform run_reminders();",
   pushes("bq ->> 'to_user' = A::text and bq ->> 'title' = 'Tomorrow: Bins'") + " || ' ' || " + pushes("bq ->> 'title' like '%Bathroom%'"))
ok('morning_of', day('2026-10-20') + "\n    q0 := coalesce((select max(id) from net.http_request_queue), 0);\n    perform run_reminders();",
   f"(select string_agg((bq ->> 'title') || ' / ' || (bq ->> 'message'), ' | ') from net.http_request_queue hq, lateral (select convert_from(hq.body, 'UTF8')::jsonb as bq) x where hq.id > q0 and bq ->> 'to_user' = A::text)")
ok('remind_by_ben', "    q0 := coalesce((select max(id) from net.http_request_queue), 0);\n" + as_user('B', "    who := chore_remind(ch);"),
   f"who || ' | ' || (select bq ->> 'message' from net.http_request_queue hq, lateral (select convert_from(hq.body, 'UTF8')::jsonb as bq) x where hq.id > q0 and bq ->> 'to_user' = A::text limit 1)")
fails('remind_twice', as_user('B', "    who := chore_remind(ch);"))
fails('remind_yourself', as_user('A', "    who := chore_remind(ch);"))
fails('remind_outsider', as_user('C', "    who := chore_remind(ch);"))
ok('remind_long_turn', as_user('B', "    who := chore_remind(ch2);"), "who")
ok('missed_next_day', day('2026-10-21') + "\n" + as_user('A', "    perform my_chores();"), turns('ch'))
fails('remind_when_over', as_user('B', "    who := chore_remind(ch);"))
ok('switch_to_its_day', as_user('A', "    update chores set on_day = true where id = ch2;\n    perform my_chores();"), turns('ch2'))
ok('real_balances_changed', "", "(select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6))")

script = f"""do $dry$
declare r jsonb := '{{}}'; A uuid := gen_random_uuid(); B uuid := gen_random_uuid(); C uuid := gen_random_uuid();
  g uuid; ch uuid; ch2 uuid; code text; q0 bigint; who text;
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
