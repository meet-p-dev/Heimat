-- Groups, and splitting with people who aren't on Heimat yet.
--
-- Two ideas, kept as small as they can be so nothing downstream has to change:
--
--  1. A `flats` row is now either the flat you live in (`kind = 'flat'`) or a
--     group you split with (`kind = 'group'`). Expenses, settlements, the
--     balance maths, realtime and every RLS policy hang off `flat_id` and do
--     not care which it is.
--
--  2. A member no longer has to be a registered user. Inviting someone writes
--     a member row with a placeholder id, which behaves like any other member
--     id everywhere else — in `expenses.split_among`, in `settlements`, in the
--     balances. Membership is a claimed membership (see the migration that
--     follows this one), so an invite grants no access to anything until it is
--     taken up. Claiming rewrites the placeholder to the real account and the
--     history comes with it.

-- 1 ---------------------------------------------------------------- groups

alter table public.flats add column if not exists kind text not null default 'flat';

do $$ begin
  alter table public.flats add constraint flats_kind_check check (kind in ('flat', 'group'));
exception when duplicate_object then null; end $$;

-- 2 --------------------------------------------------------------- invites

-- The placeholder id is not a real account, so it cannot point at auth.users.
-- Nothing is lost by dropping the key: flat_members has no INSERT policy, so
-- every row still arrives through one of the SECURITY DEFINER functions below.
alter table public.flat_members drop constraint if exists flat_members_user_id_fkey;

alter table public.flat_members
  add column if not exists invite_email text,
  add column if not exists invite_token text,
  add column if not exists invited_by   uuid,
  add column if not exists claimed_at   timestamptz;

create unique index if not exists flat_members_invite_token_key
  on public.flat_members (invite_token) where invite_token is not null;

-- one pending invite per email per flat; once claimed the row is a real member
create unique index if not exists flat_members_pending_email_key
  on public.flat_members (flat_id, lower(invite_email))
  where invite_email is not null and claimed_at is null;

-- 3 -------------------------------------------------------------- creating

create or replace function public.create_group(p_name text, p_display_name text)
returns public.flats
language plpgsql security definer set search_path to 'public'
as $function$
declare v_code text; v_flat flats;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from flats where join_code = v_code);
  end loop;
  insert into flats(name, join_code, kind)
    values (coalesce(nullif(p_name, ''), 'New group'), v_code, 'group')
    returning * into v_flat;
  insert into flat_members(flat_id, user_id, display_name, claimed_at)
    values (v_flat.id, auth.uid(), coalesce(nullif(p_display_name, ''), 'Me'), now());
  return v_flat;
end; $function$;

-- Add someone by email. If they are already on Heimat they join for real and
-- see the group at once; if they are not, they become a pending member and the
-- invite trigger mails them.
create or replace function public.invite_member(p_flat uuid, p_email text, p_name text)
returns public.flat_members
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
    if v_row.id is not null then return v_row; end if;
    insert into flat_members(flat_id, user_id, display_name, invited_by, claimed_at)
      values (p_flat, v_uid, coalesce(nullif(p_name, ''), split_part(v_email, '@', 1)),
              auth.uid(), now())
      returning * into v_row;
    return v_row;
  end if;

  select * into v_row from flat_members
    where flat_id = p_flat and lower(invite_email) = v_email and claimed_at is null;
  if v_row.id is not null then return v_row; end if;

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

-- Remove a pending invite. Only ever a pending one: a member who has claimed
-- their account leaves under their own policy.
create or replace function public.revoke_invite(p_member uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members;
begin
  select * into m from flat_members where id = p_member;
  if m.id is null then return; end if;
  if not is_member(m.flat_id) then raise exception 'Not your group'; end if;
  if m.claimed_at is not null then raise exception 'They have already joined'; end if;
  delete from flat_members where id = p_member;
end; $function$;

-- 4 -------------------------------------------------------------- claiming

-- Point everything that referred to the placeholder at the real account.
create or replace function public.claim_member(p_member uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members; existing_id uuid;
begin
  select * into m from flat_members where id = p_member;
  if m.id is null or m.claimed_at is not null or p_uid is null then return; end if;

  update expenses set paid_by = p_uid
    where flat_id = m.flat_id and paid_by = m.user_id;
  -- distinct, in case they were already splitting with their own account
  update expenses set split_among =
      (select array_agg(distinct x) from unnest(array_replace(split_among, m.user_id, p_uid)) x)
    where flat_id = m.flat_id and m.user_id = any(split_among);
  update settlements set from_user = p_uid where flat_id = m.flat_id and from_user = m.user_id;
  update settlements set to_user   = p_uid where flat_id = m.flat_id and to_user   = m.user_id;
  update flat_items  set added_by  = p_uid where flat_id = m.flat_id and added_by  = m.user_id;
  update flat_items  set bought_by = p_uid where flat_id = m.flat_id and bought_by = m.user_id;

  -- already in this flat under their own account? fold the placeholder in
  select id into existing_id from flat_members
    where flat_id = m.flat_id and user_id = p_uid and id <> m.id limit 1;
  if existing_id is not null then
    delete from flat_members where id = m.id;
  else
    update flat_members set user_id = p_uid, claimed_at = now() where id = m.id;
  end if;
end; $function$;

-- Opening an invite link in the app: claims that one invite whatever address
-- they ended up signing up with, and says which group it was.
create or replace function public.claim_invite(p_token text)
returns public.flats
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members; f flats;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into m from flat_members where invite_token = p_token and claimed_at is null;
  if m.id is null then raise exception 'That invite has already been used'; end if;
  perform claim_member(m.id, auth.uid());
  select * into f from flats where id = m.flat_id;
  return f;
end; $function$;

-- Every pending invite addressed to my email.
create or replace function public.claim_invites()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_email text; r record; n integer := 0;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;
  for r in select id from flat_members
             where claimed_at is null and lower(invite_email) = v_email
  loop
    perform claim_member(r.id, auth.uid());
    n := n + 1;
  end loop;
  return n;
end; $function$;

-- Signing up, or adding an email to an anonymous account, collects whatever
-- was waiting for that address — on any client, without the client asking.
-- The body cannot be allowed to fail: an exception here would take sign-up
-- with it.
create or replace function public.claim_invites_for_new_email()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare r record;
begin
  if new.email is null then return new; end if;
  if tg_op = 'UPDATE' and old.email is not distinct from new.email then return new; end if;
  for r in select id from flat_members
             where claimed_at is null and lower(invite_email) = lower(new.email)
  loop
    perform claim_member(r.id, new.id);
  end loop;
  return new;
exception when others then
  return new;
end; $function$;

drop trigger if exists claim_invites_on_email on auth.users;
create trigger claim_invites_on_email
  after insert or update of email on auth.users
  for each row execute function public.claim_invites_for_new_email();

-- 5 ---------------------------------------------------------- invite email

-- Same shape as push_notify: the URL and shared token live in app_config, so
-- there is nothing to redeploy when they change, and no email goes anywhere
-- until both are set.
create or replace function public.invite_notify(p jsonb)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_url text; v_token text;
begin
  select value into v_url   from app_config where key = 'invite_url';
  select value into v_token from app_config where key = 'push_token';
  if v_url is null or v_token is null then return; end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := p || jsonb_build_object('token', v_token)
  );
end; $function$;

create or replace function public.on_member_invited()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare v_flat text; v_kind text; v_inviter text;
begin
  if new.invite_email is null or new.claimed_at is not null then return new; end if;
  select name, kind into v_flat, v_kind from flats where id = new.flat_id;
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

drop trigger if exists member_invited on public.flat_members;
create trigger member_invited
  after insert on public.flat_members
  for each row execute function public.on_member_invited();
