-- Money guards (docs/money-engine.md, "Server-side rules").
--
-- 1. Taking over a place onto an account that is already on the same expense (a merge)
--    added nobody's shares: the expense was split again among one person fewer, so
--    everyone else on it paid more. The two shares are now added (rekey_uid), like the
--    payers, the split's values and the payments already were.
-- 2. claim_member checks its own work: a snapshot of every balance in the place, in every
--    currency, before and after. Everyone else must be exactly where they were, and the
--    account must hold what it held plus what the place held — otherwise the claim is
--    refused and nothing changes. A future change that moves money by accident fails
--    loudly instead of shifting a cent unseen.
-- 3. ledger_audit(): every way the books can be inconsistent, as rows. A job runs it each
--    night, keeps what it finds in ledger_audit_log and, when app_config.admin_user is
--    set, sends that person a notification.

-- every member's balance in a place, per currency, in minor units: {"<user>|<CUR>": n}
create or replace function public.money_snapshot(p_flat uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  with cur as (
    select distinct currency c from expenses where flat_id = p_flat and deleted_at is null
    union select distinct currency from settlements where flat_id = p_flat
  ), who as (
    select distinct user_id u from flat_members where flat_id = p_flat
  )
  select coalesce(jsonb_object_agg(who.u::text || '|' || cur.c, to_minor(flat_balance_in(p_flat, who.u, cur.c), cur.c)), '{}')
    from who, cur
$function$;

-- what a takeover of f by t moved that it shouldn't have, or null: everyone else unchanged,
-- t now holding t + f
create or replace function public.money_moved(p_before jsonb, p_after jsonb, f text, t text)
returns text
language sql immutable set search_path to 'public'
as $function$
  with k as (
    select distinct split_part(key, '|', 1) u, split_part(key, '|', 2) c
      from (select jsonb_object_keys(p_before) key union select jsonb_object_keys(p_after)) x
  ), want as (
    select u, c,
      case when u = f then 0
           when u = t then coalesce((p_before ->> (t || '|' || c))::numeric, 0) + coalesce((p_before ->> (f || '|' || c))::numeric, 0)
           else coalesce((p_before ->> (u || '|' || c))::numeric, 0) end as n
      from k
  )
  select string_agg(format('%s by %s %s', case when w.u = t then 'the new account' else 'someone else''s balance' end,
                           coalesce((p_after ->> (w.u || '|' || w.c))::numeric, 0) - w.n, w.c), ', ')
    from want w
   where coalesce((p_after ->> (w.u || '|' || w.c))::numeric, 0) <> w.n
$function$;

create or replace function public.claim_member(p_member uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members; existing_id uuid; f text; t text; came_back boolean := false; v_before jsonb; v_bad text;
begin
  select * into m from flat_members where id = p_member;
  -- an invite someone was removed from (kept as left for its history) is dead
  if m.id is null or m.claimed_at is not null or m.left_at is not null or p_uid is null then return; end if;
  f := m.user_id::text; t := p_uid::text;
  -- what everyone in the place has, in every currency, before anything moves
  v_before := money_snapshot(m.flat_id);
  -- (a function's own SET clause can't carry a custom setting on Supabase; if anything
  -- below fails, rolling back restores it, and on success it is cleared at the end)
  perform set_config('heimat.internal', 'on', true);

  select id into existing_id from flat_members
    where flat_id = m.flat_id and user_id = p_uid and id <> m.id limit 1;
  -- the member row first, so they are in the flat by the time their expenses name them
  if existing_id is not null then
    -- already here (or here before, and invited back): one row for them, and they are back
    update flat_members set left_at = null where id = existing_id and left_at is not null;
    came_back := found;   -- log_member records that as 'joined'
  else
    update flat_members set user_id = p_uid, claimed_at = now() where id = m.id;
  end if;

  update expenses e set
      paid_by = case when e.paid_by = m.user_id then p_uid else e.paid_by end,
      split_among = array(select distinct x from unnest(array_replace(e.split_among, m.user_id, p_uid)) x),
      payers = rekey_uid(e.payers, f, t),
      split = rekey_split(e.split, f, t),
      -- the same cents under the new name — unless two people become one (both were on it),
      -- or it is an equal/adjust split: then expense_postings splits it again
      -- renamed, cent for cent, whatever the split type; on a merge (the account already
      -- on the same expense) the two shares are added, so nobody else's share changes
      shares = rekey_uid(e.shares, f, t)
    where e.flat_id = m.flat_id
      and (e.paid_by = m.user_id or m.user_id = any(e.split_among)
           or coalesce(e.payers, '{}') ? f or coalesce(e.shares, '{}') ? f
           or position(f in coalesce(e.split::text, '')) > 0);
  update recurring_expenses r set
      paid_by = case when r.paid_by = m.user_id then p_uid else r.paid_by end,
      split_among = array(select distinct x from unnest(array_replace(r.split_among, m.user_id, p_uid)) x),
      payers = rekey_uid(r.payers, f, t),
      split = rekey_split(r.split, f, t)
    where r.flat_id = m.flat_id
      and (r.paid_by = m.user_id or m.user_id = any(r.split_among)
           or position(f in coalesce(r.payers::text, '') || coalesce(r.split::text, '')) > 0);
  update flats set default_split = rekey_split(default_split, f, t)
    where id = m.flat_id and position(f in coalesce(default_split::text, '')) > 0;
  -- a payment between the placeholder and the same person would be a payment to themselves:
  -- it moved no money between two people, so it goes (quietly: this is internal)
  delete from settlements where flat_id = m.flat_id
    and ((from_user = m.user_id and to_user = p_uid) or (from_user = p_uid and to_user = m.user_id));
  update settlements set from_user = p_uid where flat_id = m.flat_id and from_user = m.user_id;
  update settlements set to_user   = p_uid where flat_id = m.flat_id and to_user   = m.user_id;
  update flat_items  set added_by  = p_uid where flat_id = m.flat_id and added_by  = m.user_id;
  update flat_items  set bought_by = p_uid where flat_id = m.flat_id and bought_by = m.user_id;

  if existing_id is not null then
    delete from flat_members where id = m.id;   -- not logged as a withdrawn invite (internal)
    if not came_back then
      perform log(m.flat_id, p_uid, 'joined', (select display_name from flat_members where id = existing_id), null,
                  jsonb_build_object('who', p_uid));
    end if;
  end if;
  -- the guard: everyone else holds exactly what they held, and the account holds what it
  -- held plus what the place held. A cent out anywhere and the whole claim is undone.
  v_bad := money_moved(v_before, money_snapshot(m.flat_id), f, t);
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = 'money_guard: taking over this place would change ' || v_bad || ' — nothing was changed',
      detail = jsonb_build_object('code', 'money_guard', 'flat', m.flat_id, 'what', v_bad)::text;
  end if;
  perform set_config('heimat.internal', '', true);
end; $function$;

-- every way the books can be inconsistent, one row per problem
create or replace function public.ledger_audit()
returns table (kind text, flat_id uuid, ref uuid, detail text)
language sql stable security definer set search_path to 'public'
as $function$
  -- a bill whose shares don't add up to it
  select 'shares_sum', e.flat_id, e.id,
         format('shares %s, bill %s %s', coalesce(s.total, 0), to_minor(e.amount, e.currency), e.currency)
    from expenses e
    left join lateral (select sum(jint(value)) total from jsonb_each(case when jsonb_typeof(e.shares) = 'object' then e.shares else '{}' end)) s on true
   where e.deleted_at is null and coalesce(s.total, -1) <> to_minor(e.amount, e.currency)
  union all
  -- several payers who don't add up to it
  select 'payers_sum', e.flat_id, e.id, format('payers %s, bill %s', p.total, to_minor(e.amount, e.currency))
    from expenses e
    join lateral (select sum(jint(value)) total from jsonb_each(e.payers)) p on true
   where e.deleted_at is null and jsonb_typeof(e.payers) = 'object' and p.total <> to_minor(e.amount, e.currency)
  union all
  -- money booked to someone the place has never had
  select 'stranger', e.flat_id, e.id, 'owes or paid: ' || z.u
    from expenses e
    join lateral (select jsonb_object_keys(case when jsonb_typeof(e.shares) = 'object' then e.shares else '{}' end) u
                  union select jsonb_object_keys(case when jsonb_typeof(e.payers) = 'object' then e.payers else '{}' end)
                  union select e.paid_by::text) z on true
   where e.deleted_at is null
     and not exists (select 1 from flat_members m where m.flat_id = e.flat_id and m.user_id::text = z.u)
  union all
  select 'stranger', s.flat_id, s.id, 'payment between ' || s.from_user || ' and ' || s.to_user
    from settlements s
   where not exists (select 1 from flat_members m where m.flat_id = s.flat_id and m.user_id = s.from_user)
      or not exists (select 1 from flat_members m where m.flat_id = s.flat_id and m.user_id = s.to_user)
  union all
  -- a place whose balances don't come to zero in some currency
  select 'not_zero', f.id, null, format('%s %s', b.total, b.c)
    from flats f
    join lateral (select x.c, sum(to_minor(flat_balance_in(f.id, m.user_id, x.c), x.c)) total
                    from (select distinct currency c from expenses where flat_id = f.id and deleted_at is null
                          union select distinct currency from settlements where flat_id = f.id) x
                    cross join (select distinct user_id from flat_members where flat_id = f.id) m
                   group by x.c) b on true
   where b.total <> 0
$function$;

create table if not exists public.ledger_audit_log (
  at timestamptz not null default now(),
  kind text not null, flat_id uuid, ref uuid, detail text
);
alter table public.ledger_audit_log enable row level security;
revoke all on table public.ledger_audit_log from anon, authenticated;

create or replace function public.run_ledger_audit()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n integer; v_admin text;
begin
  insert into ledger_audit_log (kind, flat_id, ref, detail) select * from ledger_audit();
  get diagnostics n = row_count;
  select value into v_admin from app_config where key = 'admin_user';
  if n > 0 and v_admin is not null then
    perform push_notify(jsonb_build_object('event', 'reminder', 'to_user', v_admin,
      'title', 'Splitlife books: ' || n || ' problem' || case when n = 1 then '' else 's' end,
      'message', 'The nightly check found something — see ledger_audit_log'));
  end if;
  return n;
end; $function$;

revoke all on function public.money_snapshot(uuid)                  from public, anon, authenticated;
revoke all on function public.money_moved(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.ledger_audit()                        from public, anon, authenticated;
revoke all on function public.run_ledger_audit()                    from public, anon, authenticated;
revoke all on function public.claim_member(uuid, uuid)              from public, anon, authenticated;

select cron.unschedule('heimat-ledger-audit') where exists (select 1 from cron.job where jobname = 'heimat-ledger-audit');
select cron.schedule('heimat-ledger-audit', '17 2 * * *', 'select public.run_ledger_audit()');
