-- The database's balance maths, made to agree with the apps to the cent.
--
-- flat_balance() decides whether someone can be removed from a flat and
-- whether a reminder goes out. It divided each expense exactly (10 € between
-- three is 3,3333…) and rounded the total at the end, while the apps now split
-- every expense into whole cents that add up to its total (3,34 + 3,33 + 3,33)
-- — src/lib/ledger.ts and ios-native/Heimat/Ledger.swift. Two answers to "what
-- is Ben down in this flat" means the app offers a reminder the server then
-- refuses, or the reverse. So the server now splits the same way:
--
--   * every amount in whole cents (all of Heimat's host currencies have two
--     decimals);
--   * each participant gets the floor of total ÷ people, and the cents left
--     over go one each to the participants who sort first by
--     fnv1a(expense id || ':' || user id) — ties by id, in byte order;
--   * an expense in a currency other than the flat's usual one is left out
--     rather than added to it as a bare number.
--
-- tests/ledger-vectors.json holds all three implementations to the same
-- answers; supabase/tests/ledger_vectors.sql checks this one once applied.
--
-- The push for a new expense now carries each person's share from the same
-- function, so the notification's "you owe 3,34 €" matches the app.

-- 32-bit FNV-1a over the UTF-8 bytes, as a number 0 … 2^32−1
create or replace function public.fnv1a(p text)
returns bigint
language sql immutable strict parallel safe set search_path to 'public'
as $function$
  with recursive b(bytes) as (select convert_to(p, 'UTF8')),
  h(i, v) as (
    select 0, 2166136261::bigint
    union all
    select h.i + 1, ((h.v # get_byte(b.bytes, h.i)) * 16777619) & 4294967295
    from h, b where h.i < length(b.bytes)
  )
  select v from h order by i desc limit 1
$function$;

-- each participant's share of one expense, in cents; the shares add up to exactly the amount
create or replace function public.expense_shares(p_id uuid, p_amount numeric, p_paid_by uuid, p_split uuid[])
returns table(user_id uuid, cents bigint)
language sql immutable parallel safe set search_path to 'public'
as $function$
  with ppl as (
    select distinct u
    from unnest(case when coalesce(cardinality(p_split), 0) = 0 then array[p_paid_by] else p_split end) u
    where u is not null
  ), t as (
    select round(p_amount * 100)::bigint as total, count(*) as n from ppl
  ), ordered as (
    select u, row_number() over (order by public.fnv1a(p_id::text || ':' || u::text), u::text collate "C") as rk
    from ppl
  )
  select o.u, sign(t.total) * (abs(t.total) / t.n + case when o.rk <= abs(t.total) % t.n then 1 else 0 end)
  from ordered o, t
$function$;

-- the currency most of a flat's expenses are in (ties: alphabetical)
create or replace function public.flat_currency(p_flat uuid)
returns text
language sql stable set search_path to 'public'
as $function$
  select currency from expenses
  where flat_id = p_flat and coalesce(currency, '') <> ''
  group by currency
  order by count(*) desc, currency collate "C"
  limit 1
$function$;

-- What someone is up or down in one flat, in the same whole cents the apps show.
create or replace function public.flat_balance(p_flat uuid, p_uid uuid)
returns numeric
language sql stable security definer set search_path to 'public'
as $function$
  with cur as (select public.flat_currency(p_flat) as c),
  e as (
    select x.id, x.amount, x.paid_by, x.split_among
    from expenses x, cur
    where x.flat_id = p_flat
      and (coalesce(x.currency, '') = '' or cur.c is null or x.currency = cur.c)
  )
  select round((
      coalesce((select sum(round(amount * 100)::bigint) from e where paid_by = p_uid), 0)
    - coalesce((select sum(s.cents) from e, lateral public.expense_shares(e.id, e.amount, e.paid_by, e.split_among) s
                where s.user_id = p_uid), 0)
    + coalesce((select sum(round(amount * 100)::bigint) from settlements where flat_id = p_flat and from_user = p_uid), 0)
    - coalesce((select sum(round(amount * 100)::bigint) from settlements where flat_id = p_flat and to_user = p_uid), 0)
  ) / 100.0, 2);
$function$;

-- The push for a new expense, now with everyone's share in cents.
create or replace function public.on_expense_insert()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform push_notify(jsonb_build_object(
    'event', 'expense_added',
    'flat_id', new.flat_id,
    'actor', new.created_by,
    'amount', new.amount,
    'description', coalesce(nullif(new.description, ''), 'New shared expense'),
    'paid_by', new.paid_by,
    'split_among', to_jsonb(new.split_among),
    'shares', (select jsonb_object_agg(s.user_id, s.cents)
               from public.expense_shares(new.id, new.amount, new.paid_by, new.split_among) s)
  ));
  return new;
end;
$function$;

-- helpers: nobody calls these directly; flat_balance runs as their owner
revoke all on function public.fnv1a(text)                                 from public, anon, authenticated;
revoke all on function public.expense_shares(uuid, numeric, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.flat_currency(uuid)                         from public, anon, authenticated;
