-- Bringing a group over from Splitwise: every expense and payment, with its date, in one go.
--
-- The app reads Splitwise's export (one CSV per group) on the phone and turns each row into
-- who paid what and who owes what, in minor units (src/lib/importSplitwise.ts, held to the same
-- answers as ios-native/Heimat/SplitwiseImport.swift by tests/splitwise-import-vectors.json).
-- import_group then makes a new group and writes it all inside one transaction:
--
--  * you are the person you picked; everyone else is waiting to join by link (no email —
--    Splitwise's export has none), so each of them takes over their name, and the whole
--    history, with their personal invite link (claim_invite already handles link-only people);
--  * every expense is an exact split, so each share is exactly what Splitwise had; several
--    payers stay several payers; Splitwise's "Payment" rows become payments;
--  * before anything is kept, everyone's balance in every currency must be exactly what the
--    app worked out from the file — otherwise nothing is saved;
--  * no push for each of hundreds of old expenses and no flood in the feed: while it runs,
--    log() and push_notify() stay quiet, and the feed gets one line, "imported from Splitwise";
--  * the same file twice makes nothing new (imports remembers it while its group exists);
--  * remove_import takes it all back — the group and everything in it — while nobody else has
--    joined the group yet.

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- null once the group is gone (removed, or emptied)
  flat_id uuid references public.flats(id) on delete set null,
  source text not null check (source in ('splitwise')),
  file_hash text not null check (length(file_hash) between 16 and 128),
  expenses integer not null,
  payments integer not null,
  created_at timestamptz not null default now()
);
create unique index if not exists imports_once on public.imports (user_id, file_hash) where flat_id is not null;
alter table public.imports enable row level security;
drop policy if exists imports_own on public.imports;
create policy imports_own on public.imports for select to authenticated using (user_id = auth.uid());
revoke all on public.imports from anon, authenticated;
grant select on public.imports to authenticated;

-- quiet while an import (or its removal) runs: these are the same functions as before, plus
-- the one check at the top
create or replace function public.log(p_flat uuid, p_actor uuid, p_kind text, p_subject text, p_amount numeric, p_meta jsonb)
returns void language sql security definer set search_path to 'public'
as $function$
  insert into activity(flat_id, actor, kind, subject, amount, meta)
  select p_flat, p_actor, p_kind, nullif(p_subject, ''), p_amount, coalesce(p_meta, '{}'::jsonb)
  where coalesce(current_setting('heimat.import', true), '') <> 'on';
$function$;

create or replace function public.push_notify(p jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_url text;
  v_token text;
begin
  if coalesce(current_setting('heimat.import', true), '') = 'on' then return; end if;
  select value into v_url   from app_config where key = 'push_url';
  select value into v_token from app_config where key = 'push_token';
  if v_url is null or v_token is null then return; end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := p || jsonb_build_object('token', v_token),
    timeout_milliseconds := 15000
  );
end;
$function$;

-- removing an import deletes its group outright; people with history are otherwise kept as "left"
create or replace function public.on_member_delete()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
if coalesce(current_setting('heimat.import', true), '') = 'on' then return old; end if;
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

create or replace function public.import_error(p_code text, p_detail jsonb default '{}')
returns void language plpgsql
as $function$
begin
  raise exception using errcode = 'P0001', message = 'import: ' || p_code,
    detail = (jsonb_build_object('code', p_code) || coalesce(p_detail, '{}'))::text;
end; $function$;

-- p: { source: 'splitwise', hash, name, kind: 'group' | 'flat', me: key,
--      people:   [{ key, name }],
--      expenses: [{ d: 'YYYY-MM-DD', t: description, c: category, cur, total: minor,
--                   paid: { key: minor }, owed: { key: minor } }],
--      payments: [{ d, from: key, to: key, cur, total: minor }],
--      balances: { 'key|CUR': minor } }       -- what everyone should end up at
-- returns { flat: <the new group>, import: <id> }
create or replace function public.import_group(p jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  v_hash text := p ->> 'hash';
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'group');
  v_me text := p ->> 'me';
  v_flat flats; v_imp uuid;
  ids jsonb := '{}'; pp jsonb; e jsonb; v_uid uuid; v_name text;
  v_cur text; v_total bigint; v_day date; v_cat text; v_owed jsonb; v_paid jsonb; v_payer uuid; v_n integer;
  v_from uuid; v_to uuid; v_prev uuid;
  n_exp integer := 0; n_pay integer := 0; v_got jsonb; v_bad text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p ->> 'source' is distinct from 'splitwise' then perform import_error('bad_file'); end if;
  if v_hash is null or length(v_hash) not between 16 and 128 then perform import_error('bad_file'); end if;
  if v_kind not in ('group', 'flat') then perform import_error('bad_file'); end if;
  if jsonb_typeof(p -> 'people') is distinct from 'array' or jsonb_array_length(p -> 'people') not between 2 and 49
     or jsonb_typeof(p -> 'expenses') is distinct from 'array' or jsonb_typeof(p -> 'payments') is distinct from 'array'
     or jsonb_typeof(p -> 'balances') is distinct from 'object' then
    perform import_error('bad_file');
  end if;
  if jsonb_array_length(p -> 'expenses') + jsonb_array_length(p -> 'payments') = 0 then perform import_error('empty'); end if;
  if jsonb_array_length(p -> 'expenses') + jsonb_array_length(p -> 'payments') > 5000 then perform import_error('too_large'); end if;
  if not exists (select 1 from jsonb_array_elements(p -> 'people') x where x ->> 'key' = v_me) then
    perform import_error('pick_yourself');
  end if;
  -- one at a time per person, so a double tap can't import twice
  perform pg_advisory_xact_lock(hashtext('import:' || me::text));
  select flat_id into v_prev from imports where user_id = me and file_hash = v_hash and flat_id is not null;
  if v_prev is not null then perform import_error('already', jsonb_build_object('flat', v_prev)); end if;
  if (select count(*) from imports where user_id = me and created_at > now() - interval '1 day') >= 20 then
    perform import_error('too_many');
  end if;

  perform set_config('heimat.import', 'on', true);

  select coalesce(nullif(left(btrim(x ->> 'name'), 60), ''), 'Me') into v_name
    from jsonb_array_elements(p -> 'people') x where x ->> 'key' = v_me limit 1;
  if v_kind = 'flat' then
    v_flat := create_flat(left(coalesce(nullif(btrim(p ->> 'name'), ''), 'From Splitwise'), 60), v_name);
  else
    v_flat := create_group(left(coalesce(nullif(btrim(p ->> 'name'), ''), 'From Splitwise'), 60), v_name);
  end if;
  ids := jsonb_build_object(v_me, me);

  -- everyone else: waiting to join by their own link
  for pp in select value from jsonb_array_elements(p -> 'people') loop
    continue when pp ->> 'key' = v_me;
    if coalesce(pp ->> 'key', '') = '' or ids ? (pp ->> 'key') then perform import_error('bad_file'); end if;
    insert into flat_members (flat_id, user_id, display_name, invite_token, invited_by)
      values (v_flat.id, gen_random_uuid(), coalesce(nullif(left(btrim(pp ->> 'name'), 60), ''), 'Someone'),
              replace(gen_random_uuid()::text, '-', ''), me)
      returning user_id into v_uid;
    ids := ids || jsonb_build_object(pp ->> 'key', v_uid);
  end loop;

  for e in select value from jsonb_array_elements(p -> 'expenses') loop
    v_cur := upper(btrim(coalesce(e ->> 'cur', '')));
    v_total := jint(e -> 'total');
    begin
      v_day := (e ->> 'd')::date;
    exception when others then
      v_day := null;
    end;
    if v_cur !~ '^[A-Z]{3}$' or v_total is null or v_total <= 0 or v_total > 100000000000
       or v_day is null or v_day < date '2000-01-01' or v_day > current_date + 1
       or jsonb_typeof(e -> 'paid') is distinct from 'object' or jsonb_typeof(e -> 'owed') is distinct from 'object'
       or exists (select 1 from jsonb_each(e -> 'paid') x where not ids ? x.key or jint(x.value) is null or jint(x.value) < 0)
       or exists (select 1 from jsonb_each(e -> 'owed') x where not ids ? x.key or jint(x.value) is null or jint(x.value) < 0) then
      perform import_error('bad_row', jsonb_build_object('row', n_exp + 1));
    end if;
    select jsonb_object_agg(ids ->> x.key, jint(x.value)) into v_paid from jsonb_each(e -> 'paid') x where jint(x.value) > 0;
    select jsonb_object_agg(ids ->> x.key, jint(x.value)) into v_owed from jsonb_each(e -> 'owed') x where jint(x.value) > 0;
    if v_paid is null or v_owed is null then perform import_error('bad_row', jsonb_build_object('row', n_exp + 1)); end if;
    -- whoever paid most is "paid by" for apps that show one payer
    select (x.key)::uuid, count(*) over () into v_payer, v_n from jsonb_each(v_paid) x
      order by jint(x.value) desc, x.key limit 1;
    v_cat := coalesce(nullif(e ->> 'c', ''), 'other');
    if v_cat not in ('rent', 'groceries', 'utilities', 'internet', 'eatout', 'transport', 'household', 'other') then v_cat := 'other'; end if;
    insert into expenses (flat_id, description, amount, currency, paid_by, split_among, category, spent_on,
                          split_type, split, payers)
      values (v_flat.id, left(btrim(coalesce(e ->> 't', '')), 200), v_total / power(10::numeric, minor_digits(v_cur)), v_cur,
              v_payer, array(select (k)::uuid from jsonb_object_keys(v_owed) k), v_cat, v_day,
              'exact', jsonb_build_object('values', v_owed), case when v_n > 1 then v_paid end);
    n_exp := n_exp + 1;
  end loop;

  for e in select value from jsonb_array_elements(p -> 'payments') loop
    v_cur := upper(btrim(coalesce(e ->> 'cur', '')));
    v_total := jint(e -> 'total');
    begin
      v_day := (e ->> 'd')::date;
    exception when others then
      v_day := null;
    end;
    v_from := (ids ->> (e ->> 'from'))::uuid;
    v_to := (ids ->> (e ->> 'to'))::uuid;
    if v_cur !~ '^[A-Z]{3}$' or v_total is null or v_total <= 0 or v_total > 100000000000
       or v_day is null or v_day < date '2000-01-01' or v_day > current_date + 1
       or v_from is null or v_to is null or v_from = v_to then
      perform import_error('bad_row', jsonb_build_object('payment', n_pay + 1));
    end if;
    insert into settlements (flat_id, from_user, to_user, amount, settled_on, currency)
      values (v_flat.id, v_from, v_to, v_total / power(10::numeric, minor_digits(v_cur)), v_day, v_cur);
    n_pay := n_pay + 1;
  end loop;

  -- every balance exactly as the app worked it out from the file, or nothing is kept
  select jsonb_object_agg(k, v) into v_got from (
    select key as k, jint(value) as v from jsonb_each(money_snapshot(v_flat.id)) where jint(value) <> 0) s;
  select coalesce(a.k, b.k) into v_bad
    from (select key as k, jint(value) as v from jsonb_each(coalesce(v_got, '{}'))) a
    full join (select (ids ->> split_part(key, '|', 1)) || '|' || upper(split_part(key, '|', 2)) as k, jint(value) as v
               from jsonb_each(p -> 'balances') where jint(value) <> 0) b on a.k = b.k
    where a.v is distinct from b.v
    limit 1;
  if v_bad is not null then perform import_error('balances_differ'); end if;

  insert into imports (user_id, flat_id, source, file_hash, expenses, payments)
    values (me, v_flat.id, 'splitwise', v_hash, n_exp, n_pay) returning id into v_imp;

  perform set_config('heimat.import', '', true);
  perform log(v_flat.id, me, 'imported', 'Splitwise', null,
              jsonb_build_object('expenses', n_exp, 'payments', n_pay, 'import', v_imp));
  return jsonb_build_object('flat', to_jsonb(v_flat), 'import', v_imp);
end; $function$;

-- take an import back: its group and everything in it, while nobody else has joined
create or replace function public.remove_import(p_import uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare me uuid := auth.uid(); v_flat uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select flat_id into v_flat from imports where id = p_import and user_id = me;
  if v_flat is null then perform import_error('gone'); end if;
  if exists (select 1 from flat_members where flat_id = v_flat and claimed_at is not null and user_id <> me) then
    perform import_error('someone_joined');
  end if;
  perform set_config('heimat.import', 'on', true);
  delete from nudges where flat_id = v_flat;
  delete from settlements where flat_id = v_flat;
  delete from expenses where flat_id = v_flat;
  delete from flats where id = v_flat;
  perform set_config('heimat.import', '', true);
end; $function$;

revoke execute on function public.import_error(text, jsonb) from public, anon, authenticated;
revoke execute on function public.import_group(jsonb) from public, anon;
revoke execute on function public.remove_import(uuid) from public, anon;
grant execute on function public.import_group(jsonb) to authenticated;
grant execute on function public.remove_import(uuid) to authenticated;
