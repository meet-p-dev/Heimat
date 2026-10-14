-- Importing from more apps than Splitwise: Tricount, Settle Up, Splid, or any spreadsheet.
--
-- The apps now read all of them (src/lib/importExpenses.ts, ios-native/Heimat/ExpenseImport.swift)
-- and send import_group the same rows as before, saying which app the file came from. import_group
-- is unchanged but for that: it accepts the five sources, remembers which one in imports.source,
-- and the feed line names it ("brought 42 expenses over from Tricount"). A file is still refused
-- unless every balance in every currency comes out exactly as the app worked it out.

alter table public.imports drop constraint if exists imports_source_check;
alter table public.imports add constraint imports_source_check
  check (source in ('splitwise', 'tricount', 'settleup', 'splid', 'other'));

create or replace function public.import_group(p jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  v_hash text := p ->> 'hash';
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'group');
  v_me text := p ->> 'me';
  v_source text := coalesce(nullif(p ->> 'source', ''), 'splitwise');
  v_flat flats; v_imp uuid;
  ids jsonb := '{}'; pp jsonb; e jsonb; v_uid uuid; v_name text;
  v_cur text; v_total bigint; v_day date; v_cat text; v_owed jsonb; v_paid jsonb; v_payer uuid; v_n integer;
  v_from uuid; v_to uuid; v_prev uuid;
  n_exp integer := 0; n_pay integer := 0; v_got jsonb; v_bad text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if v_source not in ('splitwise', 'tricount', 'settleup', 'splid', 'other') then perform import_error('bad_file'); end if;
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
    v_flat := create_flat(left(coalesce(nullif(btrim(p ->> 'name'), ''), 'Imported group'), 60), v_name);
  else
    v_flat := create_group(left(coalesce(nullif(btrim(p ->> 'name'), ''), 'Imported group'), 60), v_name);
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
    values (me, v_flat.id, v_source, v_hash, n_exp, n_pay) returning id into v_imp;

  perform set_config('heimat.import', '', true);
  perform log(v_flat.id, me, 'imported',
              case v_source when 'splitwise' then 'Splitwise' when 'tricount' then 'Tricount' when 'settleup' then 'Settle Up'
                            when 'splid' then 'Splid' else 'a spreadsheet' end, null,
              jsonb_build_object('expenses', n_exp, 'payments', n_pay, 'import', v_imp));
  return jsonb_build_object('flat', to_jsonb(v_flat), 'import', v_imp);
end; $function$;

revoke execute on function public.import_group(jsonb) from public, anon;
grant execute on function public.import_group(jsonb) to authenticated;
