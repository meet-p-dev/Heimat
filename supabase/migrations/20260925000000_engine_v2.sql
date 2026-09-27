-- Engine v2: every way Splitwise splits a bill, several people paying one,
-- expenses in any currency, recurring expenses, restoring deleted ones, and a
-- per-flat "simplify debts" switch.
--
-- The rules are the same as src/lib/ledger.ts and ios-native/Heimat/Ledger.swift
-- (tests/ledger-vectors.json holds all three to the same answers). The apps
-- work out a preview; this is where the figure that counts is made: every
-- expense gets its `shares` — what each person owes, in cents, adding up to
-- exactly the bill — from its split, on every insert and update. Balances are
-- then plain sums of stored shares and payments, and a later change to the
-- rules can never re-split an old bill.
--
-- Everything is added, nothing renamed: an app from before this (Build 8, or a
-- cached web app) still reads amount, paid_by and split_among, and its equal
-- splits come out cent-for-cent the same. If such an app edits an expense it
-- cannot understand (a percentage split, several payers) in a way that would
-- break it, the edit is refused with "update Heimat to edit this expense"
-- rather than quietly turned into something else. An app that knows engine v2
-- says so by sending split_type, split and payers with every change.
--
-- Apps may write only the columns they own (see the grants at the end): the
-- server alone marks an expense deleted, ties it to a recurring expense, and
-- works out its shares.

-- ------------------------------------------------------------------ columns

alter table public.expenses
  add column if not exists split_type text not null default 'equal',
  add column if not exists split jsonb,
  add column if not exists payers jsonb,
  add column if not exists shares jsonb,
  add column if not exists recurring_id uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  -- which occurrence of its recurring expense this is (server-owned: spent_on can be edited)
  add column if not exists recurring_n integer;

alter table public.expenses drop constraint if exists expenses_split_type_check;
alter table public.expenses add constraint expenses_split_type_check
  check (split_type in ('equal', 'exact', 'percent', 'shares', 'adjust', 'itemized'));
-- an ISO 4217 code: the number of decimals, and so every stored share, depends on it
alter table public.expenses drop constraint if exists expenses_currency_iso;
alter table public.expenses add constraint expenses_currency_iso check (currency ~ '^[A-Z]{3}$');
-- no default: expense_postings fills a missing currency with the flat's (then EUR)
alter table public.expenses alter column currency drop default;

alter table public.settlements add column if not exists currency text;
-- the same ceiling as a bill (10^11 minor units), so no balance can outgrow exact integers on a phone
alter table public.settlements drop constraint if exists settlements_amount_bound;
alter table public.settlements add constraint settlements_amount_bound check (abs(amount) <= 100000000);

alter table public.flats add column if not exists simplify_debts boolean not null default false;
-- how a new expense in this flat is split unless someone chooses otherwise: {"type": …, "values": {…}}
alter table public.flats add column if not exists default_split jsonb;

-- --------------------------------------------------------------- the engine

-- Split p_total cents by integer-valued weights, adding up to exactly p_total:
-- largest remainder, ties by fnv1a(seed:uid) then uid in byte order.
create or replace function public.alloc_weighted(p_total bigint, p_uids text[], p_weights numeric[], p_seed text)
returns table(user_id text, cents bigint)
language sql immutable parallel safe set search_path to 'public'
as $function$
  with w as (
    select u, sum(x) as x
    from unnest(p_uids, p_weights) t(u, x)
    where coalesce(u, '') <> '' and x > 0
    group by u
  ), tot as (
    select abs(p_total)::numeric as t, sum(x) as ws from w
  ), rows as (
    select w.u, (tot.t * w.x - mod(tot.t * w.x, tot.ws)) / tot.ws as base, mod(tot.t * w.x, tot.ws) as rem
    from w, tot
  ), ranked as (
    select u, base, row_number() over (order by rem desc, public.fnv1a(p_seed || ':' || u), u collate "C") as rk
    from rows
  ), extra as (
    select (select t from tot) - coalesce(sum(base), 0) as n from rows
  )
  select u, (sign(p_total) * (base + case when rk <= (select n from extra) then 1 else 0 end))::bigint
  from ranked
$function$;

-- ISO 4217 minor-unit exponent: 2, except these (the same table as ledger.ts and Ledger.swift)
create or replace function public.minor_digits(p_cur text)
returns integer
language sql immutable parallel safe set search_path to 'public'
as $function$
  select case
    when upper(coalesce(p_cur, '')) in ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') then 0
    when upper(coalesce(p_cur, '')) in ('BHD','IQD','JOD','KWD','LYD','OMR','TND') then 3
    else 2 end
$function$;

-- an amount in minor units of its currency, rounded half away from zero. power() on a numeric
-- base stays numeric: `10 ^ 2` would be a double, and round() on a double rounds half to even
create or replace function public.to_minor(p_amount numeric, p_cur text)
returns bigint
language sql immutable parallel safe set search_path to 'public'
as $function$
  select round(p_amount * power(10::numeric, public.minor_digits(p_cur)))::bigint
$function$;

-- a jsonb number that is a whole number, or null
create or replace function public.jint(v jsonb)
returns bigint
language sql immutable parallel safe set search_path to 'public'
as $function$
  select case when jsonb_typeof(v) = 'number' and (v::text)::numeric = trunc((v::text)::numeric)
              and abs((v::text)::numeric) < 9007199254740992 then (v::text)::numeric::bigint end
$function$;

-- Refuse a split, with a machine-readable reason in DETAIL: {"code": …, "diff": …, "who": …}.
create or replace function public.split_error(p_code text, p_diff bigint default null, p_who text default null)
returns void
language plpgsql immutable set search_path to 'public'
as $function$
begin
  raise exception using errcode = 'P0001', message = 'split: ' || p_code,
    detail = jsonb_strip_nulls(jsonb_build_object('code', p_code, 'diff', p_diff, 'who', p_who))::text;
end; $function$;

-- A person's id the one way Postgres prints it (lower case, with hyphens), so that
-- "A1B2…" in a split and "a1b2…" in split_among are never two people.
create or replace function public.norm_uid(p text)
returns text
language plpgsql immutable set search_path to 'public'
as $function$
begin
  return p::uuid::text;
exception when invalid_text_representation then
  perform split_error('bad_value', null, left(p, 64));
  return null;
end; $function$;

-- {person: value} with every person's id in that form; two spellings of one person are refused
create or replace function public.norm_uids(p jsonb)
returns jsonb
language plpgsql immutable set search_path to 'public'
as $function$
declare k text; v jsonb; u text; outp jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return p; end if;
  for k, v in select key, value from jsonb_each(p) where key <> '' loop
    u := norm_uid(k);
    if outp ? u then perform split_error('bad_value', null, u); end if;
    outp := outp || jsonb_build_object(u, v);
  end loop;
  return outp;
end; $function$;

-- A split as stored: an object of bounded size, with every id in it in canonical form.
create or replace function public.norm_split(s jsonb)
returns jsonb
language plpgsql immutable set search_path to 'public'
as $function$
declare items jsonb;
begin
  if s is null or s = 'null'::jsonb then return null; end if;
  if jsonb_typeof(s) <> 'object' then perform split_error('bad_value'); end if;
  if octet_length(s::text) > 65536 then perform split_error('too_large'); end if;
  if jsonb_typeof(s -> 'values') = 'object' then
    s := jsonb_set(s, '{values}', norm_uids(s -> 'values'));
  end if;
  if jsonb_typeof(s -> 'items') = 'array' then
    select coalesce(jsonb_agg(case when jsonb_typeof(it -> 'among') = 'array' then jsonb_set(it, '{among}', (
               select coalesce(jsonb_agg(to_jsonb(norm_uid(a)) order by o), '[]'::jsonb)
               from jsonb_array_elements_text(it -> 'among') with ordinality t(a, o) where a <> ''))
             else it end order by io), '[]'::jsonb)
      into items
      from jsonb_array_elements(s -> 'items') with ordinality x(it, io);
    s := jsonb_set(s, '{items}', items);
  end if;
  return s;
end; $function$;

-- What each person owes for one bill, in cents, as the split describes — the
-- database's copy of computeShares(). Raises split_error when it cannot.
create or replace function public.split_shares(
  p_id uuid, p_amount numeric, p_currency text, p_paid_by uuid, p_split_among uuid[], p_type text, p_split jsonb
) returns jsonb
language plpgsql immutable set search_path to 'public'
as $function$
declare
  total bigint := to_minor(p_amount, p_currency);
  sgn int := case when to_minor(p_amount, p_currency) < 0 then -1 else 1 end;
  seed text := p_id::text;
  among text[];
  -- a JSON null reads as missing, as `values || {}` does in ledger.ts
  vals jsonb := coalesce(nullif(p_split -> 'values', 'null'::jsonb), '{}'::jsonb);
  k text; v jsonb; n bigint; s bigint := 0; x numeric;
  ks text[] := '{}'; ws numeric[] := '{}';
  outp jsonb := '{}'::jsonb;
  r record;
  it jsonb; it_among jsonb; i int := 0; items_total bigint := 0; tax bigint; tip bigint; discount bigint; extra bigint; expected bigint;
begin
  if abs(total) > 100000000000 then perform split_error('too_large'); end if;
  if coalesce(p_type, 'equal') in ('exact', 'percent', 'shares', 'adjust') and jsonb_typeof(vals) <> 'object' then
    perform split_error('bad_value');
  end if;
  select coalesce(array_agg(u order by ord), '{}') into among
    from (select u::text as u, min(ord) as ord
          from unnest(case when coalesce(cardinality(p_split_among), 0) = 0 then array[p_paid_by] else p_split_among end)
               with ordinality t(u, ord)
          where u is not null group by u) z;

  case coalesce(p_type, 'equal')
  when 'equal' then
    if cardinality(among) = 0 then perform split_error('empty'); end if;
    select jsonb_object_agg(user_id, cents) into outp
      from alloc_weighted(total, among, array_fill(1::numeric, array[cardinality(among)]), seed);

  when 'exact' then
    for k, v in select key, value from jsonb_each(vals) where key <> '' order by key collate "C" loop
      n := jint(v);
      if n is null or n * sgn < 0 then perform split_error('bad_value', null, k); end if;
      if n <> 0 then outp := outp || jsonb_build_object(k, n); end if;
      s := s + n;
    end loop;
    if (select count(*) from jsonb_object_keys(vals) z where z <> '') = 0 then perform split_error('empty'); end if;
    if s <> total then perform split_error('sum_mismatch', s - total); end if;
    if outp = '{}'::jsonb and total <> 0 then perform split_error('empty'); end if;

  when 'percent' then
    for k, v in select key, value from jsonb_each(vals) where key <> '' order by key collate "C" loop
      n := jint(v);
      if n is null or n < 0 or n > 10000 then perform split_error('bad_value', null, k); end if;
      ks := ks || k; ws := ws || n::numeric; s := s + n;
    end loop;
    if cardinality(ks) = 0 then perform split_error('empty'); end if;
    if s <> 10000 then perform split_error('percent_total', s - 10000); end if;
    select jsonb_object_agg(user_id, cents) into outp from alloc_weighted(total, ks, ws, seed);

  when 'shares' then
    for k, v in select key, value from jsonb_each(vals) where key <> '' order by key collate "C" loop
      if jsonb_typeof(v) <> 'number' then perform split_error('bad_value', null, k); end if;
      x := (v::text)::numeric;
      if x < 0 or x > 10000 or x * 100 <> trunc(x * 100) then perform split_error('bad_value', null, k); end if;
      if x <> 0 then ks := ks || k; ws := ws || (x * 100); end if;
    end loop;
    if cardinality(ks) = 0 then perform split_error('empty'); end if;
    select jsonb_object_agg(user_id, cents) into outp from alloc_weighted(total, ks, ws, seed);

  when 'adjust' then
    if cardinality(among) = 0 then perform split_error('empty'); end if;
    for k, v in select key, value from jsonb_each(vals) where key <> '' order by key collate "C" loop
      n := jint(v);
      -- each adjustment has the same ceiling as a bill, so no share can outgrow exact integers
      if n is null or abs(n) > 100000000000 then perform split_error('bad_value', null, k); end if;
      if n <> 0 and not (k = any(among)) then perform split_error('not_in_split', null, k); end if;
      s := s + n;
    end loop;
    if (total - s) * sgn < 0 then perform split_error('remainder_negative', -(total - s) * sgn); end if;
    select jsonb_object_agg(user_id, cents) into outp
      from alloc_weighted(total - s, among, array_fill(1::numeric, array[cardinality(among)]), seed);
    for k, v in select key, value from jsonb_each(vals) where key <> '' loop
      n := jint(v);
      if n <> 0 then outp := outp || jsonb_build_object(k, coalesce((outp ->> k)::bigint, 0) + n); end if;
    end loop;

  when 'itemized' then
    if jsonb_typeof(p_split -> 'items') is distinct from 'array' or jsonb_array_length(p_split -> 'items') = 0 then
      perform split_error('empty');
    end if;
    tax := coalesce(jint(p_split -> 'tax'), case when p_split ? 'tax' and p_split -> 'tax' <> 'null'::jsonb then null else 0 end);
    tip := coalesce(jint(p_split -> 'tip'), case when p_split ? 'tip' and p_split -> 'tip' <> 'null'::jsonb then null else 0 end);
    discount := coalesce(jint(p_split -> 'discount'), case when p_split ? 'discount' and p_split -> 'discount' <> 'null'::jsonb then null else 0 end);
    if tax is null or tip is null or discount is null
       or tax not between 0 and 100000000000 or tip not between 0 and 100000000000 or discount not between 0 and 100000000000 then
      perform split_error('bad_value');
    end if;
    for it in select value from jsonb_array_elements(p_split -> 'items') loop
      n := jint(it -> 'minor');
      if n is null or n not between 0 and 100000000000 then perform split_error('bad_value'); end if;
      it_among := coalesce(nullif(it -> 'among', 'null'::jsonb), '[]'::jsonb);
      if jsonb_typeof(it_among) <> 'array' then perform split_error('bad_value'); end if;
      select coalesce(array_agg(u order by ord), '{}') into ks
        from (select u, min(ord) as ord from jsonb_array_elements_text(it_among) with ordinality t(u, ord)
              where u <> '' group by u) z;
      if cardinality(ks) = 0 then perform split_error('empty'); end if;
      items_total := items_total + n;
      for r in select user_id, cents from alloc_weighted(n, ks, array_fill(1::numeric, array[cardinality(ks)]), seed || ':item:' || i) loop
        outp := outp || jsonb_build_object(r.user_id, coalesce((outp ->> r.user_id)::bigint, 0) + r.cents);
      end loop;
      i := i + 1;
    end loop;
    expected := (items_total + tax + tip - discount) * sgn;
    if expected <> total then perform split_error('sum_mismatch', expected - total); end if;
    extra := (tax + tip - discount) * sgn;
    select coalesce(array_agg(key order by key collate "C"), '{}'), coalesce(array_agg(value::text::numeric order by key collate "C"), '{}')
      into ks, ws from jsonb_each(outp) where value::text::numeric > 0;
    if extra <> 0 and cardinality(ks) = 0 then perform split_error('empty'); end if;
    select jsonb_object_agg(key, (value::text::bigint) * sgn) into outp from jsonb_each(outp);
    for r in select user_id, cents from alloc_weighted(extra, ks, ws, seed || ':extra') loop
      outp := outp || jsonb_build_object(r.user_id, coalesce((outp ->> r.user_id)::bigint, 0) + r.cents);
    end loop;

  else
    perform split_error('unknown_type');
  end case;
  -- only the people who owe something: a zero share is no share
  return coalesce((select jsonb_object_agg(key, value) from jsonb_each(outp) where value::text::numeric <> 0), '{}'::jsonb);
end; $function$;

-- Several people paying one bill: whole cents, the same sign as the bill, adding up to it.
create or replace function public.check_payers(p_amount numeric, p_currency text, p_payers jsonb)
returns void
language plpgsql immutable set search_path to 'public'
as $function$
declare total bigint := to_minor(p_amount, p_currency); sgn int := case when to_minor(p_amount, p_currency) < 0 then -1 else 1 end;
        k text; v jsonb; n bigint; s bigint := 0;
begin
  for k, v in select key, value from jsonb_each(p_payers) where key <> '' order by key collate "C" loop
    n := jint(v);
    if n is null or n * sgn < 0 then perform split_error('bad_value', null, k); end if;
    s := s + n;
  end loop;
  if s <> total then perform split_error('sum_mismatch', s - total); end if;
end; $function$;

-- payers as stored: null for "paid_by paid it all", else checked, with canonical ids and
-- whole numbers (5000.0 is accepted and kept as 5000, so every ::bigint reader can read it)
create or replace function public.norm_payers(p_amount numeric, p_currency text, p_paid_by uuid, p_payers jsonb)
returns jsonb
language plpgsql immutable set search_path to 'public'
as $function$
declare p jsonb;
begin
  if p_payers is null or p_payers = 'null'::jsonb or p_payers = '{}'::jsonb then return null; end if;
  if jsonb_typeof(p_payers) <> 'object' then perform split_error('bad_value', null, 'payers'); end if;
  p := norm_uids(p_payers);
  perform check_payers(p_amount, p_currency, p);
  p := (select jsonb_object_agg(key, jint(value)) from jsonb_each(p) where key <> '');
  if p is null or not p ? p_paid_by::text then
    raise exception using errcode = 'P0001', message = 'split: paid_by must be one of the payers',
      detail = '{"code": "bad_value", "who": "paid_by"}';
  end if;
  return p;
end; $function$;

-- The flat's main currency: the one most of its live expenses are in (ties: alphabetical);
-- a flat with none takes the one most of its payments were recorded in. The same rule as
-- flatCurrency() in the apps, which can only see live expenses.
create or replace function public.flat_currency(p_flat uuid)
returns text
language sql stable set search_path to 'public'
as $function$
  select coalesce(
    (select currency from expenses
      where flat_id = p_flat and deleted_at is null and coalesce(currency, '') <> ''
      group by currency order by count(*) desc, currency collate "C" limit 1),
    (select currency from settlements
      where flat_id = p_flat and coalesce(currency, '') <> ''
      group by currency order by count(*) desc, currency collate "C" limit 1))
$function$;

-- --------------------------------------------------------- every write

-- An app that knows engine v2 sends split_type, split and payers with every change
-- (an app from before never does). A trigger can't see what a request sent, only
-- what the row now holds, so this one — BEFORE triggers fire in name order, and
-- `expense_a…` comes before `expense_postings` — notes it for the row, and
-- expense_postings reads the note and clears it. PostgREST puts exactly the keys of
-- the request body in the SET list, and `update of` fires on the SET list.
create or replace function public.expense_v2_write()
returns trigger
language plpgsql set search_path to 'public'
as $function$
begin
  perform set_config('heimat.v2_write', new.id::text, true);
  return new;
end; $function$;

drop trigger if exists expense_a_v2_write on public.expenses;
create trigger expense_a_v2_write before update of split_type, split, payers
  on public.expenses for each row execute function public.expense_v2_write();

-- SECURITY DEFINER: it calls the helpers above, which app users cannot call
create or replace function public.expense_postings()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v2 boolean;
  internal boolean := coalesce(current_setting('heimat.internal', true), '') = 'on';
  prev text[] := '{}';
  stray text;
begin
  v2 := coalesce(current_setting('heimat.v2_write', true), '') = new.id::text;
  perform set_config('heimat.v2_write', '', true);   -- read once; never carried over to another row

  new.split_type := coalesce(new.split_type, 'equal');
  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), flat_currency(new.flat_id), 'EUR'));
  -- stored to the currency's decimals, so every app's double reads back exactly what the server split
  new.amount := round(new.amount, minor_digits(new.currency));

  -- an app from before engine v2 editing an expense it cannot represent
  if tg_op = 'UPDATE' and not v2 and (
       -- a split it can't see: a changed set of people (in any order — Build 8 sends a Set),
       -- or a new total for a split made of fixed amounts
       (new.split_type <> 'equal' and new.split is not distinct from old.split
        and (array(select distinct u from unnest(new.split_among) u order by u)
               is distinct from array(select distinct u from unnest(old.split_among) u order by u)
             or (new.amount is distinct from old.amount and new.split_type in ('exact', 'adjust', 'itemized'))))
       -- several payers it can't see: a new payer or amount would be ignored, or no longer add up
    or (old.payers is not null and new.payers is not distinct from old.payers
        and (new.paid_by is distinct from old.paid_by or new.amount is distinct from old.amount))) then
    raise exception using errcode = 'P0001', message = 'update Heimat to edit this expense',
      detail = '{"code": "update_required"}';
  end if;

  -- "everyone in the flat" from an app that lists people who have left (Build 8's Siri
  -- shortcut does): they are no longer in the flat, so they are not in a new equal split
  if tg_op = 'INSERT' and new.split_type = 'equal' and not internal then
    new.split_among := array(select u from unnest(new.split_among) u
                             where not exists (select 1 from flat_members m
                                               where m.flat_id = new.flat_id and m.user_id = u and m.left_at is not null));
  end if;

  new.split := case when new.split_type = 'equal' then null else norm_split(new.split) end;
  new.payers := norm_payers(new.amount, new.currency, new.paid_by, new.payers);
  -- a server-side rewrite that only renamed someone (an invite taken over) keeps the stored
  -- figures cent for cent — for splits made of amounts, percentages, shares or items. Equal
  -- and adjust splits are always worked out again from split_among, as every app (Build 8
  -- included) does, so all of them keep agreeing on who owes the odd cent.
  if not (internal and tg_op = 'UPDATE' and new.split_type not in ('equal', 'adjust')
          and new.shares is distinct from old.shares
          and coalesce((select bool_and(jint(value) is not null) and sum(jint(value)) = to_minor(new.amount, new.currency)
                        from jsonb_each(case when jsonb_typeof(new.shares) = 'object' then new.shares else '{}' end)), false)) then
    new.shares := split_shares(new.id, new.amount, new.currency, new.paid_by, new.split_among, new.split_type, new.split);
  end if;
  if new.split_type in ('exact', 'percent', 'shares', 'itemized') then
    -- who is in it, for everything that reads split_among (older apps, notifications);
    -- equal and adjust take split_among as their input, so it is left alone
    select coalesce(array_agg(key::uuid order by key), '{}') into new.split_among
      from jsonb_each(new.shares) where value::text::numeric <> 0;
  end if;

  -- money can only be booked to people in the flat: anyone named — who paid, a payer,
  -- anyone in the split — must be a current member (or pending invitee). Someone already
  -- on the expense who has left since may stay on it, but an edit can't make them owe
  -- more or change what they paid.
  if not internal then
    if tg_op = 'UPDATE' then
      prev := array[old.paid_by::text] || old.split_among::text[]
           || array(select jsonb_object_keys(case when jsonb_typeof(old.shares) = 'object' then old.shares else '{}' end))
           || array(select jsonb_object_keys(case when jsonb_typeof(old.payers) = 'object' then old.payers else '{}' end));
    end if;
    select z.u into stray
      from (select jsonb_object_keys(new.shares) as u
            union select jsonb_object_keys(coalesce(new.payers, '{}'))
            union select x::text from unnest(new.split_among) x
            union select new.paid_by::text) z
      where not exists (select 1 from flat_members m
                        where m.flat_id = new.flat_id and m.user_id::text = z.u and m.left_at is null)
        and (not (z.u = any(prev))
             or abs(coalesce(jint(new.shares -> z.u), 0))
                  > abs(coalesce(jint(case when jsonb_typeof(old.shares) = 'object' then old.shares -> z.u end), 0))
             or (case when new.payers is not null then coalesce(jint(new.payers -> z.u), 0)
                      when new.paid_by::text = z.u then to_minor(new.amount, new.currency) else 0 end)
                <> (case when jsonb_typeof(old.payers) = 'object' then coalesce(jint(old.payers -> z.u), 0)
                         when old.paid_by::text = z.u then to_minor(old.amount, old.currency) else 0 end))
      limit 1;
    if stray is not null then perform split_error('not_in_flat', null, stray); end if;
  end if;
  return new;
end; $function$;

drop trigger if exists expense_postings on public.expenses;
create trigger expense_postings before insert or update of amount, currency, paid_by, split_among, split_type, split, payers, shares
  on public.expenses for each row execute function public.expense_postings();

-- the activity feed also notices a changed split, payers or currency; server-side
-- rewrites (someone taking over an invite) are not edits anyone made
create or replace function public.log_expense()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform log(new.flat_id, new.created_by, 'expense_added', new.description, new.amount,
                jsonb_build_object('expense', new.id, 'paid_by', new.paid_by));
    return new;
  elsif tg_op = 'UPDATE' then
    if coalesce(current_setting('heimat.internal', true), '') = 'on' then return new; end if;
    if new.amount is distinct from old.amount
       or new.description is distinct from old.description
       or new.paid_by is distinct from old.paid_by
       or new.split_among is distinct from old.split_among
       or new.spent_on is distinct from old.spent_on
       or new.category is distinct from old.category
       or new.currency is distinct from old.currency
       or new.split_type is distinct from old.split_type
       or new.split is distinct from old.split
       or new.payers is distinct from old.payers then
      perform log(new.flat_id, auth.uid(), 'expense_edited', new.description, new.amount,
                  jsonb_build_object('expense', new.id, 'was_amount', old.amount,
                                     'was_description', old.description));
    end if;
    return new;
  else
    -- an expense deleted earlier (delete_expense logged it then) being cleared away for good
    if old.deleted_at is not null then return old; end if;
    perform log(old.flat_id, auth.uid(), 'expense_deleted', old.description, old.amount,
                jsonb_build_object('expense', old.id));
    return old;
  end if;
end; $function$;

-- give every existing expense its stored shares (equal splits: identical to what the apps show today)
update public.expenses set split_type = split_type;

-- --------------------------------------------------------------- balances

-- What someone is up or down in one of the flat's currency books: plain sums of the
-- stored postings. (After this migration every expense and payment has a currency.)
create or replace function public.flat_balance_in(p_flat uuid, p_uid uuid, p_cur text)
returns numeric
language sql stable security definer set search_path to 'public'
as $function$
  with e as (
    select amount, paid_by, payers, shares from expenses
    where flat_id = p_flat and deleted_at is null and currency = p_cur
  ), s as (
    select amount, from_user, to_user from settlements
    where flat_id = p_flat and currency = p_cur
  )
  select ((
      coalesce((select sum(case when payers is not null then coalesce((payers ->> p_uid::text)::numeric, 0)
                                when paid_by = p_uid then to_minor(amount, p_cur) else 0 end) from e), 0)
    - coalesce((select sum(coalesce((shares ->> p_uid::text)::numeric, 0)) from e), 0)
    + coalesce((select sum(to_minor(amount, p_cur)) from s where from_user = p_uid), 0)
    - coalesce((select sum(to_minor(amount, p_cur)) from s where to_user = p_uid), 0)
  ) / power(10::numeric, minor_digits(p_cur)))
$function$;

-- ... in the flat's main currency (other currencies keep their own books, as in the apps)
create or replace function public.flat_balance(p_flat uuid, p_uid uuid)
returns numeric
language plpgsql stable security definer set search_path to 'public'
as $function$
declare c text;
begin
  if auth.uid() is not null and not is_member(p_flat) then
    raise exception 'Not your flat';
  end if;
  c := flat_currency(p_flat);
  if c is null then return 0; end if;   -- no expenses and no payments
  return flat_balance_in(p_flat, p_uid, c);
end; $function$;

-- Removing someone needs them square in every currency the flat uses, not just the main one.
create or replace function public.remove_member(p_flat uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare c text; v_bal numeric;
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  if p_uid = auth.uid() then raise exception 'Use Leave to remove yourself'; end if;
  for c in select currency from expenses where flat_id = p_flat and deleted_at is null
           union select currency from settlements where flat_id = p_flat
           order by 1 loop
    v_bal := flat_balance_in(p_flat, p_uid, c);
    if abs(v_bal) > 0.5 then
      raise exception 'Settle up with them first — they are % % %',
        case when v_bal > 0 then 'owed' else 'down' end,
        to_char(abs(v_bal), case when minor_digits(c) = 0 then 'FM999999999990'
                                 else 'FM999999999990.' || repeat('0', minor_digits(c)) end),
        c || ' here';
    end if;
  end loop;
  delete from flat_members where flat_id = p_flat and user_id = p_uid;
end; $function$;

-- ------------------------------------------------------------- payments

-- A payment is between two different people of the flat (someone who has left
-- included — settling up with them is the point), in a currency: an app that
-- doesn't say (Build 8) paid in the flat's main currency at the time.
create or replace function public.settlement_check()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), flat_currency(new.flat_id), 'EUR'));
  new.amount := round(new.amount, minor_digits(new.currency));
  if tg_op = 'INSERT' or new.from_user is distinct from old.from_user or new.to_user is distinct from old.to_user then
    if new.from_user = new.to_user then perform split_error('bad_value', null, 'to_user'); end if;
    if not exists (select 1 from flat_members where flat_id = new.flat_id and user_id = new.from_user) then
      perform split_error('not_in_flat', null, new.from_user::text);
    end if;
    if not exists (select 1 from flat_members where flat_id = new.flat_id and user_id = new.to_user) then
      perform split_error('not_in_flat', null, new.to_user::text);
    end if;
  end if;
  return new;
end; $function$;

-- the payments recorded so far were made in what was then the flat's currency
update public.settlements set currency = coalesce(flat_currency(flat_id), 'EUR') where coalesce(currency, '') = '';
update public.settlements set currency = upper(btrim(currency)) where currency <> upper(btrim(currency));
alter table public.settlements alter column currency set not null;
alter table public.settlements drop constraint if exists settlements_currency_iso;
alter table public.settlements add constraint settlements_currency_iso check (currency ~ '^[A-Z]{3}$');

drop trigger if exists settlement_check on public.settlements;
create trigger settlement_check before insert or update on public.settlements
  for each row execute function public.settlement_check();

-- The push for a new expense: everyone in it with their share (0 included, so
-- nobody is told they owe an even split of a bill they owe nothing of), in the
-- expense's own currency. A recurring expense catching up on past dates is in
-- the activity feed, but doesn't ring anyone's phone.
create or replace function public.on_expense_insert()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.recurring_id is not null and new.spent_on < current_date then return new; end if;
  perform push_notify(jsonb_build_object(
    'event', 'expense_added',
    'flat_id', new.flat_id,
    'actor', new.created_by,
    'amount', new.amount,
    'currency', new.currency,
    'description', coalesce(nullif(new.description, ''), 'New shared expense'),
    'paid_by', new.paid_by,
    'payers', new.payers,   -- null: paid_by paid it all
    'split_among', to_jsonb(new.split_among),
    'shares', coalesce((select jsonb_object_agg(u::text, 0) from unnest(new.split_among) u), '{}'::jsonb)
              || coalesce(new.shares, '{}'::jsonb)
  ));
  return new;
end; $function$;

-- a payment's push, and a reminder's, say which currency the amount is in
create or replace function public.on_settlement_insert()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform push_notify(jsonb_build_object(
    'event', 'settlement', 'flat_id', new.flat_id, 'actor', new.created_by,
    'to_user', new.to_user, 'amount', new.amount,
    'currency', coalesce(nullif(new.currency, ''), flat_currency(new.flat_id), 'EUR')
  ));
  return new;
end; $function$;

create or replace function public.nudge(p_flat uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_last timestamptz; v_bal numeric; v_name text; v_cur text;
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  if p_uid = auth.uid() then raise exception 'You do not owe yourself'; end if;

  select max(sent_at) into v_last from nudges
    where flat_id = p_flat and from_user = auth.uid() and to_user = p_uid;
  if v_last is not null and v_last > now() - interval '20 hours' then
    raise exception 'You already reminded them today';
  end if;

  -- in the flat's main currency; the minimum is 50 minor units (0,50 €), as Ledger.nudgeMinimum
  v_cur := coalesce(flat_currency(p_flat), 'EUR');
  v_bal := flat_balance_in(p_flat, p_uid, v_cur);
  if to_minor(v_bal, v_cur) >= -50 then raise exception 'They do not owe anything here'; end if;

  select coalesce(nullif(display_name, ''), 'Someone') into v_name
    from flat_members where flat_id = p_flat and user_id = auth.uid();

  insert into nudges(flat_id, from_user, to_user) values (p_flat, auth.uid(), p_uid);
  perform push_notify(jsonb_build_object(
    'event', 'nudge', 'flat_id', p_flat, 'actor', auth.uid(),
    'to_user', p_uid, 'amount', -v_bal, 'title', v_name, 'currency', v_cur
  ));
end; $function$;

-- --------------------------------------------------- delete, and undo it

-- A deleted expense is kept, hidden, and can be brought back — by anyone in
-- the flat, as Splitwise does. Apps from before this still delete for good.
drop policy if exists exp_read on public.expenses;
create policy exp_read on public.expenses for select using (is_member(flat_id) and deleted_at is null);

create or replace function public.delete_expense(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare e expenses;
begin
  select * into e from expenses where id = p_id and deleted_at is null for update;
  if not found or not is_member(e.flat_id) then raise exception 'No such expense'; end if;
  update expenses set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  perform log(e.flat_id, auth.uid(), 'expense_deleted', e.description, e.amount, jsonb_build_object('expense', e.id, 'restorable', true));
  -- Realtime checks each change against the reader's access, and a deleted expense is
  -- hidden — so nobody would hear of this one. Touch a row every open app listens to.
  update flat_members set display_name = display_name where flat_id = e.flat_id and user_id = auth.uid();
end; $function$;

create or replace function public.restore_expense(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare e expenses; stray text;
begin
  select * into e from expenses where id = p_id and deleted_at is not null for update;
  if not found or not is_member(e.flat_id) then raise exception 'No such deleted expense'; end if;
  -- bringing it back must not put money on someone who has left since
  select z.u into stray from (
      select e.paid_by::text as u where e.payers is null
      union select key from jsonb_each(case when jsonb_typeof(e.payers) = 'object' then e.payers else '{}' end)
             where value::text::numeric <> 0
      union select key from jsonb_each(case when jsonb_typeof(e.shares) = 'object' then e.shares else '{}' end)
             where value::text::numeric <> 0
    ) z
    where not exists (select 1 from flat_members m
                      where m.flat_id = e.flat_id and m.user_id::text = z.u and m.left_at is null)
    limit 1;
  if stray is not null then perform split_error('not_in_flat', null, stray); end if;
  update expenses set deleted_at = null, deleted_by = null where id = p_id;
  perform log(e.flat_id, auth.uid(), 'expense_restored', e.description, e.amount, jsonb_build_object('expense', e.id));
end; $function$;

create or replace function public.deleted_expenses(p_flat uuid)
returns setof public.expenses
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  return query select * from expenses where flat_id = p_flat and deleted_at is not null order by deleted_at desc;
end; $function$;

-- --------------------------------------------------------- simplify debts

-- anyone in the flat can switch it, and everyone can see who did (as in Splitwise)
create or replace function public.set_simplify_debts(p_flat uuid, p_on boolean)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  update flats set simplify_debts = p_on where id = p_flat and simplify_debts is distinct from p_on;
  if found then
    perform log(p_flat, auth.uid(), case when p_on then 'simplify_on' else 'simplify_off' end, null, null, '{}'::jsonb);
  end if;
end; $function$;

-- the flat's default split; null clears it. Checked here, so a broken default can never reach a form.
create or replace function public.set_default_split(p_flat uuid, p_split jsonb)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  if p_split is not null then
    if coalesce(p_split ->> 'type', '') not in ('equal', 'percent', 'shares') then
      raise exception using errcode = 'P0001', message = 'split: a default split is equal, by percentage or by shares',
        detail = '{"code": "unknown_type"}';
    end if;
    p_split := norm_split(p_split);
    if exists (select 1 from jsonb_object_keys(case when jsonb_typeof(p_split -> 'values') = 'object' then p_split -> 'values' else '{}' end) k
               where not exists (select 1 from flat_members m where m.flat_id = p_flat and m.user_id::text = k and m.left_at is null)) then
      perform split_error('not_in_flat');
    end if;
    -- a trial run on 100.00 proves the percentages add up and the shares are sane
    perform split_shares(gen_random_uuid(), 100, 'EUR', null, '{}', p_split ->> 'type', p_split)
      where p_split ->> 'type' <> 'equal';
  end if;
  update flats set default_split = p_split where id = p_flat;
end; $function$;

-- -------------------------------------------------------------- recurring

create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats(id) on delete cascade,
  -- whoever last shaped what it adds; the expenses it makes are theirs. Kept if they
  -- leave; cleared (and the expenses made with no author) if they delete their account.
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  description text not null default '',
  amount numeric not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_by uuid not null,
  payers jsonb,
  split_among uuid[] not null default '{}',
  split_type text not null default 'equal'
    check (split_type in ('equal', 'exact', 'percent', 'shares', 'adjust', 'itemized')),
  split jsonb,
  category text not null default 'other',
  cadence text not null check (cadence in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  anchor_on date not null,
  -- the number of the next occurrence to create (0 = anchor_on itself)
  next_n integer not null default 0 check (next_n >= 0),
  until_on date,
  active boolean not null default true,
  -- why it isn't active: paused by someone, ended (until_on reached), or stopped by the
  -- generator because someone in it left or its split no longer works
  stopped text check (stopped in ('paused', 'ended', 'member_left', 'error')),
  created_at timestamptz not null default now()
);
alter table public.recurring_expenses alter column currency drop default;
alter table public.recurring_expenses enable row level security;
drop policy if exists rec_read on public.recurring_expenses;
drop policy if exists rec_insert on public.recurring_expenses;
drop policy if exists rec_update on public.recurring_expenses;
drop policy if exists rec_delete on public.recurring_expenses;
create policy rec_read on public.recurring_expenses for select using (is_member(flat_id));
create policy rec_insert on public.recurring_expenses for insert with check (is_member(flat_id) and created_by = auth.uid());
create policy rec_update on public.recurring_expenses for update using (is_member(flat_id)) with check (is_member(flat_id));
create policy rec_delete on public.recurring_expenses for delete using (is_member(flat_id));

alter table public.expenses drop constraint if exists expenses_recurring_fk;
alter table public.expenses add constraint expenses_recurring_fk
  foreign key (recurring_id) references public.recurring_expenses(id) on delete set null;
-- one expense per occurrence, however often the generator runs (keyed by the occurrence's
-- number, not its date: someone may move an occurrence to another day)
drop index if exists public.expenses_recurring_once;
create unique index expenses_recurring_once on public.expenses (recurring_id, recurring_n) where recurring_id is not null;

-- The n-th date a recurring expense falls due, counted from the first — never
-- from the previous one, so the 31st becomes the 28th/29th in February and the
-- 31st again in March (Postgres clamps month arithmetic to the month's end).
create or replace function public.recurring_occurrence(p_anchor date, p_cadence text, p_n integer)
returns date
language sql immutable parallel safe set search_path to 'public'
as $function$
  select case p_cadence
    when 'weekly'    then p_anchor + 7 * p_n
    when 'biweekly'  then p_anchor + 14 * p_n
    when 'monthly'   then (p_anchor + make_interval(months => p_n))::date
    when 'quarterly' then (p_anchor + make_interval(months => 3 * p_n))::date
    when 'yearly'    then (p_anchor + make_interval(years => p_n))::date
  end
$function$;

-- A template is checked when it is saved, not first at the hour it falls due: the
-- same split and payer rules as an expense, everyone in it a current member, the
-- first date no more than a year back (it catches up on every date since), and a
-- sane number per flat.
create or replace function public.recurring_check()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare trial jsonb; stray text;
begin
  if tg_op = 'INSERT' then
    if new.anchor_on < current_date - 366 or new.anchor_on > current_date + 3660 then
      raise exception using errcode = 'P0001', message = 'recurring: the first date must be at most a year ago',
        detail = '{"code": "bad_anchor"}';
    end if;
    if (select count(*) from recurring_expenses where flat_id = new.flat_id and active) >= 50 then
      raise exception using errcode = 'P0001', message = 'recurring: a flat can have 50 at most',
        detail = '{"code": "too_many"}';
    end if;
  end if;
  new.split_type := coalesce(new.split_type, 'equal');
  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), flat_currency(new.flat_id), 'EUR'));
  new.amount := round(new.amount, minor_digits(new.currency));
  new.split := case when new.split_type = 'equal' then null else norm_split(new.split) end;
  new.payers := norm_payers(new.amount, new.currency, new.paid_by, new.payers);
  trial := split_shares(new.id, new.amount, new.currency, new.paid_by, new.split_among, new.split_type, new.split);
  if new.split_type in ('exact', 'percent', 'shares', 'itemized') then
    select coalesce(array_agg(key::uuid order by key), '{}') into new.split_among from jsonb_each(trial);
  end if;
  -- who is on it (the same list generate_recurring checks before every occurrence)
  if coalesce(current_setting('heimat.internal', true), '') <> 'on' then
    select z.u into stray
      from (select jsonb_object_keys(trial) as u
            union select jsonb_object_keys(coalesce(new.payers, '{}'))
            union select x::text from unnest(new.split_among) x
            union select new.paid_by::text) z
      where not exists (select 1 from flat_members m
                        where m.flat_id = new.flat_id and m.user_id::text = z.u and m.left_at is null)
      limit 1;
    if stray is not null then perform split_error('not_in_flat', null, stray); end if;
  end if;
  return new;
end; $function$;

drop trigger if exists recurring_check on public.recurring_expenses;
create trigger recurring_check before insert or update of amount, currency, paid_by, payers, split_among, split_type, split
  on public.recurring_expenses for each row execute function public.recurring_check();

-- Anyone in the flat may change a recurring expense, and everyone can see who did.
-- Whoever last changed what it adds becomes its author. Its schedule and progress
-- belong to the generator: resuming a paused one carries on from today, it does
-- not bill the time it was paused.
create or replace function public.recurring_edit()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  -- the generator (pg_cron: no user) and server-side rewrites keep their own bookkeeping
  if auth.uid() is null or coalesce(current_setting('heimat.internal', true), '') = 'on' then return new; end if;
  new.flat_id := old.flat_id; new.created_at := old.created_at;
  new.anchor_on := old.anchor_on; new.cadence := old.cadence; new.next_n := old.next_n;
  if (new.description, new.amount, new.currency, new.paid_by, new.payers, new.split_among, new.split_type,
      new.split, new.category, new.until_on)
     is distinct from
     (old.description, old.amount, old.currency, old.paid_by, old.payers, old.split_among, old.split_type,
      old.split, old.category, old.until_on) then
    new.created_by := auth.uid();
    perform log(new.flat_id, auth.uid(), 'recurring_edited', new.description, new.amount,
                jsonb_build_object('recurring', new.id, 'was_amount', old.amount, 'was_created_by', old.created_by));
  else
    new.created_by := old.created_by;
  end if;
  new.stopped := old.stopped;
  if new.active is distinct from old.active then
    if new.active then
      -- resuming after someone paused it carries on from today (the paused time isn't
      -- billed); after the generator stopped it, the occurrences it held back are still
      -- due — back to at most a year ago
      new.next_n := greatest(old.next_n, coalesce(
        (select min(n) from generate_series(old.next_n, old.next_n + 6000) n
          where recurring_occurrence(old.anchor_on, old.cadence, n)
                >= case when coalesce(old.stopped, 'paused') = 'paused' then current_date else current_date - 366 end),
        old.next_n));
      new.stopped := null;
    else
      new.stopped := 'paused';
    end if;
    perform log(new.flat_id, auth.uid(), case when new.active then 'recurring_resumed' else 'recurring_paused' end,
                new.description, new.amount, jsonb_build_object('recurring', new.id));
  end if;
  return new;
end; $function$;

drop trigger if exists recurring_edit on public.recurring_expenses;
create trigger recurring_edit before update on public.recurring_expenses
  for each row execute function public.recurring_edit();

create or replace function public.recurring_log()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform log(new.flat_id, new.created_by, 'recurring_added', new.description, new.amount,
                jsonb_build_object('recurring', new.id, 'cadence', new.cadence, 'from', new.anchor_on));
    return new;
  end if;
  -- not while the whole flat is being deleted: there is no feed left to write to
  if exists (select 1 from flats where id = old.flat_id) then
    perform log(old.flat_id, auth.uid(), 'recurring_deleted', old.description, old.amount,
                jsonb_build_object('recurring', old.id));
  end if;
  return old;
end; $function$;

drop trigger if exists recurring_log on public.recurring_expenses;
create trigger recurring_log after insert or delete on public.recurring_expenses
  for each row execute function public.recurring_log();

-- Create every occurrence that has fallen due. Safe to run as often as you
-- like: an occurrence already created is skipped (expenses_recurring_once, by number).
-- Each run is bounded (60 dates a template, 2000 in all); the rest carries over.
create or replace function public.generate_recurring()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare t recurring_expenses; d date; made integer := 0; n integer; stray text;
begin
  for t in select * from recurring_expenses where active order by created_at, id for update skip locked loop
    exit when made >= 2000;
    -- one template's trouble (a split that no longer adds up, say) must not stop
    -- everyone else's rent: it is paused, in the feed, and skipped
    begin
      -- anyone on it (who pays, a payer, anyone with a share or in the split — the list
      -- recurring_check used) who is no longer in the flat (left, or deleted their
      -- account): stop, rather than keep charging them or crediting someone who isn't there
      select z.u into stray from (
          select t.paid_by::text as u
          union select x::text from unnest(t.split_among) x
          union select k from jsonb_object_keys(case when jsonb_typeof(t.payers) = 'object' then t.payers else '{}' end) k
          union select k from jsonb_object_keys(split_shares(t.id, t.amount, t.currency, t.paid_by, t.split_among, t.split_type, t.split)) k
        ) z
        where z.u <> '' and not exists (select 1 from flat_members m
                                        where m.flat_id = t.flat_id and m.user_id::text = z.u and m.left_at is null)
        limit 1;
      if stray is not null then
        update recurring_expenses set active = false, stopped = 'member_left' where id = t.id;
        perform log(t.flat_id, null, 'recurring_stopped', t.description, t.amount,
                    jsonb_build_object('recurring', t.id, 'reason', 'member_left', 'who', stray));
        continue;
      end if;
      n := t.next_n;
      loop
        d := recurring_occurrence(t.anchor_on, t.cadence, n);
        exit when d > current_date or (t.until_on is not null and d > t.until_on) or n - t.next_n >= 60 or made >= 2000;
        insert into expenses (flat_id, description, amount, currency, paid_by, payers, split_among, split_type, split,
                              category, created_by, spent_on, recurring_id, recurring_n)
        values (t.flat_id, t.description, t.amount, t.currency, t.paid_by, t.payers, t.split_among, t.split_type, t.split,
                t.category, t.created_by, d, t.id, n)
        on conflict (recurring_id, recurring_n) where recurring_id is not null do nothing;
        if found then made := made + 1; end if;
        n := n + 1;
      end loop;
      update recurring_expenses
        set next_n = n,
            active = (until_on is null or recurring_occurrence(anchor_on, cadence, n) <= until_on),
            stopped = case when until_on is null or recurring_occurrence(anchor_on, cadence, n) <= until_on then null else 'ended' end
        where id = t.id;
    exception when others then
      update recurring_expenses set active = false, stopped = 'error' where id = t.id;
      perform log(t.flat_id, null, 'recurring_paused', t.description, t.amount,
                  jsonb_build_object('recurring', t.id, 'reason', 'error', 'error', sqlerrm));
    end;
  end loop;
  return made;
end; $function$;

-- hourly through the German day (08:05–23:05 summer time, 07:05–22:05 winter time,
-- the database clock is UTC): what falls due today is added — and pushed — in the
-- morning, never in the middle of the night
select cron.unschedule(jobid) from cron.job where jobname = 'heimat-recurring';
select cron.schedule('heimat-recurring', '5 6-21 * * *', 'select public.generate_recurring()');

-- ------------------------------------------------ people joining and leaving

-- Moving someone's money from one id to another inside a split or a payers map
-- (a pending invite taken over by a real account). When both ids are already
-- there, their amounts are added together.
create or replace function public.rekey_uid(o jsonb, f text, t text)
returns jsonb
language sql immutable set search_path to 'public'
as $function$
  select case when jsonb_typeof(o) = 'object' and o ? f then
    (o - f - t) || jsonb_build_object(t,
      case when jsonb_typeof(o -> t) = 'number' and jsonb_typeof(o -> f) = 'number'
           then to_jsonb((o ->> t)::numeric + (o ->> f)::numeric) else o -> f end)
  else o end
$function$;

create or replace function public.rekey_split(s jsonb, f text, t text)
returns jsonb
language sql immutable set search_path to 'public'
as $function$
  select case when jsonb_typeof(s) <> 'object' then s else
    (case when s ? 'values' then jsonb_set(s, '{values}', rekey_uid(s -> 'values', f, t)) else s end)
    || case when jsonb_typeof(s -> 'items') = 'array' then jsonb_build_object('items', (
         select jsonb_agg(case when jsonb_typeof(it -> 'among') = 'array' then jsonb_set(it, '{among}', (
                    select coalesce(jsonb_agg(to_jsonb(u) order by o), '[]'::jsonb)
                    from (select case when a = f then t else a end as u, min(o) as o
                          from jsonb_array_elements_text(it -> 'among') with ordinality z(a, o) group by 1) w))
                  else it end order by io)
         from jsonb_array_elements(s -> 'items') with ordinality x(it, io)))
       else '{}'::jsonb end
  end
$function$;

-- Someone takes over a pending invite (or a placeholder): everything recorded under
-- the placeholder's id becomes theirs — who paid, the split, several payers, the
-- stored split inputs, recurring expenses, the flat's default split. Each expense is
-- rewritten in one statement, so its payer, payers and split change together and it
-- is re-split under the same rules. It is a server-side rewrite (heimat.internal), not
-- an edit anyone made: no "changed" entries in the feed, no author changes.
create or replace function public.claim_member(p_member uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members; existing_id uuid; f text; t text; came_back boolean := false;
begin
  select * into m from flat_members where id = p_member;
  -- an invite someone was removed from (kept as left for its history) is dead
  if m.id is null or m.claimed_at is not null or m.left_at is not null or p_uid is null then return; end if;
  f := m.user_id::text; t := p_uid::text;
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
      shares = case when e.split_type in ('equal', 'adjust')
                         or (coalesce(e.shares, '{}') ? f and coalesce(e.shares, '{}') ? t)
                    then e.shares else rekey_uid(e.shares, f, t) end
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
  perform set_config('heimat.internal', '', true);
end; $function$;

-- Forgetting a pending invitee (declined, or withdrawn). Taking them out of an
-- equal split has an obvious answer; anything else — they paid, they're in a split
-- by amounts, percentages, shares or items, or in a recurring expense — has none,
-- so it is refused until someone changes it.
create or replace function public.forget_member(p_flat uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if exists (select 1 from expenses where flat_id = p_flat and deleted_at is null
             and (paid_by = p_uid or coalesce(payers, '{}') ? p_uid::text)) then
    raise exception 'They are down as paying for an expense — change or delete it first';
  end if;
  if exists (select 1 from expenses where flat_id = p_flat and deleted_at is null and split_type <> 'equal'
             and (p_uid = any(split_among) or coalesce(shares, '{}') ? p_uid::text
                  or position(p_uid::text in coalesce(split::text, '')) > 0)) then
    raise exception 'They are in an expense that isn''t split equally — change or delete it first';
  end if;
  -- taking them out would leave an expense several people paid for with nobody in it
  if exists (select 1 from expenses where flat_id = p_flat and deleted_at is null and payers is not null
             and p_uid = any(split_among) and split_among <@ array[p_uid]) then
    raise exception 'They are the only one in an expense several people paid for — change or delete it first';
  end if;
  if exists (select 1 from recurring_expenses where flat_id = p_flat
             and (paid_by = p_uid or p_uid = any(split_among)
                  or position(p_uid::text in coalesce(payers::text, '') || coalesce(split::text, '')) > 0)) then
    raise exception 'They are in a recurring expense — change or delete it first';
  end if;
  perform set_config('heimat.internal', 'on', true);
  -- expenses already deleted that name them can't be seen, fixed or (once they are gone)
  -- restored: they go for good, as deleting did before v2
  delete from expenses where flat_id = p_flat and deleted_at is not null
    and (paid_by = p_uid or p_uid = any(split_among) or coalesce(payers, '{}') ? p_uid::text
         or coalesce(shares, '{}') ? p_uid::text or position(p_uid::text in coalesce(split::text, '')) > 0);
  update expenses set split_among = array_remove(split_among, p_uid)
    where flat_id = p_flat and p_uid = any(split_among);
  perform set_config('heimat.internal', '', true);
  update flats set default_split = null
    where id = p_flat and position(p_uid::text in coalesce(default_split::text, '')) > 0;
  delete from settlements where flat_id = p_flat and (from_user = p_uid or to_user = p_uid);
  update flat_items set bought_by = null where flat_id = p_flat and bought_by = p_uid;
  delete from flat_members where flat_id = p_flat and user_id = p_uid;
end; $function$;

-- Someone with money in the flat is kept (marked as left) rather than deleted —
-- including as one of several payers, in a stored share, or in a recurring expense.
create or replace function public.has_history(p_flat uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from expenses e
    where e.flat_id = p_flat and (e.paid_by = p_uid or p_uid = any(e.split_among)
                                  or coalesce(e.payers, '{}') ? p_uid::text or coalesce(e.shares, '{}') ? p_uid::text)
  ) or exists (
    select 1 from settlements s
    where s.flat_id = p_flat and (s.from_user = p_uid or s.to_user = p_uid)
  ) or exists (
    select 1 from recurring_expenses r
    where r.flat_id = p_flat and (r.paid_by = p_uid or p_uid = any(r.split_among)
                                  or position(p_uid::text in coalesce(r.payers::text, '') || coalesce(r.split::text, '')) > 0)
  );
$function$;

-- One invite that can't be taken over must not undo the others.
create or replace function public.claim_invites()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_email text; r record; n integer := 0;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;
  for r in select id from flat_members
             where claimed_at is null and left_at is null and lower(invite_email) = v_email
  loop
    begin
      perform claim_member(r.id, auth.uid());
      n := n + 1;
    exception when others then
      raise warning 'claim_invites: member % not taken over: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end; $function$;

create or replace function public.claim_invites_for_new_email()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare r record;
begin
  if new.email is null then return new; end if;
  if tg_op = 'UPDATE' and old.email is not distinct from new.email then return new; end if;
  for r in select id from flat_members
             where claimed_at is null and left_at is null and lower(invite_email) = lower(new.email)
  loop
    begin
      perform claim_member(r.id, new.id);
    exception when others then
      raise warning 'claim_invites_for_new_email: member % not taken over: %', r.id, sqlerrm;
    end;
  end loop;
  return new;
exception when others then
  return new;
end; $function$;

create or replace function public.claim_invite(p_token text)
returns flats
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members; f flats;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into m from flat_members where invite_token = p_token and claimed_at is null and left_at is null;
  if m.id is null then raise exception 'That invite has already been used'; end if;
  perform claim_member(m.id, auth.uid());
  select * into f from flats where id = m.flat_id;
  return f;
end; $function$;

-- Declining always works for the invitee: if the flat's expenses can't simply drop
-- them, they stay in the books as someone who has left, and the invite is dead.
create or replace function public.decline_invite(p_token text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members;
begin
  select * into m from flat_members where invite_token = p_token and claimed_at is null;
  if m.id is null then return; end if;
  begin
    perform forget_member(m.flat_id, m.user_id);
  exception when others then
    update flat_members set left_at = coalesce(left_at, now()), invite_token = null where id = m.id;
  end;
end; $function$;

-- Someone with money in the flat is kept as having left, not deleted. An invite they
-- never took up dies with it, and a default split that names them is cleared.
create or replace function public.on_member_delete()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  update flats set default_split = null
    where id = old.flat_id and position(old.user_id::text in coalesce(default_split::text, '')) > 0;
  if has_history(old.flat_id, old.user_id) then
    update flat_members set left_at = coalesce(left_at, now()),
                            invite_token = case when claimed_at is null then null else invite_token end
      where id = old.id;
    return null;
  end if;
  return old;
end; $function$;

-- The feed: someone coming back is "joined"; an invite folded into an existing
-- membership by claim_member is not a withdrawn invite.
create or replace function public.log_member()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform log(new.flat_id, coalesce(new.invited_by, new.user_id),
                case when new.invite_email is not null and new.claimed_at is null then 'invited' else 'joined' end,
                new.display_name, null, jsonb_build_object('who', new.user_id));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.left_at is null and new.left_at is not null then
      perform log(new.flat_id, auth.uid(), 'left', new.display_name, null,
                  jsonb_build_object('who', new.user_id));
    elsif old.left_at is not null and new.left_at is null and new.claimed_at is not null then
      perform log(new.flat_id, new.user_id, 'joined', new.display_name, null,
                  jsonb_build_object('who', new.user_id));
    elsif old.claimed_at is null and new.claimed_at is not null then
      perform log(new.flat_id, new.user_id, 'joined', new.display_name, null,
                  jsonb_build_object('who', new.user_id));
    end if;
    return new;
  else
    if coalesce(current_setting('heimat.internal', true), '') = 'on' then return old; end if;
    perform log(old.flat_id, auth.uid(),
                case when old.claimed_at is null then 'invite_withdrawn' else 'left' end,
                old.display_name, null, jsonb_build_object('who', old.user_id));
    return old;
  end if;
end; $function$;

-- Someone who left can come back with the flat's code.
create or replace function public.join_flat(p_code text, p_display_name text)
returns flats
language plpgsql security definer set search_path to 'public'
as $function$
declare v_flat flats;
begin
  select * into v_flat from flats where join_code = upper(p_code);
  if v_flat.id is null then raise exception 'Invalid flat code'; end if;
  insert into flat_members(flat_id, user_id, display_name, claimed_at)
    values (v_flat.id, auth.uid(), coalesce(nullif(p_display_name,''),'Me'), now())
    on conflict (flat_id, user_id)
    do update set claimed_at = coalesce(flat_members.claimed_at, now()), left_at = null;
  return v_flat;
end; $function$;

-- Inviting someone who had left brings them back (an account) or sends a fresh
-- invite (an address that never signed up).
create or replace function public.invite_member(p_flat uuid, p_email text, p_name text)
returns flat_members
language plpgsql security definer set search_path to 'public'
as $function$
declare v_email text; v_uid uuid; v_row flat_members;
begin
  if not is_member(p_flat) then raise exception 'Not your group'; end if;
  v_email := lower(trim(p_email));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select id into v_uid from auth.users
    where lower(email) = v_email and deleted_at is null limit 1;

  if v_uid is not null then
    select * into v_row from flat_members where flat_id = p_flat and user_id = v_uid;
    if v_row.id is not null then
      if v_row.left_at is not null then
        update flat_members set left_at = null, claimed_at = coalesce(claimed_at, now())
          where id = v_row.id returning * into v_row;
      end if;
      return v_row;
    end if;
    insert into flat_members(flat_id, user_id, display_name, invited_by, claimed_at)
      values (p_flat, v_uid, coalesce(nullif(p_name, ''), split_part(v_email, '@', 1)),
              auth.uid(), now())
      returning * into v_row;
    return v_row;
  end if;

  select * into v_row from flat_members
    where flat_id = p_flat and lower(invite_email) = v_email and claimed_at is null;
  if v_row.id is not null then
    if v_row.left_at is not null then
      update flat_members set left_at = null, invite_token = replace(gen_random_uuid()::text, '-', ''),
                              invited_by = auth.uid()
        where id = v_row.id returning * into v_row;
      perform invite_notify(jsonb_build_object(
        'event', 'invited', 'email', v_row.invite_email, 'name', v_row.display_name, 'invite', v_row.invite_token,
        'flat', (select name from flats where id = p_flat),
        'kind', coalesce((select kind from flats where id = p_flat), 'group'),
        'inviter', coalesce((select nullif(display_name, '') from flat_members where flat_id = p_flat and user_id = auth.uid()), 'Someone')));
    end if;
    return v_row;
  end if;

  insert into flat_members(flat_id, user_id, display_name, invite_email, invite_token, invited_by)
    values (p_flat,
            gen_random_uuid(),
            coalesce(nullif(p_name, ''), split_part(v_email, '@', 1)),
            v_email,
            replace(gen_random_uuid()::text, '-', ''),
            auth.uid())
    returning * into v_row;
  return v_row;
end; $function$;

create or replace function public.log_settlement()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform log(new.flat_id, coalesce(new.created_by, new.from_user), 'settled',
                (select display_name from flat_members where flat_id = new.flat_id and user_id = new.to_user),
                new.amount, jsonb_build_object('from', new.from_user, 'to', new.to_user));
    return new;
  end if;
  if coalesce(current_setting('heimat.internal', true), '') = 'on' then return old; end if;
  perform log(old.flat_id, auth.uid(), 'settle_undone',
              (select display_name from flat_members where flat_id = old.flat_id and user_id = old.to_user),
              old.amount, jsonb_build_object('from', old.from_user, 'to', old.to_user));
  return old;
end; $function$;

-- --------------------------------------------------------------- grants

revoke all on function public.alloc_weighted(bigint, text[], numeric[], text)                  from public, anon, authenticated;
revoke all on function public.minor_digits(text)                                              from public, anon, authenticated;
revoke all on function public.to_minor(numeric, text)                                          from public, anon, authenticated;
revoke all on function public.jint(jsonb)                                                      from public, anon, authenticated;
revoke all on function public.split_error(text, bigint, text)                                  from public, anon, authenticated;
revoke all on function public.norm_uid(text)                                                   from public, anon, authenticated;
revoke all on function public.norm_uids(jsonb)                                                 from public, anon, authenticated;
revoke all on function public.norm_split(jsonb)                                                from public, anon, authenticated;
revoke all on function public.split_shares(uuid, numeric, text, uuid, uuid[], text, jsonb)     from public, anon, authenticated;
revoke all on function public.check_payers(numeric, text, jsonb)                               from public, anon, authenticated;
revoke all on function public.norm_payers(numeric, text, uuid, jsonb)                          from public, anon, authenticated;
revoke all on function public.flat_currency(uuid)                                              from public, anon, authenticated;
revoke all on function public.flat_balance_in(uuid, uuid, text)                                from public, anon, authenticated;
revoke all on function public.settlement_check()                                               from public, anon, authenticated;
revoke all on function public.on_member_delete()                                               from public, anon, authenticated;
revoke all on function public.log_member()                                                     from public, anon, authenticated;
revoke all on function public.expense_v2_write()                                               from public, anon, authenticated;
revoke all on function public.expense_postings()                                               from public, anon, authenticated;
revoke all on function public.log_expense()                                                    from public, anon, authenticated;
revoke all on function public.on_expense_insert()                                              from public, anon, authenticated;
revoke all on function public.recurring_occurrence(date, text, integer)                        from public, anon, authenticated;
revoke all on function public.recurring_check()                                                from public, anon, authenticated;
revoke all on function public.recurring_edit()                                                 from public, anon, authenticated;
revoke all on function public.recurring_log()                                                  from public, anon, authenticated;
revoke all on function public.generate_recurring()                                             from public, anon, authenticated;
revoke all on function public.rekey_uid(jsonb, text, text)                                     from public, anon, authenticated;
revoke all on function public.rekey_split(jsonb, text, text)                                   from public, anon, authenticated;
revoke all on function public.claim_member(uuid, uuid)                                         from public, anon, authenticated;
revoke all on function public.forget_member(uuid, uuid)                                        from public, anon, authenticated;
revoke all on function public.has_history(uuid, uuid)                                          from public, anon, authenticated;
revoke all on function public.delete_expense(uuid)                                             from public, anon;
revoke all on function public.restore_expense(uuid)                                            from public, anon;
revoke all on function public.deleted_expenses(uuid)                                           from public, anon;
revoke all on function public.set_simplify_debts(uuid, boolean)                                from public, anon;
revoke all on function public.set_default_split(uuid, jsonb)                                   from public, anon;
grant execute on function public.delete_expense(uuid)          to authenticated;
grant execute on function public.restore_expense(uuid)         to authenticated;
grant execute on function public.deleted_expenses(uuid)        to authenticated;
grant execute on function public.set_simplify_debts(uuid, boolean) to authenticated;
grant execute on function public.set_default_split(uuid, jsonb)     to authenticated;

-- Apps write only what is theirs to write. Deleting and restoring go through
-- delete_expense / restore_expense, occurrences come from generate_recurring, and
-- shares from expense_postings — all server-side. Leaving flat_id and created_by out
-- of UPDATE also means an expense can't be moved to another flat or re-authored.
-- (Reading and hard-deleting are unchanged: Build 8 still deletes for good.)
revoke insert, update on public.expenses from anon, authenticated;
grant insert (id, flat_id, description, amount, currency, paid_by, split_among, split_type, split, payers,
              category, created_by, spent_on) on public.expenses to authenticated;
grant update (description, amount, currency, paid_by, split_among, split_type, split, payers, category, spent_on)
  on public.expenses to authenticated;

-- A recurring expense's schedule (first date, cadence) is fixed once made — change
-- it by making a new one; its progress belongs to the generator.
revoke all on public.recurring_expenses from anon;
revoke insert, update on public.recurring_expenses from authenticated;
grant select, delete on public.recurring_expenses to authenticated;
grant insert (flat_id, description, amount, currency, paid_by, payers, split_among, split_type, split, category,
              cadence, anchor_on, until_on) on public.recurring_expenses to authenticated;
grant update (description, amount, currency, paid_by, payers, split_among, split_type, split, category, until_on, active)
  on public.recurring_expenses to authenticated;
