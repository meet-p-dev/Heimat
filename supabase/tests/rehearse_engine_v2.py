#!/usr/bin/env python3
"""Rehearse a money migration against the real database without changing it.

Writes one DO block that (1) snapshots every real person's flat_balance, (2) runs the
migration (engine_v2.sql by default), (3) creates throwaway users, flats, members and
expenses and exercises ~70 scenarios as the server and as signed-in members, and
(4) ends with RAISE EXCEPTION, so the whole transaction — migration included — is
rolled back. The results come back as JSON in the error message; `mig_md5` must equal
the md5 printed here (proves the text that ran is the file). Pushes queued by pg_net
are rolled back too; realtime never sees an uncommitted transaction.

It takes the same locks as applying the migration, for a second or two.

  python3 supabase/tests/rehearse_engine_v2.py /tmp/rehearsal.sql
  → run the file's contents with the Supabase MCP execute_sql (there is no local psql);
    every entry must be "ok"/the expected figure, and backfill_balances_changed 0.

Gotchas learned the hard way: PL/pgSQL names are case-insensitive (F2 and f2 clash);
a function's own SET clause can't carry a custom setting on Supabase ("permission
denied to set parameter"), so heimat.* flags are set with set_config() in the body."""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = (pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'supabase/migrations/20260925000000_engine_v2.sql').read_text()
assert '$mig$' not in MIG and '$dry$' not in MIG
# whole-line comments and blank lines dropped (nothing inside a statement is touched)
MIGS = '\n'.join(l.strip() for l in MIG.split('\n') if l.strip() and not l.strip().startswith('--'))

tests = []

def ok(name, body, result):
    """body runs; result is a SQL expression stored under name (errors are stored too)"""
    tests.append(f"""
  begin
{body}
    r := r || jsonb_build_object('{name}', {result});
  exception when others then
    r := r || jsonb_build_object('{name}', 'ERR: ' || sqlerrm);
  end;""")

def fails(name, body, pattern):
    """body must raise an error whose message matches the LIKE pattern"""
    tests.append(f"""
  begin
{body}
    r := r || jsonb_build_object('{name}', 'FAIL: no error');
  exception when others then
    r := r || jsonb_build_object('{name}', case when sqlerrm like '{pattern}' then 'ok' else 'FAIL: ' || sqlerrm end);
  end;""")

def as_user(u, body):
    return f"""    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', {u}::text, 'role', 'authenticated')::text, true);
{body}
    reset role;
    perform set_config('request.jwt.claims', '', true);"""

def q(s):  # SQL string literal
    return "'" + s.replace("'", "''") + "'"

def sh(e, u):  # a person's stored share
    return f"(select shares ->> {u}::text from expenses where id = {e})"

# ------------------------------------------------------------ backfill
ok('backfill_balances_changed', "", "(select count(*) from dry_bal b where round(public.flat_balance(b.flat_id, b.user_id), 6) is distinct from round(b.bal, 6))")
ok('backfill_shares_bad', "", "(select count(*) from expenses x where x.flat_id <> all(array[F, F2, F3]) and (x.shares is null or (select coalesce(sum(value::text::bigint), 0) from jsonb_each(x.shares)) <> to_minor(x.amount, x.currency)))")
ok('backfill_equal_rows', "", "(select count(*) from expenses where split_type = 'equal' and split is null and payers is null)")
ok('cron', "", "(select schedule from cron.job where jobname = 'heimat-recurring')")

# ------------------------------------------------------------ fixtures
fixtures = """
  insert into auth.users (id, email, aud, role)
    select u, 'dryrun-' || u || '@example.invalid', 'authenticated', 'authenticated' from unnest(array[A, B, C, D, Y, D2, D3]) u;
  insert into flats (id, name, join_code, created_by) values
    (F, 'dry1', upper('DRY' || substr(md5(F::text), 1, 6)), A), (F2, 'dry2', upper('DRY' || substr(md5(F2::text), 1, 6)), A),
    (F3, 'dry3', upper('DRY' || substr(md5(F3::text), 1, 6)), A);
  insert into flat_members (flat_id, user_id, display_name, claimed_at) values
    (F, A, 'A', now()), (F, B, 'B', now()), (F, C, 'C', now()), (F, Y, 'Y', now()),
    (F2, A, 'A', now()), (F2, B, 'B', now()), (F3, A, 'A', now()), (F3, B, 'B', now());
  insert into flat_members (flat_id, user_id, display_name, invite_email, invite_token) values
    (F, P, 'P', 'dryrun-p-' || P || '@example.invalid', 'tokP' || P),
    (F, P2, 'P2', 'dryrun-p2-' || P2 || '@example.invalid', 'tokP2' || P2),
    (F, Q, 'Q', 'dryrun-q-' || Q || '@example.invalid', 'tokQ' || Q),
    (F, Q2, 'Q2', 'dryrun-q2-' || Q2 || '@example.invalid', 'tokQ2' || Q2),
    (F, P3, 'P3', 'dryrun-p3-' || P3 || '@example.invalid', 'tokP3' || P3),
    (F, P4, 'P4', 'dryrun-p4-' || P4 || '@example.invalid', 'tokP4' || P4),
    (F, P5, 'P5', 'dryrun-p5-' || P5 || '@example.invalid', 'tokP5' || P5),
    (F, P6, 'P6', 'dryrun-p6-' || P6 || '@example.invalid', 'tokP6' || P6),
    (F, P7, 'P7', 'dryrun-p7-' || P7 || '@example.invalid', 'tokP7' || P7);
  select id into pm from flat_members where flat_id = F and user_id = P;
  select id into p2m from flat_members where flat_id = F and user_id = P2;
  select id into qm from flat_members where flat_id = F and user_id = Q;
  select id into q2m from flat_members where flat_id = F and user_id = Q2;
  select id into p3m from flat_members where flat_id = F and user_id = P3;
  select id into p4m from flat_members where flat_id = F and user_id = P4;
  select id into p7m from flat_members where flat_id = F and user_id = P7;
"""

def ins(e, amount, paid, among, typ='equal', split='null', payers='null', cur="'EUR'", flat='F'):
    return f"    insert into expenses (id, flat_id, description, amount, currency, paid_by, split_among, split_type, split, payers) values ({e}, {flat}, 'dry', {amount}, {cur}, {paid}, {among}, '{typ}', {split}, {payers});"

def vals(**kv):  # {"values": {uid: n}}
    inner = ', '.join(f"{k}::text, {v}" for k, v in kv.items())
    return f"jsonb_build_object('values', jsonb_build_object({inner}))"

# ------------------------------------------------------------ old-app guard
ok('pct_insert', ins('e1', 100, 'A', "'{}'", 'percent', vals(A=5000, B=3000, C=2000)),
   f"{sh('e1','A')} || '/' || {sh('e1','B')} || '/' || {sh('e1','C')}")
ok('pct_build8_reordered_edit', """    update expenses set description = 'pct2', amount = 100, paid_by = A,
      split_among = array(select unnest(split_among) order by 1 desc), category = 'other', spent_on = spent_on where id = e1;""",
   f"{sh('e1','A')} || '/' || {sh('e1','B')} || '/' || {sh('e1','C')} || ' ' || (select description from expenses where id = e1)")
fails('pct_build8_drop_person', "    update expenses set split_among = array[A, B] where id = e1;", 'update Heimat%')
ok('pct_build8_amount', "    update expenses set amount = 200, split_among = split_among where id = e1;",
   f"{sh('e1','A')} || '/' || {sh('e1','B')} || '/' || {sh('e1','C')}")
ok('v2_marker_cleared', "", "coalesce(current_setting('heimat.v2_write', true), '') = ''")

ok('exact_insert', ins('e2', 60, 'A', "'{}'", 'exact', vals(A=1000, B=5000)), f"{sh('e2','A')} || '/' || {sh('e2','B')} || ' among=' || (select cardinality(split_among) from expenses where id = e2)")
fails('exact_build8_amount', "    update expenses set amount = 70, split_among = split_among where id = e2;", 'update Heimat%')
ok('exact_v2_amount', f"    update expenses set amount = 70, split_type = 'exact', split = {vals(A=2000, B=5000)} where id = e2;", f"{sh('e2','A')} || '/' || {sh('e2','B')}")

ok('adjust_insert', ins('e3', 50, 'A', 'array[A, B]', 'adjust', vals(A=500)), f"{sh('e3','A')} || '/' || {sh('e3','B')}")
fails('adjust_build8_amount', "    update expenses set amount = 60, paid_by = paid_by, split_among = split_among where id = e3;", 'update Heimat%')
ok('adjust_v2_amount_same_split', "    update expenses set amount = 60, split_type = 'adjust', split = split where id = e3;", f"{sh('e3','A')} || '/' || {sh('e3','B')}")
ok('adjust_v2_add_person', "    update expenses set split_among = array[A, B, C], split_type = split_type, split = split where id = e3;", f"{sh('e3','A')} || '/' || {sh('e3','B')} || '/' || {sh('e3','C')}")

# ------------------------------------------------------------ payers
ok('payers_insert', ins('e4', 60, 'A', 'array[A, B]', payers="jsonb_build_object(A::text, 3000, B::text, 3000)"), "(select payers::text from expenses where id = e4)")
fails('payers_build8_payer', "    update expenses set paid_by = B, amount = amount, split_among = split_among where id = e4;", 'update Heimat%')
fails('payers_build8_amount', "    update expenses set amount = 70, paid_by = paid_by, split_among = split_among where id = e4;", 'update Heimat%')
ok('payers_build8_description', "    update expenses set description = 'x', amount = amount, paid_by = paid_by, split_among = split_among where id = e4;", "(select description from expenses where id = e4)")
ok('payers_v2_change', "    update expenses set paid_by = B, payers = jsonb_build_object(A::text, 1000, B::text, 5000), split_type = 'equal', split = null where id = e4;",
   "(select paid_by = B and payers = jsonb_build_object(A::text, 1000, B::text, 5000) from expenses where id = e4)")
ok('payers_float_normalised', ins('e5', 60, 'A', 'array[A, B]', payers="('{\"' || A || '\": 5000.0, \"' || B || '\": 1000}')::jsonb"),
   "(select (payers ->> A::text) || '/' || (payers ->> B::text) from expenses where id = e5) || ' bal=' || public.flat_balance(F, A)")
fails('payers_not_summing', ins('e6', 60, 'A', 'array[A, B]', payers="jsonb_build_object(A::text, 3000, B::text, 2000)"), 'split: sum_mismatch')
fails('payers_paid_by_missing', ins('e6', 60, 'C', 'array[A, B]', payers="jsonb_build_object(A::text, 3000, B::text, 3000)"), 'split: paid_by must be one of the payers')

# ------------------------------------------------------------ ids, currency, bounds
ok('upper_case_key', ins('e7', 60, 'A', "'{}'", 'exact', f"jsonb_build_object('values', jsonb_build_object(upper(A::text), 6000))"),
   "(select (shares ? A::text) and not (shares ? upper(A::text)) and (split -> 'values') ? A::text and split_among = array[A] from expenses where id = e7)")
fails('bad_key', ins('e8', 60, 'A', "'{}'", 'exact', "jsonb_build_object('values', jsonb_build_object('bob', 6000))"), 'split: bad_value')
fails('stranger_payer', ins('e8', 60, 'X', 'array[A]'), 'split: not_in_flat')
fails('stranger_in_split', ins('e8', 60, 'A', 'array[A, X]'), 'split: not_in_flat')
ok('pending_invitee_allowed', ins('e9', 60, 'A', 'array[A, P]'), f"{sh('e9','P')}")
ok('currency_only_update', ins('e10', 1000, 'A', 'array[A, B]') + "\n    update expenses set currency = 'JPY' where id = e10;", f"{sh('e10','A')} || '/' || {sh('e10','B')}")
fails('currency_only_exact', ins('e11', 10, 'A', "'{}'", 'exact', vals(A=1000)) + "\n    update expenses set currency = 'JPY' where id = e11;", 'split: sum_mismatch')
ok('empty_currency_filled', ins('e12', 10, 'A', 'array[A]', cur="''"), "(select currency from expenses where id = e12)")
ok('lower_currency', ins('e13', 10, 'A', 'array[A]', cur="'chf'"), "(select currency from expenses where id = e13)")
fails('bad_currency', ins('e8', 10, 'A', 'array[A]', cur="'EURO'"), '%expenses_currency_iso%')
ok('adjust_values_null', ins('e14', 10, 'A', 'array[A, B]', 'adjust', "'{\"values\": null}'::jsonb"), f"{sh('e14','A')} || '/' || {sh('e14','B')}")
fails('adjust_cap', ins('e8', 10, 'A', 'array[A, B]', 'adjust', vals(A=100000000001, B=-100000000001)), 'split: bad_value')
fails('itemized_among_null', ins('e8', 10, 'A', "'{}'", 'itemized', "'{\"items\": [{\"minor\": 1000, \"among\": null}]}'::jsonb"), 'split: empty')
fails('split_not_object', ins('e8', 10, 'A', "'{}'", 'exact', "'[1,2]'::jsonb"), 'split: bad_value')
ok('equal_split_cleared', ins('e15', 10, 'A', 'array[A, B]', 'equal', vals(A=5)), "(select split is null from expenses where id = e15)")
fails('settlement_bound', "    insert into settlements (flat_id, from_user, to_user, amount) values (F, A, B, 1000000000);", '%settlements_amount_bound%')

# ------------------------------------------------------------ currency book
ok('flat_currency_ignores_deleted', ins('g1', 30, 'A', 'array[A, B]', flat='F2') + "\n" +
   ins('g2', 50, 'B', 'array[A, B]', cur="'CHF'", flat='F2') + "\n" + ins('g3', 50, 'B', 'array[A, B]', cur="'CHF'", flat='F2') +
   "\n    update expenses set deleted_at = now() where id in (g2, g3);",
   "public.flat_currency(F2) || ' bal=' || public.flat_balance(F2, B)")
ok('settlement_only_flat', "    insert into settlements (flat_id, from_user, to_user, amount, currency) values (F3, A, B, 20, 'SEK');",
   "public.flat_currency(F3) || ' ' || public.flat_balance(F3, A) || '/' || public.flat_balance(F3, B)")

# ------------------------------------------------------------ push payload
ok('push_zero_share', "    select count(*) into n from net.http_request_queue;\n" + ins('e16', 30, 'A', 'array[A, B, C]', 'adjust', vals(C=-1500)),
   "(select (convert_from(body, 'utf8')::jsonb -> 'shares' ->> C::text) || ' ' || (convert_from(body, 'utf8')::jsonb ->> 'currency') from net.http_request_queue order by id desc limit 1)")

# ------------------------------------------------------------ grants (as a signed-in member)
fails('grant_insert_deleted', as_user('A', "    insert into expenses (flat_id, description, amount, currency, paid_by, split_among, created_by, deleted_at) values (F, 'x', 1, 'EUR', A, array[A], A, now());"), 'permission denied%')
ok('grant_build8_insert', as_user('A', "    insert into expenses (id, flat_id, description, amount, currency, paid_by, split_among, category, created_by, spent_on) values (e17, F, 'b8', 9, 'EUR', A, array[A, B], 'other', A, current_date);"), f"{sh('e17','A')} || '/' || {sh('e17','B')}")
ok('grant_build8_update', as_user('A', "    update expenses set description = 'b8u', amount = 12, paid_by = B, split_among = array[B, A], category = 'food', spent_on = current_date where id = e17;"), f"{sh('e17','A')} || '/' || {sh('e17','B')}")
fails('grant_update_recurring_id', as_user('A', "    update expenses set recurring_id = null where id = e17;"), 'permission denied%')
fails('grant_update_flat_id', as_user('A', "    update expenses set flat_id = F2 where id = e17;"), 'permission denied%')
ok('grant_settlement_insert', as_user('A', "    insert into settlements (flat_id, from_user, to_user, amount, currency, created_by, settled_on) values (F, A, B, 5, 'EUR', A, current_date);"), "'ok'")

# ------------------------------------------------------------ soft delete
ok('soft_delete', as_user('A', "    perform delete_expense(e17);\n    select count(*) into n from expenses where id = e17;\n    select count(*) into mm from deleted_expenses(F) z where z.id = e17;"),
   "n || ' visible, kept=' || (select count(*) from expenses where id = e17 and deleted_at is not null) || ' listed=' || mm || ' logged=' || (select count(*) from activity where kind = 'expense_deleted' and meta ->> 'expense' = e17::text)")
ok('restore', as_user('B', "    perform restore_expense(e17);\n    select count(*) into n from expenses where id = e17;"), "n")

# ------------------------------------------------------------ default split
ok('default_split_normalised', as_user('A', f"    perform set_default_split(F, jsonb_build_object('type', 'percent', 'values', jsonb_build_object(upper(A::text), 6000, B::text, 4000)));"),
   "(select (default_split -> 'values') ? A::text from flats where id = F)")
fails('default_split_bad', as_user('A', "    perform set_default_split(F, jsonb_build_object('type', 'percent', 'values', jsonb_build_object(A::text, 6000)));"), 'split: percent_total')

# ------------------------------------------------------------ invites
invite_setup = "\n".join([
    ins('i1', 100, 'A', "'{}'", 'percent', vals(A=5000, P=5000)),
    ins('i2', 60, 'A', 'array[A, B]', payers="jsonb_build_object(A::text, 3000, P::text, 3000)"),
    ins('i3', 10, 'B', 'array[A, P]', 'adjust', vals(A=100)),
    ins('i4', 10, 'A', "'{}'", 'itemized', "jsonb_build_object('items', jsonb_build_array(jsonb_build_object('minor', 1000, 'among', jsonb_build_array(P::text, A::text))))"),
    ins('i5', 20, 'P', 'array[A, P]'),
    "    update expenses set deleted_at = now() where id = i5;",
    "    insert into recurring_expenses (id, flat_id, created_by, amount, currency, paid_by, split_among, cadence, anchor_on) values (r1, F, A, 30, 'EUR', A, array[A, P], 'weekly', current_date + 7);",
    "    update flats set default_split = jsonb_build_object('type', 'percent', 'values', jsonb_build_object(A::text, 5000, P::text, 5000)) where id = F;",
    "    select count(*) into n from activity where flat_id = F and kind = 'expense_edited';",
    "    perform claim_member(pm, D);",
])
ok('claim_rewrites_everything', invite_setup,
   "(select count(*) from expenses where flat_id = F and (paid_by = P or P = any(split_among) or coalesce(payers, '{}') ? P::text or coalesce(shares, '{}') ? P::text or position(P::text in coalesce(split::text, '')) > 0))"
   " || ' left; i1=' || " + sh('i1', 'D') + " || ' i2payer=' || (select payers ->> D::text from expenses where id = i2)"
   " || ' i3=' || " + sh('i3', 'D') + " || ' i4=' || " + sh('i4', 'D') + " || ' i5paid_by=' || (select (paid_by = D)::text from expenses where id = i5)"
   " || ' r1=' || (select (D = any(split_among))::text from recurring_expenses where id = r1)"
   " || ' default=' || (select ((default_split -> 'values') ? D::text)::text from flats where id = F)"
   " || ' member=' || (select count(*) from flat_members where flat_id = F and user_id = D and claimed_at is not null)"
   " || ' newlogs=' || ((select count(*) from activity where flat_id = F and kind = 'expense_edited') - n)"
   " || ' internal=' || coalesce(nullif(current_setting('heimat.internal', true), ''), 'off')")
ok('claim_balances_sum_zero', "", "(select sum(public.flat_balance(F, m.user_id)) from flat_members m where m.flat_id = F)")
ok('claim_fold_into_member', ins('i6', 100, 'A', "'{}'", 'percent', vals(B=5000, P2=5000)) + "\n    perform claim_member(p2m, B);",
   sh('i6', 'B') + " || ' placeholder_rows=' || (select count(*) from flat_members where id = p2m)")
fails('revoke_non_equal', ins('i7', 100, 'A', "'{}'", 'percent', vals(A=5000, Q=5000)) + "\n" + as_user('A', "    perform revoke_invite(qm);"), "%isn''t split equally%")
ok('revoke_equal', ins('i8', 30, 'A', 'array[A, Q2]') + "\n" + as_user('A', "    perform revoke_invite(q2m);"),
   "(select array_to_string(split_among, ',') = A::text and shares = jsonb_build_object(A::text, 3000) from expenses where id = i8)::text || ' member_rows=' || (select count(*) from flat_members where id = q2m)")
ok('has_history_payer_only', ins('i9', 60, 'A', 'array[A]', payers="jsonb_build_object(A::text, 3000, Y::text, 3000)"), "public.has_history(F, Y)")
fails('forget_payer', "    perform forget_member(F, Y);", 'They are down as paying%')

# ------------------------------------------------------------ recurring
fails('rec_backdated', as_user('A', "    insert into recurring_expenses (flat_id, amount, currency, paid_by, split_among, cadence, anchor_on) values (F, 21, 'EUR', A, array[A, B], 'weekly', current_date - 400);"), 'recurring: the first date%')
fails('rec_next_n_denied', as_user('A', "    insert into recurring_expenses (flat_id, amount, currency, paid_by, split_among, cadence, anchor_on, next_n) values (F, 21, 'EUR', A, array[A, B], 'weekly', current_date, 5);"), 'permission denied%')
fails('rec_stranger', as_user('A', "    insert into recurring_expenses (flat_id, amount, currency, paid_by, split_among, cadence, anchor_on) values (F, 21, 'EUR', A, array[A, X], 'weekly', current_date);"), 'split: not_in_flat')
fails('rec_bad_split', as_user('A', "    insert into recurring_expenses (flat_id, amount, currency, paid_by, split_among, split_type, split, cadence, anchor_on) values (F, 21, 'EUR', A, '{}', 'percent', jsonb_build_object('values', jsonb_build_object(A::text, 10)), 'weekly', current_date);"), 'split: percent_total')
ok('rec_create', as_user('A', "    insert into recurring_expenses (flat_id, amount, currency, paid_by, split_among, cadence, anchor_on) values (F, 21, 'EUR', A, array[A, B], 'weekly', current_date - 14) returning id into r2;"),
   "(select (created_by = A)::text from recurring_expenses where id = r2) || ' logged=' || (select count(*) from activity where kind = 'recurring_added' and meta ->> 'recurring' = r2::text)")
ok('rec_generate', "    select count(*) into n from net.http_request_queue;\n    perform generate_recurring();\n    perform generate_recurring();",
   "(select count(*) from expenses where recurring_id = r2) || ' next_n=' || (select next_n from recurring_expenses where id = r2)"
   " || ' pushes=' || ((select count(*) from net.http_request_queue) - n) || ' author=' || (select count(*) from expenses where recurring_id = r2 and created_by = A)")
ok('rec_edit_attribution', as_user('B', "    update recurring_expenses set amount = 30 where id = r2;"),
   "(select (created_by = B)::text from recurring_expenses where id = r2) || ' logged=' || (select count(*) from activity where kind = 'recurring_edited' and meta ->> 'recurring' = r2::text)")
fails('rec_anchor_denied', as_user('B', "    update recurring_expenses set anchor_on = current_date - 300 where id = r2;"), 'permission denied%')
ok('rec_pause_resume', as_user('B', "    update recurring_expenses set active = false where id = r2;\n    update recurring_expenses set active = true where id = r2;"),
   "(select next_n || ' ' || active from recurring_expenses where id = r2) || ' logs=' || (select count(*) from activity where kind in ('recurring_paused', 'recurring_resumed') and meta ->> 'recurring' = r2::text)")
ok('rec_member_left_stops', "    insert into recurring_expenses (id, flat_id, created_by, amount, currency, paid_by, split_among, cadence, anchor_on) values (r3, F, A, 10, 'EUR', A, array[A, C], 'weekly', current_date);\n"
   "    update flat_members set left_at = now() where flat_id = F and user_id = C;\n    perform generate_recurring();",
   "(select active::text from recurring_expenses where id = r3) || ' made=' || (select count(*) from expenses where recurring_id = r3) || ' logged=' || (select count(*) from activity where kind = 'recurring_stopped' and meta ->> 'recurring' = r3::text)")
ok('left_member_old_expense_editable', "    update expenses set description = 'still editable', split_among = split_among where id = e1;", "(select description from expenses where id = e1)")
fails('left_member_new_expense', ins('e8', 60, 'C', 'array[A, B]'), 'split: not_in_flat')
# ------------------------------------------------------------ round-2 fixes
ok('siri_left_member_dropped', ins('e18', 30, 'A', 'array[A, B, C]'), f"{sh('e18','A')} || '/' || {sh('e18','B')} || ' C=' || coalesce({sh('e18','C')}, 'none')")
fails('zero_share_stranger', ins('e8', 0, 'A', 'array[A, X]'), 'split: not_in_flat')
fails('left_member_share_cannot_grow', "    update expenses set amount = 300, split_among = split_among where id = e1;", 'split: not_in_flat')
ok('fold_resplits_and_drops_self_payment', ins('i14', 90, 'A', 'array[A, B, P7]') +
   "\n    insert into settlements (flat_id, from_user, to_user, amount) values (F, P7, B, 10);\n    perform claim_member(p7m, B);",
   "(select (shares ->> A::text) || '/' || (shares ->> B::text) || ' among=' || cardinality(split_among) from expenses where id = i14)"
   " || ' self_payments=' || (select count(*) from settlements where flat_id = F and from_user = to_user)"
   " || ' p7_payments=' || (select count(*) from settlements where flat_id = F and (from_user = P7 or to_user = P7))")
ok('currency_from_flat', "    insert into expenses (id, flat_id, amount, paid_by, split_among) values (e19, F3, 10, A, array[A, B]);",
   "(select currency from expenses where id = e19)")
ok('amount_rounded', ins('e20', '10.005', 'A', 'array[A]'), "(select amount::text from expenses where id = e20)")
fails('restore_onto_left_member', "    update expenses set deleted_at = now() where id = e1;\n" + as_user('A', "    perform restore_expense(e1);"), 'split: not_in_flat')
fails('remove_member_other_currency', ins('g4', 30, 'A', 'array[A, B]', cur="'CHF'", flat='F2') +
      "\n    insert into settlements (flat_id, from_user, to_user, amount, currency) values (F2, B, A, 15, 'EUR');\n" +
      as_user('A', "    perform remove_member(F2, B);"), '%down 15.00 CHF%')
fails('settlement_stranger', "    insert into settlements (flat_id, from_user, to_user, amount) values (F, A, X, 5);", 'split: not_in_flat')
fails('settlement_self', "    insert into settlements (flat_id, from_user, to_user, amount) values (F, A, A, 5);", 'split: bad_value')
ok('settlement_currency_filled', "    insert into settlements (flat_id, from_user, to_user, amount) values (F, A, B, 5) returning currency into t;", "t || ' nulls=' || (select count(*) from settlements where currency is null)")
ok('claim_keeps_cents', ins('i10', '0.10', 'A', "'{}'", 'percent', vals(A=3333, B=3333, P3=3334)) +
   "\n    select shares into v from expenses where id = i10;\n    perform claim_member(p3m, D2);",
   "(select (shares ->> A::text) = (v ->> A::text) and (shares ->> B::text) = (v ->> B::text) and (shares ->> D2::text) = (v ->> P3::text) from expenses where id = i10)")
ok('removed_invite_is_dead', ins('i11', 10, 'A', 'array[A, P4]') + "\n    update expenses set deleted_at = now() where id = i11;\n" +
   as_user('A', "    perform remove_member(F, P4);") + "\n    perform claim_member(p4m, D3);",
   "(select coalesce(left_at is not null, false)::text || ' token=' || coalesce(invite_token, 'null') from flat_members where id = p4m) || ' D3member=' || (select count(*) from flat_members where flat_id = F and user_id = D3)")
ok('decline_always_works', ins('i12', 100, 'A', "'{}'", 'percent', vals(A=5000, P5=5000)) + "\n    perform decline_invite('tokP5' || P5);",
   "(select (left_at is not null)::text || ' token=' || coalesce(invite_token, 'null') from flat_members where flat_id = F and user_id = P5)")
ok('revoke_after_soft_delete', ins('i13', 20, 'P6', 'array[A, P6]') + "\n    update expenses set deleted_at = now() where id = i13;\n" +
   as_user('A', "    perform revoke_invite((select id from flat_members where flat_id = F and user_id = P6));"),
   "(select count(*) from flat_members where flat_id = F and user_id = P6) || ' rows, expense_gone=' || (select count(*) = 0 from expenses where id = i13)")
ok('rejoin_with_code', "    select join_code into t from flats where id = F;\n" + as_user('C', "    perform join_flat(t, 'C');"),
   "(select (left_at is null)::text from flat_members where flat_id = F and user_id = C)")
ok('resume_after_stop_catches_up', as_user('A', "    update recurring_expenses set active = true where id = r3;") + "\n    perform generate_recurring();",
   "(select count(*) from expenses where recurring_id = r3) || ' n=' || (select string_agg(recurring_n::text, ',') from expenses where recurring_id = r3) || ' stopped=' || coalesce((select stopped from recurring_expenses where id = r3), 'null')")
ok('final_balances_sum_zero', "", "(select sum(public.flat_balance(F, m.user_id)) from flat_members m where m.flat_id = F)")

ids = ['e19','e20','i14','e18','g4','i10','i11','i12','i13','e1','e2','e3','e4','e5','e6','e7','e8','e9','e10','e11','e12','e13','e14','e15','e16','e17','g1','g2','g3',
       'i1','i2','i3','i4','i5','i6','i7','i8','i9','r1','r2','r3']
declares = "\n".join(f"  {i} uuid := gen_random_uuid();" for i in ids)

script = f"""do $dry$
declare
  r jsonb := '{{}}';
  A uuid := gen_random_uuid(); B uuid := gen_random_uuid(); C uuid := gen_random_uuid(); D uuid := gen_random_uuid();
  Y uuid := gen_random_uuid(); P uuid := gen_random_uuid(); P2 uuid := gen_random_uuid(); Q uuid := gen_random_uuid();
  Q2 uuid := gen_random_uuid(); X uuid := gen_random_uuid();
  P3 uuid := gen_random_uuid(); P4 uuid := gen_random_uuid(); P5 uuid := gen_random_uuid(); P6 uuid := gen_random_uuid();
  D2 uuid := gen_random_uuid(); D3 uuid := gen_random_uuid(); p3m uuid; p4m uuid; t text; v jsonb;
  P7 uuid := gen_random_uuid(); p7m uuid;
  F uuid := gen_random_uuid(); F2 uuid := gen_random_uuid(); F3 uuid := gen_random_uuid();
  pm uuid; p2m uuid; qm uuid; q2m uuid; n bigint; mm bigint;
{declares}
  mig text := $mig${MIGS}$mig$;
begin
  create temp table dry_bal on commit drop as
    select m.flat_id, m.user_id, public.flat_balance(m.flat_id, m.user_id) as bal from flat_members m;
  r := r || jsonb_build_object('mig_md5', md5(mig));
  execute mig;
{fixtures}
{''.join(tests)}

  raise exception 'DRYRUN %', r;
end $dry$;
"""
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'rehearsal.sql')
out.write_text(script)
import hashlib
print(len(script), 'bytes,', len(tests), 'tests ->', out, ' migration md5', hashlib.md5(MIGS.encode()).hexdigest())
