-- Friends: expenses outside any flat or group — Splitwise's "with you and: …".
--
-- You add an expense with people you pick by name (anyone you already share a
-- flat, group or friend with) or by email. Someone on Heimat is added at once and
-- gets the usual push; someone who isn't gets a placeholder, as group invites do,
-- and an email about the expense. Signing up with that address (or opening the
-- link) brings everything with them.
--
-- How it is stored: every such expense lives in a hidden `flats` row of the new
-- kind 'direct' (a "circle") whose members are exactly the people on it plus
-- whoever added it. So the whole engine — splits, several payers, currencies,
-- stored shares, delete/restore, the feed, pushes, recurring, taking over an
-- invite — applies unchanged, and only the people in an expense can see it. A
-- friend's balance is what the apps add up across every flat, group and circle
-- the two of you share, per currency.
--
-- Circles are made and found only by friend_circle() / save_friend_expense():
-- they can't be joined with a code, invited into, left or removed from. Editing
-- who is in a non-group expense moves it to the circle of its new people.
--
-- Also here, because placeholders get far more use from now on:
--  * one placeholder id per email address, wherever it was invited, so the same
--    person is one friend before they sign up, not one per expense;
--  * taking over an invite needs a confirmed email address, and a link can't be
--    used by someone already in that flat to take over somebody else's place
--    (claim_member folds a placeholder into an existing member — their money with
--    it — and every member can read a pending invite's link, by design).

-- ------------------------------------------------------------------ columns

alter table public.flats drop constraint if exists flats_kind_check;
alter table public.flats add constraint flats_kind_check check (kind in ('flat', 'group', 'direct'));

-- when the email about a friend's expense was handed to the invite function (once per circle)
alter table public.flat_members add column if not exists invite_queued_at timestamptz;

-- looking people up by email, counted so it can't be used to test addresses in bulk
create table if not exists public.person_lookups (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists person_lookups_user_at on public.person_lookups (user_id, at);
alter table public.person_lookups enable row level security;
revoke all on public.person_lookups from anon, authenticated;

create index if not exists flat_members_user_id_idx on public.flat_members (user_id);
create index if not exists flat_members_invite_email_idx on public.flat_members (lower(invite_email))
  where invite_email is not null and claimed_at is null;

-- ------------------------------------------------------------------ helpers

create or replace function public.is_direct(p_flat uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from flats where id = p_flat and kind = 'direct')
$function$;

-- The Heimat account behind an address: confirmed, not deleted, and actually using
-- Heimat (MoneyTrack shares auth.users; someone only on MoneyTrack would never see
-- an expense booked to their account, so they are invited like anyone else).
create or replace function public.heimat_account(p_email text)
returns uuid
language sql stable security definer set search_path to 'public'
as $function$
  select u.id from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.deleted_at is null and u.email_confirmed_at is not null
    and (exists (select 1 from app_users a where a.user_id = u.id and a.app = 'heimat')
         or exists (select 1 from flat_members m where m.user_id = u.id and m.claimed_at is not null))
  order by u.created_at limit 1
$function$;

-- The name someone gave themselves in Heimat
create or replace function public.person_name(p_uid uuid)
returns text
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    (select nullif(btrim(display_name), '') from app_users where user_id = p_uid and app = 'heimat'),
    (select nullif(btrim(display_name), '') from flat_members
      where user_id = p_uid and claimed_at is not null order by joined_at desc, id limit 1))
$function$;

-- One placeholder id per address: the one it already has wherever it is still waiting, or a new one.
create or replace function public.placeholder_for(p_email text)
returns uuid
language sql volatile security definer set search_path to 'public'
as $function$
  select coalesce(
    (select user_id from flat_members
      where lower(invite_email) = lower(btrim(p_email)) and claimed_at is null and left_at is null
      order by joined_at, id limit 1),
    gen_random_uuid())
$function$;

-- ------------------------------------------------------------- looking up

-- Whether an address is on Heimat, and the name they go by (shown, as Splitwise does).
-- 60 look-ups an hour per account.
create or replace function public.find_person(p_email text)
returns table (on_heimat boolean, name text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_uid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid email address';
  end if;
  if (select count(*) from person_lookups where user_id = auth.uid() and at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many look-ups — try again in a little while';
  end if;
  delete from person_lookups where user_id = auth.uid() and at < now() - interval '1 hour';
  insert into person_lookups (user_id) values (auth.uid());
  v_uid := heimat_account(v_email);
  if v_uid is null then
    return query select false, null::text;
  else
    return query select true, person_name(v_uid);
  end if;
end; $function$;

-- ---------------------------------------------------------------- circles

-- The circle for you and these people: found if you already have one with exactly
-- them, made if not. p_people is a list of {"user_id": …} (anyone you already share
-- a flat, group or friend with — an account or an invite still waiting) and
-- {"email": …, "name": …}. Returns the circle's id.
create or replace function public.friend_circle_id(p_people jsonb)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  p jsonb; m flat_members;
  v_uid uuid; v_email text; v_name text; v_pending boolean;
  ids uuid[] := '{}'; ppl jsonb := '[]'::jsonb; v_all uuid[];
  v_flat uuid; v_code text; v_new integer; v_names text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(p_people) is distinct from 'array' or jsonb_array_length(p_people) = 0 then
    raise exception using errcode = 'P0001', message = 'friends: choose who it is with', detail = '{"code": "empty"}';
  end if;
  if jsonb_array_length(p_people) > 49 then
    raise exception using errcode = 'P0001', message = 'friends: too many people', detail = '{"code": "too_many"}';
  end if;
  -- one at a time per person: two quick taps find or make one circle, not two
  perform pg_advisory_xact_lock(hashtext('friend_circle:' || me::text));

  for p in select value from jsonb_array_elements(p_people) loop
    if jsonb_typeof(p) <> 'object' then
      raise exception using errcode = 'P0001', message = 'friends: choose who it is with', detail = '{"code": "bad_value"}';
    end if;
    v_uid := null; v_email := null; v_pending := false;
    v_name := left(nullif(btrim(coalesce(p ->> 'name', '')), ''), 60);
    if nullif(btrim(coalesce(p ->> 'user_id', '')), '') is not null then
      begin
        v_uid := btrim(p ->> 'user_id')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = 'P0001', message = 'friends: choose who it is with', detail = '{"code": "bad_value"}';
      end;
      if v_uid = me then continue; end if;
      -- someone you share a flat, group or friend with (now or before): as an account,
      -- or as an invite that is still waiting — a dead invite is nobody
      select m2.* into m
        from flat_members m1 join flat_members m2 on m2.flat_id = m1.flat_id
        where m1.user_id = me and m1.claimed_at is not null and m2.user_id = v_uid
          and (m2.claimed_at is not null or (m2.left_at is null and m2.invite_email is not null))
        order by (m2.claimed_at is not null) desc, m2.joined_at desc, m2.id
        limit 1;
      if m.id is null then
        raise exception using errcode = 'P0001', message = 'friends: not someone you know here',
          detail = jsonb_build_object('code', 'not_a_friend', 'who', v_uid)::text;
      end if;
      if m.claimed_at is null then
        v_pending := true; v_email := lower(m.invite_email); v_name := coalesce(v_name, m.display_name);
      end if;
    elsif nullif(btrim(coalesce(p ->> 'email', '')), '') is not null then
      v_email := lower(btrim(p ->> 'email'));
      if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then
        raise exception using errcode = 'P0001', message = 'Enter a valid email address', detail = '{"code": "bad_email"}';
      end if;
      v_uid := heimat_account(v_email);
      if v_uid = me then continue; end if;
      if v_uid is null then
        v_uid := placeholder_for(v_email); v_pending := true;
      else
        v_email := null;
      end if;
    else
      raise exception using errcode = 'P0001', message = 'friends: choose who it is with', detail = '{"code": "bad_value"}';
    end if;
    if v_uid = any(ids) then continue; end if;
    ids := ids || v_uid;
    ppl := ppl || jsonb_build_array(jsonb_build_object(
      'uid', v_uid, 'email', case when v_pending then v_email end,
      'name', case when v_pending then coalesce(v_name, split_part(v_email, '@', 1))
                   else coalesce(person_name(v_uid), v_name, 'Someone') end));
  end loop;
  if cardinality(ids) = 0 then
    raise exception using errcode = 'P0001', message = 'friends: choose who it is with', detail = '{"code": "empty"}';
  end if;

  -- yours already: the oldest circle with exactly these people, nobody in it gone
  v_all := array(select u from unnest(ids || me) u order by u);
  select f.id into v_flat
    from flats f
    join flat_members mine on mine.flat_id = f.id and mine.user_id = me
                          and mine.claimed_at is not null and mine.left_at is null
    where f.kind = 'direct'
      and not exists (select 1 from flat_members x where x.flat_id = f.id and x.left_at is not null)
      and array(select x.user_id from flat_members x where x.flat_id = f.id order by x.user_id) = v_all
    order by f.created_at, f.id
    limit 1;
  if v_flat is not null then return v_flat; end if;

  -- a new one. Bounded, so Heimat can't be used to mail strangers in bulk.
  v_new := (select count(*) from jsonb_array_elements(ppl) x where x ->> 'email' is not null);
  if v_new > 0 and v_new + (select count(*) from flat_members fm join flats f on f.id = fm.flat_id
                            where f.kind = 'direct' and fm.invited_by = me and fm.invite_email is not null
                              and fm.joined_at > now() - interval '1 day') > 30 then
    raise exception using errcode = 'P0001', message = 'friends: you''ve added a lot of new people today — try again tomorrow',
      detail = '{"code": "rate_limited"}';
  end if;
  if (select count(*) from flats where kind = 'direct' and created_by = me and created_at > now() - interval '1 day') >= 100 then
    raise exception using errcode = 'P0001', message = 'friends: too many new friends today — try again tomorrow',
      detail = '{"code": "rate_limited"}';
  end if;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
    exit when not exists (select 1 from flats where join_code = v_code);
  end loop;
  -- the name is only for apps from before friends, which show a circle as a small group
  v_names := left(coalesce(person_name(me), 'Me') || ' & '
                  || (select string_agg(x ->> 'name', ', ' order by o) from jsonb_array_elements(ppl) with ordinality t(x, o)), 80);
  insert into flats (name, join_code, kind, created_by) values (v_names, v_code, 'direct', me) returning id into v_flat;
  insert into flat_members (flat_id, user_id, display_name, claimed_at)
    values (v_flat, me, coalesce(person_name(me), 'Me'), now());
  for p in select value from jsonb_array_elements(ppl) loop
    if p ->> 'email' is null then
      insert into flat_members (flat_id, user_id, display_name, invited_by, claimed_at)
        values (v_flat, (p ->> 'uid')::uuid, p ->> 'name', me, now());
    else
      insert into flat_members (flat_id, user_id, display_name, invite_email, invite_token, invited_by)
        values (v_flat, (p ->> 'uid')::uuid, p ->> 'name', p ->> 'email', replace(gen_random_uuid()::text, '-', ''), me);
    end if;
  end loop;
  return v_flat;
end; $function$;

-- For the apps (settling up with a friend, say): the circle itself.
create or replace function public.friend_circle(p_people jsonb)
returns public.flats
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid; f flats;
begin
  -- into a variable first: in a WHERE clause a volatile function runs once per row
  v_id := friend_circle_id(p_people);
  select * into f from flats where id = v_id;
  return f;
end; $function$;

-- Add or edit an expense outside any flat or group, in one go: the circle for you and
-- p_people is found or made, and the expense is written into it — moved there, when an
-- edit changes who is in it. p_expense carries the columns an app writes (description,
-- amount, currency, paid_by, split_among, split_type, split, payers, category, spent_on);
-- p_id is the id the app made, so the split it previewed is the split saved. Everyone
-- on the expense must be in the circle, and everyone in the circle but you on the expense.
create or replace function public.save_friend_expense(p_id uuid, p_people jsonb, p_expense jsonb)
returns public.expenses
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := auth.uid(); x jsonb := p_expense; v_flat uuid; old expenses; e expenses;
  v_among uuid[]; stray text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_id is null or jsonb_typeof(x) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'split: bad_value', detail = '{"code": "bad_value"}';
  end if;
  begin
    v_among := case when jsonb_typeof(x -> 'split_among') = 'array'
                    then array(select btrim(value)::uuid from jsonb_array_elements_text(x -> 'split_among') where btrim(value) <> '')
                    else '{}' end;
  exception when invalid_text_representation then
    perform split_error('bad_value', null, 'split_among');
  end;
  v_flat := friend_circle_id(p_people);

  select * into old from expenses where id = p_id for update;
  if found then
    if old.deleted_at is not null or not is_member(old.flat_id) then raise exception 'No such expense'; end if;
    if not is_direct(old.flat_id) then
      raise exception using errcode = 'P0001', message = 'friends: this expense belongs to a group — edit it there',
        detail = '{"code": "not_direct"}';
    end if;
    update expenses set
        flat_id = v_flat,
        description = coalesce(x ->> 'description', ''),
        amount = (x ->> 'amount')::numeric,
        currency = x ->> 'currency',
        paid_by = (x ->> 'paid_by')::uuid,
        split_among = v_among,
        split_type = coalesce(nullif(x ->> 'split_type', ''), 'equal'),
        split = nullif(x -> 'split', 'null'::jsonb),
        payers = nullif(x -> 'payers', 'null'::jsonb),
        category = coalesce(nullif(x ->> 'category', ''), 'other'),
        spent_on = coalesce((x ->> 'spent_on')::date, old.spent_on)
      where id = p_id
      returning * into e;
  else
    insert into expenses (id, flat_id, description, amount, currency, paid_by, split_among, split_type, split, payers,
                          category, created_by, spent_on)
      values (p_id, v_flat, coalesce(x ->> 'description', ''), (x ->> 'amount')::numeric, x ->> 'currency',
              (x ->> 'paid_by')::uuid, v_among, coalesce(nullif(x ->> 'split_type', ''), 'equal'),
              nullif(x -> 'split', 'null'::jsonb), nullif(x -> 'payers', 'null'::jsonb),
              coalesce(nullif(x ->> 'category', ''), 'other'), me, coalesce((x ->> 'spent_on')::date, current_date))
      returning * into e;
  end if;

  -- everyone with money on it is in the circle (expense_postings lets people already on an
  -- expense stay on it after they've gone — right inside a flat, not when it moves)
  select z.u into stray
    from (select key as u from jsonb_each(case when jsonb_typeof(e.shares) = 'object' then e.shares else '{}' end)
            where value::text::numeric <> 0
          union select key from jsonb_each(case when jsonb_typeof(e.payers) = 'object' then e.payers else '{}' end)
            where value::text::numeric <> 0
          union select e.paid_by::text
          union select u::text from unnest(e.split_among) u) z
    where not exists (select 1 from flat_members m
                      where m.flat_id = v_flat and m.user_id::text = z.u and m.left_at is null)
    limit 1;
  if stray is not null then perform split_error('not_in_flat', null, stray); end if;
  -- and nobody but you sees an expense that isn't about them
  select m.user_id::text into stray
    from flat_members m
    where m.flat_id = v_flat and m.user_id <> me
      and m.user_id <> e.paid_by and not (m.user_id = any(e.split_among))
      and not (case when jsonb_typeof(e.shares) = 'object' then e.shares else '{}' end) ? m.user_id::text
      and not (case when jsonb_typeof(e.payers) = 'object' then e.payers else '{}' end) ? m.user_id::text
    limit 1;
  if stray is not null then
    raise exception using errcode = 'P0001', message = 'friends: someone you picked isn''t on the expense',
      detail = jsonb_build_object('code', 'not_in_expense', 'who', stray)::text;
  end if;
  return e;
end; $function$;

-- ------------------------------------------------------- telling them

-- Someone not on Heimat yet hears about the first expense they're in, in each circle,
-- by email — with what it was and their part of it. (Someone on Heimat gets the
-- usual push from on_expense_insert.) Once per circle: invite_queued_at.
create or replace function public.on_friend_expense()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members; v_inviter text; v_circle text;
begin
  if new.deleted_at is not null or not is_direct(new.flat_id) then return new; end if;
  if tg_op = 'UPDATE' and new.flat_id = old.flat_id then return new; end if;
  select name into v_circle from flats where id = new.flat_id;
  select coalesce(nullif(display_name, ''), person_name(user_id)) into v_inviter
    from flat_members where flat_id = new.flat_id and user_id = coalesce(auth.uid(), new.created_by);
  for m in select * from flat_members
             where flat_id = new.flat_id and claimed_at is null and left_at is null
               and invite_email is not null and invite_token is not null and invite_queued_at is null
               and (user_id = new.paid_by or user_id = any(new.split_among)
                    or coalesce(new.shares, '{}') ? user_id::text or coalesce(new.payers, '{}') ? user_id::text)
             order by id
  loop
    update flat_members set invite_queued_at = now() where id = m.id;
    perform invite_notify(jsonb_build_object(
      'event',       'invited',
      'kind',        'direct',
      'email',       m.invite_email,
      'name',        m.display_name,
      'invite',      m.invite_token,
      'flat',        v_circle,
      'inviter',     coalesce(v_inviter, 'Someone'),
      'description', coalesce(nullif(new.description, ''), 'An expense'),
      'amount',      new.amount,
      'currency',    new.currency,
      -- minor units: their share, and what they paid
      'share',       coalesce(jint(new.shares -> m.user_id::text), 0),
      'paid',        case when new.payers is not null then coalesce(jint(new.payers -> m.user_id::text), 0)
                          when new.paid_by = m.user_id then to_minor(new.amount, new.currency) else 0 end
    ));
  end loop;
  return new;
end; $function$;

drop trigger if exists friend_expense_invites on public.expenses;
create trigger friend_expense_invites after insert or update of flat_id on public.expenses
  for each row execute function public.on_friend_expense();

-- a circle's invitees are told by the expense, not by being added
create or replace function public.on_member_invited()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare v_flat text; v_kind text; v_inviter text;
begin
  if new.invite_email is null or new.claimed_at is not null then return new; end if;
  select name, kind into v_flat, v_kind from flats where id = new.flat_id;
  if v_kind = 'direct' then return new; end if;
  select coalesce(nullif(display_name, ''), 'A flatmate') into v_inviter
    from flat_members where flat_id = new.flat_id and user_id = new.invited_by;
  perform invite_notify(jsonb_build_object(
    'event',   'invited',
    'email',   new.invite_email,
    'name',    new.display_name,
    'invite',  new.invite_token,
    'flat',    v_flat,
    'kind',    coalesce(v_kind, 'group'),
    'inviter', coalesce(v_inviter, 'Someone')
  ));
  return new;
end; $function$;

-- ------------------------------------------- circles are not flats or groups

create or replace function public.join_flat(p_code text, p_display_name text)
returns flats
language plpgsql security definer set search_path to 'public'
as $function$
declare v_flat flats;
begin
  select * into v_flat from flats where join_code = upper(p_code);
  if v_flat.id is null or v_flat.kind = 'direct' then raise exception 'Invalid flat code'; end if;
  insert into flat_members(flat_id, user_id, display_name, claimed_at)
    values (v_flat.id, auth.uid(), coalesce(nullif(p_display_name,''),'Me'), now())
    on conflict (flat_id, user_id)
    do update set claimed_at = coalesce(flat_members.claimed_at, now()), left_at = null;
  return v_flat;
end; $function$;

create or replace function public.leave_flat(p_flat uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if is_direct(p_flat) then
    raise exception 'You can''t leave a friend — settle up, or delete an expense you don''t recognise';
  end if;
  delete from flat_members where flat_id = p_flat and user_id = auth.uid();
end; $function$;

-- (the web app leaves by deleting its own row)
drop policy if exists members_leave on public.flat_members;
create policy members_leave on public.flat_members for delete
  using (user_id = auth.uid() and not is_direct(flat_id));

create or replace function public.remove_member(p_flat uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare c text; v_bal numeric;
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  if is_direct(p_flat) then raise exception 'Friends can''t be removed'; end if;
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

-- Groups: the same idea of "on Heimat" as friends, and the same placeholder per address.
create or replace function public.invite_member(p_flat uuid, p_email text, p_name text)
returns flat_members
language plpgsql security definer set search_path to 'public'
as $function$
declare v_email text; v_uid uuid; v_row flat_members;
begin
  if not is_member(p_flat) then raise exception 'Not your group'; end if;
  if is_direct(p_flat) then raise exception 'Add them to the expense instead'; end if;
  v_email := lower(trim(p_email));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;

  v_uid := heimat_account(v_email);

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
            placeholder_for(v_email),
            coalesce(nullif(p_name, ''), split_part(v_email, '@', 1)),
            v_email,
            replace(gen_random_uuid()::text, '-', ''),
            auth.uid())
    returning * into v_row;
  return v_row;
end; $function$;

-- -------------------------------------------------- taking over an invite

-- Opening a link: takes over that invite. Someone already in that flat or group may
-- only do it with the invited (confirmed) address — otherwise any member could fold a
-- waiting person's money into their own. With the invited address, every other place
-- that person is waiting (the same placeholder) comes too.
create or replace function public.claim_invite(p_token text)
returns flats
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members; f flats; v_email text; r record;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into m from flat_members where invite_token = p_token and claimed_at is null and left_at is null;
  if m.id is null then raise exception 'That invite has already been used'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if exists (select 1 from flat_members where flat_id = m.flat_id and user_id = auth.uid())
     and v_email is distinct from lower(m.invite_email) then
    raise exception 'You''re already in here — this invite is for someone else';
  end if;
  perform claim_member(m.id, auth.uid());
  if v_email = lower(m.invite_email) then
    for r in select id from flat_members where user_id = m.user_id and claimed_at is null and left_at is null loop
      begin
        perform claim_member(r.id, auth.uid());
      exception when others then
        raise warning 'claim_invite: member % not taken over: %', r.id, sqlerrm;
      end;
    end loop;
  end if;
  select * into f from flats where id = m.flat_id;
  return f;
end; $function$;

-- Everything waiting for my address — once it is confirmed.
create or replace function public.claim_invites()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_email text; r record; n integer := 0;
begin
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
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

-- Signing up, or adding an address to an anonymous account, collects whatever was
-- waiting for it — when the address is confirmed, not merely typed in.
create or replace function public.claim_invites_for_new_email()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare r record;
begin
  if new.email is null or new.email_confirmed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.email is not distinct from new.email and old.email_confirmed_at is not null then
    return new;
  end if;
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

drop trigger if exists claim_invites_on_email on auth.users;
create trigger claim_invites_on_email
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.claim_invites_for_new_email();

-- ---------------------------------------------------------------- grants

revoke all on function public.heimat_account(text)                  from public, anon, authenticated;
revoke all on function public.person_name(uuid)                     from public, anon, authenticated;
revoke all on function public.placeholder_for(text)                 from public, anon, authenticated;
revoke all on function public.friend_circle_id(jsonb)               from public, anon, authenticated;
revoke all on function public.on_friend_expense()                   from public, anon, authenticated;
revoke all on function public.on_member_invited()                   from public, anon, authenticated;
revoke all on function public.claim_invites_for_new_email()         from public, anon, authenticated;
revoke all on function public.find_person(text)                     from public, anon;
revoke all on function public.friend_circle(jsonb)                  from public, anon;
revoke all on function public.save_friend_expense(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.leave_flat(uuid)                      from public, anon;
revoke all on function public.remove_member(uuid, uuid)             from public, anon;
revoke all on function public.invite_member(uuid, text, text)       from public, anon;
revoke all on function public.join_flat(text, text)                 from public, anon;
revoke all on function public.claim_invite(text)                    from public, anon;
revoke all on function public.claim_invites()                       from public, anon;
grant execute on function public.find_person(text)                     to authenticated;
grant execute on function public.friend_circle(jsonb)                  to authenticated;
grant execute on function public.save_friend_expense(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.leave_flat(uuid)                      to authenticated;
grant execute on function public.remove_member(uuid, uuid)             to authenticated;
grant execute on function public.invite_member(uuid, text, text)       to authenticated;
grant execute on function public.join_flat(text, text)                 to authenticated;
grant execute on function public.claim_invite(text)                    to authenticated;
grant execute on function public.claim_invites()                       to authenticated;
-- is_direct is read by an RLS policy, which runs as the calling role
grant execute on function public.is_direct(uuid) to authenticated, anon;
