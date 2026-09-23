-- What the invite link needs before anyone has signed in, and what happens
-- when an invite is turned down.
--
-- Also a correction. `revoke_invite` deleted the member row and stopped there,
-- which left the placeholder id sitting inside `expenses.split_among`. The
-- balance maths only counts ids it can find a member for, but still divides by
-- the length of the split — so the payer was credited the whole amount while
-- only the remaining people were debited their share, and the flat stopped
-- adding up. Removing someone now removes them from the splits too, which is
-- what the app already promises on screen.

-- Read by a stranger holding the token, before they have any session at all —
-- so it is deliberately narrow: the name of the thing, who asked, and the
-- address it went to, which the page needs to pre-fill sign-up. The token was
-- emailed to that address, so it is not telling the holder anything new.
create or replace function public.invite_preview(p_token text)
returns table (flat_name text, flat_kind text, inviter text, invited_email text, invited_name text, open boolean)
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members;
begin
  select * into m from flat_members where invite_token = p_token;
  if m.id is null then
    return query select null::text, null::text, null::text, null::text, null::text, false;
    return;
  end if;
  return query
    select f.name, f.kind,
           coalesce((select nullif(im.display_name, '') from flat_members im
                      where im.flat_id = m.flat_id and im.user_id = m.invited_by), 'Someone'),
           m.invite_email, m.display_name,
           m.claimed_at is null
    from flats f where f.id = m.flat_id;
end; $function$;

grant execute on function public.invite_preview(text) to anon, authenticated;

-- Take someone out of a flat's history. Refuses when they are down as having
-- paid for something: reassigning that would quietly reverse who owes whom,
-- and deleting it would throw away a real amount, so the person removing them
-- is asked to deal with the expense first.
create or replace function public.forget_member(p_flat uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if exists (select 1 from expenses where flat_id = p_flat and paid_by = p_uid) then
    raise exception 'They are down as paying for an expense — change or delete it first';
  end if;
  update expenses set split_among = array_remove(split_among, p_uid)
    where flat_id = p_flat and p_uid = any(split_among);
  delete from settlements where flat_id = p_flat and (from_user = p_uid or to_user = p_uid);
  update flat_items set bought_by = null where flat_id = p_flat and bought_by = p_uid;
  delete from flat_members where flat_id = p_flat and user_id = p_uid;
end; $function$;

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
  perform forget_member(m.flat_id, m.user_id);
end; $function$;

-- Turning the invite down, from the link itself and with no account.
create or replace function public.decline_invite(p_token text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members;
begin
  select * into m from flat_members where invite_token = p_token and claimed_at is null;
  if m.id is null then return; end if;   -- already used or already declined
  perform forget_member(m.flat_id, m.user_id);
end; $function$;

grant execute on function public.decline_invite(text) to anon, authenticated;
