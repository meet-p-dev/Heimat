#!/usr/bin/env python3
"""Rehearse the friends migration (20261001000000_friends.sql) against the real database
without changing it — the same method as rehearse_engine_v2.py.

One DO block: snapshots every real person's flat_balance, runs the migration, builds
throwaway accounts, flats, groups, circles and expenses, exercises the scenarios below
as the server and as signed-in people (through RLS and grants), and ends with RAISE
EXCEPTION, so everything — migration included — rolls back. Results come back as JSON
in the error; `mig_md5` must equal the md5 printed here. Queued pushes and emails are
read from net.http_request_queue before they roll back with the rest.

  python3 supabase/tests/rehearse_friends.py /tmp/friends.sql
  → run its contents with the Supabase MCP execute_sql; every entry must be "ok" or the
    figure noted beside it in the summary at the end, backfill_balances_changed 0."""
import sys, pathlib, hashlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = (ROOT / 'supabase/migrations/20261001000000_friends.sql').read_text()
assert '$mig$' not in MIG and '$dry$' not in MIG
MIGS = '\n'.join(l.strip() for l in MIG.split('\n') if l.strip() and not l.strip().startswith('--'))

tests = []
expect = {}

def ok(name, body, result, want='ok'):
    """body runs; result (a SQL expression) is stored under name; want is what it should be"""
    expect[name] = want
    tests.append(f"""
  begin
{body}
    r := r || jsonb_build_object('{name}', {result});
  exception when others then
    r := r || jsonb_build_object('{name}', 'ERR: ' || sqlerrm);
  end;""")

def fails(name, body, pattern):
    """body must raise an error whose message matches the LIKE pattern"""
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

def q(s):
    return "'" + s.replace("'", "''") + "'"

def em(u):  # a throwaway address for a person
    return f"('dryrun-' || {u} || '@example.invalid')"

def check(cond):  # 'ok' when cond holds, else what it was
    return f"case when {cond} then 'ok' else 'FAIL' end"

def people(*ps):  # jsonb list of {"user_id"} / {"email","name"}
    parts = []
    for p in ps:
        if p.startswith('mail:'):
            who, _, name = p[5:].partition('/')
            parts.append(f"jsonb_build_object('email', {em(who)}, 'name', {q(name or who)})")
        else:
            parts.append(f"jsonb_build_object('user_id', {p})")
    return 'jsonb_build_array(' + ', '.join(parts) + ')'

def exp(amount, paid, among, typ='equal', split='null', payers='null', cur="'EUR'", desc='dry'):
    return (f"jsonb_build_object('description', {q(desc)}, 'amount', {amount}, 'currency', {cur}, 'paid_by', {paid}, "
            f"'split_among', to_jsonb({among}::uuid[]), 'split_type', '{typ}', 'split', {split}, 'payers', {payers}, "
            f"'category', 'food', 'spent_on', current_date)")

def save(var, e, ppl, ex):  # select save_friend_expense into a variable
    return f"    select * into {var} from save_friend_expense({e}, {ppl}, {ex});"

def sh(e, u):
    return f"(select shares ->> {u}::text from expenses where id = {e})"

def queued(cond):  # requests queued for pg_net since the fixtures, matching cond on the body (named bq: b would be B)
    return f"(select count(*) from net.http_request_queue hq, lateral (select convert_from(hq.body, 'UTF8')::jsonb as bq) x where hq.id > q0 and {cond})"

def members(f):  # the circle's people, sorted, as text
    return f"(select string_agg(user_id::text, ',' order by user_id) from flat_members where flat_id = {f})"

def ids(*us):
    return "(select string_agg(uu::text, ',' order by uu) from unnest(array[" + ', '.join(us) + "]::uuid[]) uu)"

# ----------------------------------------------------------------- real data untouched
ok('backfill_balances_changed',  "", "(select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6))", 0)
ok('kinds', "", "(select string_agg(distinct kind, ',' order by kind) from flats where id <> all(array[F, G]))", 'flat (or flat,group)')

# A, B, Z: Heimat accounts. C: confirmed, but only on MoneyTrack. U: Heimat, address not confirmed.
fixtures = f"""
  insert into auth.users (id, email, aud, role, email_confirmed_at)
    select uid_, ('dryrun-' || uid_ || '@example.invalid'), 'authenticated', 'authenticated', now() from unnest(array[A, B, Z, C]) uid_;
  insert into auth.users (id, email, aud, role) values (U, {em('U')}, 'authenticated', 'authenticated');
  insert into app_users (user_id, app, display_name) values (A, 'heimat', 'Ann'), (B, 'heimat', 'Bea'), (Z, 'heimat', 'Zed'), (U, 'heimat', 'Uma');
  insert into flats (id, name, join_code, created_by, kind) values
    (F, 'dryflat', upper('DRF' || substr(md5(F::text), 1, 7)), A, 'flat'),
    (G, 'drygroup', upper('DRG' || substr(md5(G::text), 1, 7)), A, 'group');
  insert into flat_members (flat_id, user_id, display_name, claimed_at) values
    (F, A, 'Ann', now()), (F, B, 'Bea', now()), (G, A, 'Ann', now()), (G, B, 'Bea', now());
  select coalesce(max(id), 0) into q0 from net.http_request_queue;
"""

# ----------------------------------------------------------------- looking people up
ok('find_heimat', as_user('A', f"    select to_jsonb(x) into v from find_person({em('B')}) x;"), "v::text", '{"name": "Bea", "on_heimat": true}')
ok('find_moneytrack_only', as_user('A', f"    select to_jsonb(x) into v from find_person({em('C')}) x;"), "v ->> 'on_heimat'", 'false')
ok('find_unconfirmed', as_user('A', f"    select to_jsonb(x) into v from find_person({em('U')}) x;"), "v ->> 'on_heimat'", 'false')
ok('find_unknown', as_user('A', "    select to_jsonb(x) into v from find_person('nobody-' || gen_random_uuid() || '@example.invalid') x;"), "v ->> 'on_heimat'", 'false')
fails('find_bad_email', as_user('A', "    perform find_person('not an email');"), 'Enter a valid email%')
fails('find_anon_refused', "    perform find_person('x@example.invalid');", 'Not signed in')
fails('find_rate_limited', as_user('Z', "    for i_ in 1..61 loop perform find_person('x' || i_ || '@example.invalid'); end loop;"), 'Too many look-ups%')

# ----------------------------------------------------------------- circles
ok('circle_new', as_user('A', f"    select id into c1 from friend_circle({people('B')});"),
   f"(select kind from flats where id = c1) || ' ' || ({members('c1')} = {ids('A', 'B')}) || ' claimed=' || (select bool_and(claimed_at is not null) from flat_members where flat_id = c1)",
   'direct true claimed=true')
ok('circle_found_again', as_user('A', f"    select id into t from friend_circle({people('B')});"), check("t = c1"))
ok('circle_by_email', as_user('A', f"    select id into t from friend_circle({people('mail:B')});"), check("t = c1"))
ok('circle_from_other_side', as_user('B', f"    select id into t from friend_circle({people('A')});"), check("t = c1"))
ok('circle_skips_me', as_user('A', f"    select id into t from friend_circle(jsonb_build_array(jsonb_build_object('user_id', A), jsonb_build_object('user_id', B)));"), check("t = c1"))
fails('circle_stranger', as_user('A', f"    perform friend_circle({people('Z')});"), 'friends: not someone you know%')
fails('circle_empty', as_user('A', "    perform friend_circle('[]'::jsonb);"), 'friends: choose%')
fails('circle_only_me', as_user('A', f"    perform friend_circle({people('A')});"), 'friends: choose%')
fails('circle_bad_email', as_user('A', "    perform friend_circle(jsonb_build_array(jsonb_build_object('email', 'nope')));"), 'Enter a valid email%')
ok('circle_moneytrack_is_invited', as_user('A', f"    select id into c3 from friend_circle({people('mail:C/Cy')});"),
   "(select count(*) from flat_members where flat_id = c3 and user_id <> A and claimed_at is null and invite_email is not null and user_id <> C) || ' name=' || (select display_name from flat_members where flat_id = c3 and user_id <> A)",
   '1 name=Cy')

# ----------------------------------------------------------------- expenses with friends
ok('save_new', as_user('A', save('ex', 'e1', people('B'), exp(30, 'A', 'array[A, B]'))),
   f"(ex.flat_id = c1) || ' ' || {sh('e1','A')} || '/' || {sh('e1','B')} || ' by=' || (ex.created_by = A)", 'true 1500/1500 by=true')
ok('save_new_pushes_B', "", queued("bq ->> 'event' = 'expense_added' and bq ->> 'flat_id' = c1::text and bq -> 'shares' ->> B::text = '1500'"), 1)
ok('save_new_in_feed', "", "(select count(*) from activity where flat_id = c1 and kind = 'expense_added')", 1)
ok('B_sees_it', as_user('B', "    select count(*) into cnt from expenses where id = e1;"), "cnt", 1)
ok('Z_cannot_see_it', as_user('Z', "    select count(*) into cnt from expenses where id = e1;"), "cnt", 0)
ok('save_exact_several_payers', as_user('A', save('ex', 'e2', people('B'),
     exp(30, 'A', 'array[]', 'exact', "jsonb_build_object('values', jsonb_build_object(A::text, 1000, B::text, 2000))",
         "jsonb_build_object(A::text, 1000, B::text, 2000)"))),
   f"(ex.flat_id = c1) || ' ' || {sh('e2','A')} || '/' || {sh('e2','B')}", 'true 1000/2000')

# someone not on Heimat: a placeholder, and one email with the expense in it
ok('save_new_person', as_user('A', f"""    select id into c2 from friend_circle({people('mail:N/Nina')});
    select user_id into PN from flat_members where flat_id = c2 and user_id <> A;
{save('ex', 'e3', people('mail:N/Nina'), exp(20, 'A', 'array[A, PN]'))}"""),
   f"(ex.flat_id = c2) || ' ' || {sh('e3','PN')} || ' pending=' || (select count(*) from flat_members where flat_id = c2 and user_id = PN and claimed_at is null and invite_token is not null and invite_queued_at is not null)",
   'true 1000 pending=1')
ok('invite_email_queued', "", queued(f"bq ->> 'kind' = 'direct' and bq ->> 'email' = {em('N')} and bq ->> 'share' = '1000' and bq ->> 'paid' = '0' and bq ->> 'description' = 'dry' and bq ->> 'inviter' = 'Ann'"), 1)
ok('second_expense_no_second_email', as_user('A', save('ex', 'e4', people('mail:N/Nina'), exp(8, 'PN', 'array[A, PN]'))),
   queued(f"bq ->> 'email' = {em('N')}") + " || ' ' || (ex.flat_id = c2)", '1 true')
ok('no_group_style_email_for_circles', "", queued("bq ->> 'event' = 'invited' and coalesce(bq ->> 'kind', '') <> 'direct'"), 0)

# three people, with the same placeholder as before
ok('save_three', as_user('A', save('ex', 'e5', people('B', 'mail:N/Nina'),
     exp(90, 'B', 'array[]', 'percent', "jsonb_build_object('values', jsonb_build_object(A::text, 5000, B::text, 3000, PN::text, 2000))"))),
   f"({members('ex.flat_id')} = {ids('A', 'B', 'PN')}) || ' ' || {sh('e5','A')} || '/' || {sh('e5','B')} || '/' || {sh('e5','PN')} || ' placeholders=' || (select count(distinct user_id) from flat_members where lower(invite_email) = lower({em('N')}))",
   'true 4500/2700/1800 placeholders=1')
ok('three_circle_emails_N_once_more', "", queued(f"bq ->> 'email' = {em('N')}"), 2)
ok('save_three_by_B_finds_it', as_user('B', f"    select id into t from friend_circle({people('A', 'PN')});"), check("t = (select flat_id from expenses where id = e5)"))

ok('preview_circle_invite', "    select invite_token into tx from flat_members where flat_id = (select flat_id from expenses where id = e5) and user_id = PN;",
   "(select flat_kind || ' ' || inviter || ' open=' || open from invite_preview(tx))", 'direct Ann open=true')

# editing who is in it moves it
ok('edit_moves_to_pair', as_user('A', save('ex', 'e5', people('B'), exp(90, 'B', 'array[A, B]'))),
   f"(ex.flat_id = c1) || ' ' || {sh('e5','A')} || '/' || {sh('e5','B')} || ' ' || coalesce({sh('e5','PN')}, '-')", 'true 4500/4500 -')
ok('edit_moved_feed', "", "(select count(*) from activity where flat_id = c1 and kind = 'expense_edited')", 1)
ok('edit_moves_back', as_user('B', save('ex', 'e5', people('A', 'PN'), exp(90, 'B', 'array[A, B, PN]'))),
   f"({members('ex.flat_id')} = {ids('A', 'B', 'PN')}) || ' ' || {sh('e5','PN')}", 'true 3000')
fails('edit_person_not_picked', as_user('A', save('ex', 'e5', people('B'), exp(90, 'B', 'array[A, B, PN]'))), 'split: not_in_flat')
fails('picked_but_not_on_it', as_user('A', save('ex', 'e6', people('B', 'mail:N/Nina'), exp(10, 'A', 'array[A, B]'))), 'friends: someone you picked%')
ok('picked_but_not_on_it_left_nothing', "", "(select count(*) from expenses where id = e6)", 0)
ok('group_expense_made', "    insert into expenses (id, flat_id, description, amount, currency, paid_by, split_among, created_by) values (e7, F, 'flat', 10, 'EUR', A, array[A, B], A);", "(select count(*) from expenses where id = e7)", 1)
fails('edit_group_expense_refused', as_user('A', save('ex', 'e7', people('B'), exp(10, 'A', 'array[A, B]'))), 'friends: this expense belongs to a group%')
ok('group_expense_untouched', "", "(select flat_id = F from expenses where id = e7)", True)
fails('edit_by_outsider', as_user('Z', save('ex', 'e1', people('A'), exp(30, 'A', 'array[A, Z]'))), 'friends: not someone%')
fails('edit_deleted', f"""{as_user('A', "    perform delete_expense(e4);")}
{as_user('A', save('ex', 'e4', people('mail:N/Nina'), exp(8, 'A', 'array[A, PN]')))}""", 'No such expense')
ok('app_insert_into_circle', as_user('B', "    insert into expenses (id, flat_id, description, amount, currency, paid_by, split_among, split_type, split, payers, created_by) values (e8, c1, 'old app', 12, 'EUR', B, array[A, B], 'equal', null, null, B);"),
   f"{sh('e8','A')} || '/' || {sh('e8','B')}", '600/600')
fails('app_insert_stranger_into_circle', as_user('B', "    insert into expenses (id, flat_id, description, amount, currency, paid_by, split_among, created_by) values (e9, c1, 'x', 12, 'EUR', B, array[B, Z], B);"), 'split: not_in_flat')

# ----------------------------------------------------------------- circles stay closed
fails('join_circle_with_code', "    select join_code into tx from flats where id = c1;\n" + as_user('Z', "    perform join_flat(tx, 'Zed');"), 'Invalid flat code')
ok('join_flat_still_works', "    select join_code into tx from flats where id = F;\n" + as_user('Z', "    perform join_flat(tx, 'Zed');"),
   "(select count(*) from flat_members where flat_id = F and user_id = Z and claimed_at is not null)", 1)
fails('invite_into_circle', as_user('A', f"    perform invite_member(c1, {em('Z')}, 'Zed');"), 'Add them to the expense%')
fails('leave_circle', as_user('B', "    perform leave_flat(c1);"), "You can't leave a friend%")
ok('leave_circle_by_delete', as_user('B', "    delete from flat_members where flat_id = c1 and user_id = B;"),
   "(select count(*) from flat_members where flat_id = c1 and user_id = B and left_at is null)", 1)
fails('remove_from_circle', as_user('A', "    perform remove_member(c1, B);"), "Friends can't be removed")
ok('leave_group_still_works', as_user('Z', "    perform leave_flat(F);"), "(select count(*) from flat_members where flat_id = F and user_id = Z)", 0)

# ----------------------------------------------------------------- taking over
# groups and friends share one placeholder per address
ok('group_invite_same_placeholder', as_user('A', f"    select * into fm from invite_member(G, {em('N')}, 'Nina');"), check("fm.user_id = PN and fm.claimed_at is null"))
ok('group_invite_moneytrack_is_placeholder', as_user('A', f"    select * into fm from invite_member(G, {em('C')}, 'Cy');"),
   check(f"fm.user_id <> C and fm.claimed_at is null and fm.user_id = (select user_id from flat_members where flat_id = c3 and user_id <> A)"))
fails('member_cannot_take_others_invite', "    select invite_token into tx from flat_members where flat_id = G and user_id = PN;\n" + as_user('B', "    perform claim_invite(tx);"), "You're already in here%")
ok('member_attempt_changed_nothing', "", "(select count(*) from flat_members where user_id = PN and claimed_at is null)", 3)
# MoneyTrack-only C opens the circle link with the invited address: every place C waits comes along
ok('claim_link_with_address_takes_all', "    select invite_token into tx from flat_members where flat_id = c3 and claimed_at is null;\n" + as_user('C', "    perform claim_invite(tx);"),
   "(select count(*) from flat_members where user_id = C and claimed_at is not null) || ' waiting=' || (select count(*) from flat_members where lower(invite_email) = lower(" + em('C') + ") and claimed_at is null)",
   '2 waiting=0')
# N signs up: nothing is taken over until the address is confirmed
ok('signup_unconfirmed_takes_nothing', f"    insert into auth.users (id, email, aud, role) values (N, {em('N')}, 'authenticated', 'authenticated');",
   "(select count(*) from flat_members where user_id = PN and claimed_at is null)", 3)
ok('unconfirmed_claim_invites_nothing', as_user('N', "    select claim_invites() into cnt;"), "cnt", 0)
ok('link_without_confirmed_address_takes_one', "    select invite_token into tx from flat_members where flat_id = c2 and user_id = PN;\n" + as_user('N', "    perform claim_invite(tx);"),
   "(select count(*) from flat_members where user_id = N) || ' waiting=' || (select count(*) from flat_members where user_id = PN and claimed_at is null)", '1 waiting=2')
ok('confirming_takes_the_rest', "    update auth.users set email_confirmed_at = now() where id = N;",
   "(select count(*) from flat_members where user_id = N and claimed_at is not null) || ' waiting=' || (select count(*) from flat_members where user_id = PN)", '3 waiting=0')
ok('claimed_shares_follow', "", f"{sh('e3','N')} || ' ' || {sh('e5','N')} || ' ' || coalesce({sh('e5','PN')}, '-')", '1000 3000 -')
ok('claimed_circle_found_by_N', as_user('N', f"    select id into t from friend_circle({people('A')});"), check("t = c2"))
ok('N_now_on_heimat_by_email', as_user('B', "    select id into t from friend_circle(" + people('mail:N') + ");"), check(f"({members('t')} = {ids('B', 'N')})"))

# ----------------------------------------------------------------- limits and leftovers
fails('rate_limit_new_people', as_user('Z', "    perform friend_circle((select jsonb_agg(jsonb_build_object('email', 'bulk' || i || '-' || Z || '@example.invalid')) from generate_series(1, 31) i));"), "friends: you've added a lot%")
ok('circle_with_someone_gone_is_not_reused', "    update flat_members set left_at = now() where flat_id = c1 and user_id = B;\n" + as_user('A', f"    select id into t from friend_circle({people('B')});"),
   check("t <> c1 and (select kind from flats where id = t) = 'direct'"))
ok('circles_balance', "", "(select count(*) from flats f where f.kind = 'direct' and f.id in (c1, c2, c3) and (select sum(public.flat_balance_in(f.id, m.user_id, 'EUR')) from flat_members m where m.flat_id = f.id) <> 0)", 0)
# turning it down from the link: out of the equal split, the circle keeps working
ok('decline_from_link', as_user('A', f"""    select id into t from friend_circle({people('mail:W/Wes')});
    select user_id into PN from flat_members where flat_id = t and user_id <> A;
{save('ex', 'e10', people('mail:W/Wes'), exp(10, 'A', 'array[A, PN]'))}""") + "\n    select invite_token into tx from flat_members where flat_id = t and user_id = PN;\n    perform decline_invite(tx);",
   f"(select count(*) from flat_members where flat_id = t and user_id = PN) || ' ' || {sh('e10','A')} || ' ' || (select cardinality(split_among) from expenses where id = e10)", '0 1000 1')
ok('backfill_balances_changed_at_end', "", "(select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6))", 0)

vars_uuid = ['A', 'B', 'C', 'U', 'Z', 'N', 'W', 'F', 'G'] + [f'e{i}' for i in range(1, 11)]
declares = "\n".join(f"  {i} uuid := gen_random_uuid();" for i in vars_uuid)

script = f"""do $dry$
declare
  r jsonb := '{{}}';
{declares}
  c1 uuid; c2 uuid; c3 uuid; t uuid; PN uuid; tx text; v jsonb; cnt bigint; q0 bigint;
  ex expenses; fm flat_members;
  mig text := $mig${MIGS}$mig$;
begin
  create temp table dry_bal on commit drop as
    select m.flat_id, m.user_id, public.flat_balance(m.flat_id, m.user_id) as bal from flat_members m;
  r := r || jsonb_build_object('mig_md5', md5(mig));
  execute mig;
  -- signed in as u (null: nobody)
  create function pg_temp.jwt(u uuid) returns void language plpgsql as
    $j$ begin perform set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true); end $j$;
{fixtures}
{''.join(tests)}

  raise exception 'DRYRUN %', r;
end $dry$;
"""
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'friends-rehearsal.sql')
# indentation means nothing to SQL; dropping it keeps the call small
script = '\n'.join(l.strip() for l in script.split('\n') if l.strip())
out.write_text(script)
print(len(script), 'bytes,', len(tests), 'tests ->', out, ' migration md5', hashlib.md5(MIGS.encode()).hexdigest())
pathlib.Path(str(out) + '.expect.json').write_text(__import__('json').dumps(expect, indent=1, default=str))
