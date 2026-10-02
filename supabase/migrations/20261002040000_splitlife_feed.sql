-- What MoneyTrack may read from Splitlife (same account, same project): the one door between
-- the two apps, so MoneyTrack never reads Splitlife's tables itself (its own rule).
--
--  * my_pairwise(): what you and each person owe each other, per currency, across every
--    group and your non-group expenses — exactly the figures Splitlife's person page shows
--    (buildLedger + pairwiseFor in src/lib/ledger.ts; tests/pairwise-vectors.json holds the
--    two to the same answers, bills with several payers and odd cents included).
--  * splitlife_feed(p_from): your share of every bill you're on, what you paid for it, and
--    your payments in and out — for MoneyTrack's "My share" and its spending by category.
--
-- Read-only, your own rows only. Recording a payment stays in Splitlife: MoneyTrack opens
-- Splitlife's settle-up with the person and amount filled in.

-- who owes whom for one stored bill: each debtor's shortfall spread over the creditors in
-- proportion to what they're owed (debtsOf in src/lib/ledger.ts, the same allocator)
create or replace function public.debts_of(p_id uuid, p_amount numeric, p_currency text, p_paid_by uuid, p_payers jsonb, p_shares jsonb)
returns table (debtor text, creditor text, minor bigint)
language plpgsql stable set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_net jsonb := '{}';
  k text; v bigint;
  cap_u text[] := '{}'; cap_w numeric[] := '{}';
  d record; a record; i int;
begin
  -- what each paid
  if jsonb_typeof(p_payers) = 'object' then
    for k, v in select key, jint(value) from jsonb_each(p_payers) loop
      v_net := jsonb_set(v_net, array[k], to_jsonb(coalesce(jint(v_net -> k), 0) + v));
    end loop;
  elsif p_paid_by is not null then
    v_net := jsonb_build_object(p_paid_by::text, to_minor(p_amount, p_currency));
  end if;
  -- less what each owes
  if jsonb_typeof(p_shares) = 'object' then
    for k, v in select key, jint(value) from jsonb_each(p_shares) loop
      v_net := jsonb_set(v_net, array[k], to_jsonb(coalesce(jint(v_net -> k), 0) - v));
    end loop;
  end if;
  -- creditors in id order, with what they're still owed
  for k, v in select key, jint(value) from jsonb_each(v_net) where jint(value) > 0 order by key collate "C" loop
    cap_u := cap_u || k; cap_w := cap_w || v::numeric;
  end loop;
  for d in select key as u, jint(value) as n from jsonb_each(v_net) where jint(value) < 0 order by key collate "C" loop
    -- only creditors with something left, in the same order
    for a in select x.user_id, x.cents from alloc_weighted(-d.n,
               array(select cap_u[j] from generate_subscripts(cap_u, 1) j where cap_w[j] > 0 order by j),
               array(select cap_w[j] from generate_subscripts(cap_u, 1) j where cap_w[j] > 0 order by j),
               p_id::text || ':' || d.u) x loop
      continue when a.cents = 0;
      debtor := d.u; creditor := a.user_id; minor := a.cents;
      return next;
      i := array_position(cap_u, a.user_id);
      cap_w[i] := cap_w[i] - a.cents;
    end loop;
  end loop;
end; $function$;

-- what you and each person owe each other (positive: they owe you), per place and currency
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
    select m.flat_id from flat_members m where m.user_id = me and m.claimed_at is not null and m.left_at is null
  ), d as (
    select e.flat_id, e.currency, x.debtor, x.creditor, x.minor
      from expenses e join mine on mine.flat_id = e.flat_id,
           lateral debts_of(e.id, e.amount, e.currency, e.paid_by, e.payers, e.shares) x
     where e.deleted_at is null and (x.debtor = me::text or x.creditor = me::text)
    union all
    -- a payment from X to Y takes that much off what X owes Y
    select s.flat_id, s.currency, s.to_user::text, s.from_user::text, to_minor(s.amount, s.currency)
      from settlements s join mine on mine.flat_id = s.flat_id
     where (s.from_user = me or s.to_user = me) and s.from_user <> s.to_user
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

-- your share of every bill you're on (and what you paid), and your payments, from a date on
create or replace function public.splitlife_feed(p_from date default null)
returns table (kind text, id uuid, place uuid, place_name text, place_kind text, on_date date, description text,
               category text, currency text, amount numeric, my_share bigint, i_paid bigint,
               person uuid, person_name text, direction text)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  return query
  with mine as (
    select m.flat_id from flat_members m where m.user_id = me and m.claimed_at is not null
  )
  select 'expense'::text, e.id, e.flat_id, f.name, f.kind, e.spent_on, e.description, e.category, e.currency, e.amount,
         coalesce(jint(e.shares -> me::text), 0)::bigint,
         (case when jsonb_typeof(e.payers) = 'object' then coalesce(jint(e.payers -> me::text), 0)
               when e.paid_by = me then to_minor(e.amount, e.currency) else 0 end)::bigint,
         null::uuid, null::text, null::text
    from expenses e join mine on mine.flat_id = e.flat_id join flats f on f.id = e.flat_id
   where e.deleted_at is null and (p_from is null or e.spent_on >= p_from)
     and (e.shares ? me::text or e.paid_by = me or coalesce(e.payers, '{}') ? me::text)
  union all
  select 'payment', s.id, s.flat_id, f.name, f.kind, s.settled_on, null, null, s.currency, s.amount,
         0::bigint, 0::bigint,
         case when s.from_user = me then s.to_user else s.from_user end,
         coalesce((select fm.display_name from flat_members fm where fm.flat_id = s.flat_id
                    and fm.user_id = case when s.from_user = me then s.to_user else s.from_user end limit 1), 'Someone'),
         case when s.from_user = me then 'out' else 'in' end
    from settlements s join mine on mine.flat_id = s.flat_id join flats f on f.id = s.flat_id
   where (s.from_user = me or s.to_user = me) and (p_from is null or s.settled_on >= p_from);
end; $function$;

revoke all on function public.debts_of(uuid, numeric, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.my_pairwise()                                     from public, anon;
revoke all on function public.splitlife_feed(date)                              from public, anon;
grant execute on function public.my_pairwise()                                  to authenticated;
grant execute on function public.splitlife_feed(date)                           to authenticated;
