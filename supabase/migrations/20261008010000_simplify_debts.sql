-- Simplify debts: a group can show the fewest payments that square everyone up instead of
-- who owes whom pair by pair. Every balance stays exactly as it was — this is only a way of
-- looking at the books; expenses and payments are never rewritten, and switched off the
-- pairwise figures are back as they were.
--
-- The apps work the plan out themselves (settlePlan in src/lib/ledger.ts, Ledger.plan in
-- ios-native/Heimat/Ledger.swift). The database needs the same plan in two places, so it has
-- its own copy here — settle_plan(), held to the same answers by tests/ledger-vectors.json:
--   * my_pairwise(), which MoneyTrack reads: "exactly the figures Splitlife's person page
--     shows", so in a simplified group it now returns the plan's payments;
--   * nudge(): a reminder now needs the person to owe *you* at least 0,50 € — as the app
--     shows it, pairwise or simplified — and says that amount, not their whole balance in the
--     group (which was wrong before simplify too: someone 30 € down who owes you 10 € was
--     told you were "still waiting on 30 €").
--
-- set_simplify_debts() also: refuses non-group circles (two people — nothing to simplify, and
-- no app shows the switch there), and touches the caller's flat_members row so every open
-- app hears of the switch at once (flats are not sent over realtime).

-- ------------------------------------------------------------------ the plan

-- The fewest payments that bring every balance to zero; p_net = {person: minor units}. Same
-- rules as settlePlan(): balances in id order (collate "C"); up to 14 people with money
-- outstanding, split into the most groups that each sum to zero (best[m] = max over i of
-- best[m without i] + 1 if m sums to zero, walked back taking the lowest index that keeps
-- the count); within each group the north-west corner — debtors and creditors each in id
-- order, each payment what is left of one against what is left of the other. Beyond 14
-- people (splitGroups): everyone who owes exactly what someone is owed paired with them
-- first, then the exact split on whoever is left if that is 14 or fewer, else one group.
-- Largest payment first, then by payer, then payee. Books that don't add up to zero, hold
-- an amount that isn't a whole number below 2^53, or add up to more than 2^53 − 1, get no plan.
create or replace function public.settle_plan(p_net jsonb)
returns table (from_user text, to_user text, minor bigint)
language plpgsql immutable set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  ids text[]; nv numeric[]; vals bigint[]; n int; full_m int; m int; r int; low int; i int; j int; g int; b int; k int; want int;
  total numeric := 0; s numeric := 0;
  sums bigint[]; best int[]; bitpos int[]; gid int[]; ng int := 0;
  rest int[]; nr int;
  d_u text[]; d_v bigint[]; c_u text[]; c_v bigint[]; pay bigint;
  o_from text[] := '{}'; o_to text[] := '{}'; o_minor bigint[] := '{}';
begin
  if jsonb_typeof(p_net) is distinct from 'object' then return; end if;
  select array_agg(key order by key collate "C"), array_agg(v order by key collate "C")
    into ids, nv
    from (select key, (value #>> '{}')::numeric as v from jsonb_each(p_net)
           where jsonb_typeof(value) = 'number') e
   where key <> '' and v <> 0;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then return; end if;
  -- an amount that isn't a whole number of minor units, or too large to add up exactly: no plan
  for i in 1..n loop
    if nv[i] <> trunc(nv[i]) or abs(nv[i]) > 9007199254740991 then return; end if;
    s := s + nv[i]; total := total + abs(nv[i]);
  end loop;
  if s <> 0 or total > 9007199254740991 then return; end if;
  vals := nv::bigint[];

  gid := array_fill(0, array[n]);
  -- beyond 14 people: exact pairs first, then the exact split on the rest if few enough
  rest := '{}';
  if n > 14 then
    for i in 1..n loop
      continue when vals[i] >= 0 or gid[i] <> 0;
      for j in 1..n loop
        if gid[j] = 0 and vals[j] = -vals[i] then ng := ng + 1; gid[i] := ng; gid[j] := ng; exit; end if;
      end loop;
    end loop;
    for i in 1..n loop if gid[i] = 0 then rest := rest || i; end if; end loop;
  else
    for i in 1..n loop rest := rest || i; end loop;
  end if;
  nr := coalesce(array_length(rest, 1), 0);
  if nr > 14 then
    ng := ng + 1;
    for k in 1..nr loop gid[rest[k]] := ng; end loop;
  elsif nr > 0 then
    full_m := (1 << nr) - 1;
    sums := array_fill(0::bigint, array[full_m + 1], array[0]);
    best := array_fill(0, array[full_m + 1], array[0]);
    bitpos := array_fill(0, array[full_m + 1], array[0]);
    for i in 0..nr - 1 loop bitpos[1 << i] := i; end loop;
    for m in 1..full_m loop
      low := m & -m;
      sums[m] := sums[m # low] + vals[rest[bitpos[low] + 1]];
    end loop;
    for m in 1..full_m loop
      b := 0; r := m;
      while r <> 0 loop
        k := best[m # (r & -r)];
        if k > b then b := k; end if;
        r := r & (r - 1);
      end loop;
      best[m] := b + (case when sums[m] = 0 then 1 else 0 end);
    end loop;
    -- walk back: the lowest index that keeps the count goes each time; a group ends wherever
    -- what is left sums to zero
    m := full_m; ng := ng + 1;
    while m <> 0 loop
      want := best[m] - (case when sums[m] = 0 then 1 else 0 end);
      r := m;
      while best[m # (r & -r)] <> want loop r := r & (r - 1); end loop;
      low := r & -r;
      gid[rest[bitpos[low] + 1]] := ng;
      m := m # low;
      if m <> 0 and sums[m] = 0 then ng := ng + 1; end if;
    end loop;
  end if;

  -- north-west corner within each group
  for g in 1..ng loop
    d_u := '{}'; d_v := '{}'; c_u := '{}'; c_v := '{}';
    for i in 1..n loop
      continue when gid[i] <> g;
      if vals[i] < 0 then d_u := d_u || ids[i]; d_v := d_v || (-vals[i]);
      else c_u := c_u || ids[i]; c_v := c_v || vals[i]; end if;
    end loop;
    i := 1; j := 1;
    while i <= coalesce(array_length(d_u, 1), 0) and j <= coalesce(array_length(c_u, 1), 0) loop
      pay := least(d_v[i], c_v[j]);
      o_from := o_from || d_u[i]; o_to := o_to || c_u[j]; o_minor := o_minor || pay;
      d_v[i] := d_v[i] - pay; c_v[j] := c_v[j] - pay;
      if d_v[i] = 0 then i := i + 1; end if;
      if c_v[j] = 0 then j := j + 1; end if;
    end loop;
  end loop;

  return query
    select x.f, x.t, x.v from unnest(o_from, o_to, o_minor) as x(f, t, v)
     order by x.v desc, x.f collate "C", x.t collate "C";
end; $function$;

-- every balance in one group and currency, in minor units: what each paid, less their stored
-- shares, plus payments made, less payments received (the same sums as flat_balance_in)
create or replace function public.flat_nets(p_flat uuid, p_cur text)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(u, v) filter (where v <> 0), '{}'::jsonb)
    from (
      select u, sum(v)::bigint as v from (
        select key as u, jint(value) as v
          from expenses e, jsonb_each(e.payers)
         where e.flat_id = p_flat and e.deleted_at is null and e.currency = p_cur and jsonb_typeof(e.payers) = 'object'
        union all
        select e.paid_by::text, to_minor(e.amount, p_cur)
          from expenses e
         where e.flat_id = p_flat and e.deleted_at is null and e.currency = p_cur
           and jsonb_typeof(e.payers) is distinct from 'object' and e.paid_by is not null
        union all
        select key, -jint(value)
          from expenses e, jsonb_each(e.shares)
         where e.flat_id = p_flat and e.deleted_at is null and e.currency = p_cur and jsonb_typeof(e.shares) = 'object'
        union all
        select s.from_user::text, to_minor(s.amount, p_cur)
          from settlements s where s.flat_id = p_flat and s.currency = p_cur and s.from_user <> s.to_user
        union all
        select s.to_user::text, -to_minor(s.amount, p_cur)
          from settlements s where s.flat_id = p_flat and s.currency = p_cur and s.from_user <> s.to_user
      ) x group by u
    ) y;
$function$;

-- does this group show the fewest-payments plan? (never a non-group circle)
create or replace function public.simplified(p_flat uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select f.simplify_debts and coalesce(f.kind, '') <> 'direct' from flats f where f.id = p_flat), false);
$function$;

-- What p_from owes p_to in one group and currency, in minor units, as the apps show it:
-- the plan's payment between them when the group is simplified, otherwise what is left of
-- their pair (each bill's debts, less payments between the two). Negative: p_to owes p_from.
create or replace function public.pair_owed(p_flat uuid, p_from uuid, p_to uuid, p_cur text)
returns bigint
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v bigint;
begin
  if simplified(p_flat) then
    select coalesce(sum(case when x.from_user = p_from::text then x.minor else -x.minor end), 0) into v
      from settle_plan(flat_nets(p_flat, p_cur)) x
     where (x.from_user = p_from::text and x.to_user = p_to::text)
        or (x.from_user = p_to::text and x.to_user = p_from::text);
    return v;
  end if;
  select coalesce(sum(n), 0) into v from (
    select case when x.debtor = p_from::text then x.minor else -x.minor end as n
      from expenses e, lateral debts_of(e.id, e.amount, e.currency, e.paid_by, e.payers, e.shares) x
     where e.flat_id = p_flat and e.deleted_at is null and e.currency = p_cur
       and ((x.debtor = p_from::text and x.creditor = p_to::text) or (x.debtor = p_to::text and x.creditor = p_from::text))
    union all
    -- a payment from X to Y takes that much off what X owes Y
    select case when s.from_user = p_from then -to_minor(s.amount, p_cur) else to_minor(s.amount, p_cur) end
      from settlements s
     where s.flat_id = p_flat and s.currency = p_cur
       and ((s.from_user = p_from and s.to_user = p_to) or (s.from_user = p_to and s.to_user = p_from))
  ) y;
  return v;
end; $function$;

-- ------------------------------------------------------------------ MoneyTrack

-- what you and each person owe each other (positive: they owe you), per place and currency —
-- pairwise, or in a simplified group the plan's payments (the person page's figures either way)
create or replace function public.my_pairwise()
returns table (place uuid, place_name text, place_kind text, person uuid, person_name text, currency text, minor bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  return query
  with mine as (
    select m.flat_id, simplified(m.flat_id) as simple
      from flat_members m where m.user_id = me and m.claimed_at is not null and m.left_at is null
  ), d as (
    select e.flat_id, e.currency, x.debtor, x.creditor, x.minor
      from expenses e join mine on mine.flat_id = e.flat_id and not mine.simple,
           lateral debts_of(e.id, e.amount, e.currency, e.paid_by, e.payers, e.shares) x
     where e.deleted_at is null and (x.debtor = me::text or x.creditor = me::text)
    union all
    -- a payment from X to Y takes that much off what X owes Y
    select s.flat_id, s.currency, s.to_user::text, s.from_user::text, to_minor(s.amount, s.currency)
      from settlements s join mine on mine.flat_id = s.flat_id and not mine.simple
     where (s.from_user = me or s.to_user = me) and s.from_user <> s.to_user
    union all
    -- a simplified group: the plan's payments to and from you, per currency
    select c.flat_id, c.currency, x.from_user, x.to_user, x.minor
      from (select distinct e.flat_id, e.currency from expenses e join mine on mine.flat_id = e.flat_id and mine.simple
             where e.deleted_at is null
            union
            select distinct s.flat_id, s.currency from settlements s join mine on mine.flat_id = s.flat_id and mine.simple) c,
           lateral settle_plan(flat_nets(c.flat_id, c.currency)) x
     where x.from_user = me::text or x.to_user = me::text
  ), p as (
    select flat_id, currency, case when creditor = me::text then debtor else creditor end as other,
           sum(case when creditor = me::text then minor else -minor end)::bigint as n
      from d group by 1, 2, 3
  )
  select p.flat_id, f.name, f.kind, p.other::uuid,
         coalesce((select fm.display_name from flat_members fm where fm.flat_id = p.flat_id and fm.user_id::text = p.other limit 1), 'Someone'),
         p.currency, p.n
    from p join flats f on f.id = p.flat_id
   where p.n <> 0;
end; $function$;

-- ------------------------------------------------------------------ reminders

create or replace function public.nudge(p_flat uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_last timestamptz; v_owed bigint; v_name text; v_cur text;
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  if p_uid = auth.uid() then raise exception 'You do not owe yourself'; end if;

  select max(sent_at) into v_last from nudges
    where flat_id = p_flat and from_user = auth.uid() and to_user = p_uid;
  if v_last is not null and v_last > now() - interval '20 hours' then
    raise exception 'You already reminded them today';
  end if;

  -- what they owe you, as the app shows it (pairwise, or the simplified plan), in the flat's
  -- main currency; the minimum is 50 minor units (0,50 €), as Ledger.nudgeMinimum
  v_cur := coalesce(flat_currency(p_flat), 'EUR');
  v_owed := pair_owed(p_flat, p_uid, auth.uid(), v_cur);
  if v_owed < 50 then raise exception 'They don''t owe you anything in this group'; end if;

  select coalesce(nullif(display_name, ''), 'Someone') into v_name
    from flat_members where flat_id = p_flat and user_id = auth.uid();

  insert into nudges(flat_id, from_user, to_user) values (p_flat, auth.uid(), p_uid);
  perform push_notify(jsonb_build_object(
    'event', 'nudge', 'flat_id', p_flat, 'actor', auth.uid(),
    'to_user', p_uid, 'amount', v_owed::numeric / power(10::numeric, minor_digits(v_cur)), 'title', v_name, 'currency', v_cur
  ));
end; $function$;

-- ------------------------------------------------------------------ the switch

-- anyone in a group can switch it, and everyone sees who did (as in Splitwise)
create or replace function public.set_simplify_debts(p_flat uuid, p_on boolean)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  if p_on is null then raise exception 'On or off?' using errcode = '22023'; end if;
  if (select kind from flats where id = p_flat) = 'direct' then
    raise exception using errcode = 'P0001', message = 'simplify: only a group can simplify its debts', detail = '{"code": "not_a_group"}';
  end if;
  update flats set simplify_debts = p_on where id = p_flat and simplify_debts is distinct from p_on;
  if found then
    perform log(p_flat, auth.uid(), case when p_on then 'simplify_on' else 'simplify_off' end, null, null, '{}'::jsonb);
    -- flats aren't sent over realtime: touch a row every open app listens to, so they reload
    update flat_members set display_name = display_name where flat_id = p_flat and user_id = auth.uid();
  end if;
end; $function$;

revoke all on function public.settle_plan(jsonb)                from public, anon;
grant execute on function public.settle_plan(jsonb)             to authenticated;   -- a pure function of what it is given
revoke all on function public.flat_nets(uuid, text)             from public, anon, authenticated;
revoke all on function public.simplified(uuid)                  from public, anon, authenticated;
revoke all on function public.pair_owed(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.my_pairwise()                     from public, anon;
revoke all on function public.nudge(uuid, uuid)                 from public, anon;
revoke all on function public.set_simplify_debts(uuid, boolean) from public, anon;
grant execute on function public.my_pairwise()                  to authenticated;
grant execute on function public.nudge(uuid, uuid)              to authenticated;
grant execute on function public.set_simplify_debts(uuid, boolean) to authenticated;
