-- Group settings: rename a group, say what it's for, rename someone who hasn't joined yet, and
-- delete a group when that can't make a debt disappear.
--
-- Until now a group's name was fixed at creation (flats has no update policy) and the only
-- way to tidy people was Remove. The apps' new "⋯" → Group settings page uses these:
--
--  * update_group(flat, name, purpose): anyone in the group, as with "simplify debts". The feed
--    says "Priya renamed the group to WG Küche". purpose is what the group is for (home, trip,
--    couple, friends, work, other) — the apps show its icon; kind (flat/group) is left alone;
--  * rename_member(flat, user, name): your own name in this group, or the name of someone
--    waiting to join (an invite, or a person brought over from Splitwise) — never someone
--    else's chosen name;
--  * delete_group(flat): the group and everything in it, when nobody else has ever joined, or
--    when every balance in every currency is zero — so no one is left owed money they can no
--    longer see. Friend circles can't be deleted this way (they're per expense).
--
-- flats aren't sent over realtime, so each change touches the caller's flat_members row,
-- which every open app listens to (as set_simplify_debts does).

alter table public.flats add column if not exists purpose text;
alter table public.flats drop constraint if exists flats_purpose_check;
alter table public.flats add constraint flats_purpose_check
  check (purpose is null or purpose in ('home', 'trip', 'couple', 'friends', 'work', 'other'));

create or replace function public.update_group(p_flat uuid, p_name text, p_purpose text default null)
returns flats
language plpgsql security definer set search_path to 'public'
as $function$
declare v_name text := left(btrim(coalesce(p_name, '')), 60); v_was text; f flats;
begin
  if not is_member(p_flat) then raise exception 'Not your group'; end if;
  select * into f from flats where id = p_flat;
  if f.kind = 'direct' then
    raise exception using errcode = 'P0001', message = 'group: only a group can be renamed', detail = '{"code": "not_a_group"}';
  end if;
  if v_name = '' then raise exception using errcode = '22023', message = 'Give the group a name'; end if;
  if p_purpose is not null and p_purpose not in ('home', 'trip', 'couple', 'friends', 'work', 'other') then
    raise exception using errcode = '22023', message = 'Pick what the group is for';
  end if;
  v_was := f.name;
  update flats set name = v_name, purpose = coalesce(p_purpose, purpose) where id = p_flat returning * into f;
  if v_name is distinct from v_was then
    perform log(p_flat, auth.uid(), 'renamed', v_name, null, jsonb_build_object('was', v_was));
  end if;
  update flat_members set display_name = display_name where flat_id = p_flat and user_id = auth.uid();
  return f;
end; $function$;

create or replace function public.rename_member(p_flat uuid, p_uid uuid, p_name text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_name text := left(btrim(coalesce(p_name, '')), 60); m flat_members;
begin
  if not is_member(p_flat) then raise exception 'Not your group'; end if;
  if v_name = '' then raise exception using errcode = '22023', message = 'Enter a name'; end if;
  select * into m from flat_members where flat_id = p_flat and user_id = p_uid;
  if m.id is null then raise exception 'Not in this group'; end if;
  if p_uid <> auth.uid() and m.claimed_at is not null then
    raise exception using errcode = 'P0001', message = 'group: only they can change their name', detail = '{"code": "theirs"}';
  end if;
  update flat_members set display_name = v_name where id = m.id;
  if p_uid <> auth.uid() then
    update flat_members set display_name = display_name where flat_id = p_flat and user_id = auth.uid();
  end if;
end; $function$;

create or replace function public.delete_group(p_flat uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare me uuid := auth.uid(); f flats;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not is_member(p_flat) then raise exception 'Not your group'; end if;
  select * into f from flats where id = p_flat;
  if f.kind = 'direct' then
    raise exception using errcode = 'P0001', message = 'group: a friend can''t be deleted', detail = '{"code": "not_a_group"}';
  end if;
  -- someone else joined at some point, and money is still owed in some currency: keep it
  if exists (select 1 from flat_members where flat_id = p_flat and claimed_at is not null and user_id <> me)
     and exists (select 1 from jsonb_each(money_snapshot(p_flat)) where jint(value) <> 0) then
    raise exception using errcode = 'P0001', message = 'group: settle up before deleting', detail = '{"code": "not_settled"}';
  end if;
  -- quiet while it goes: no feed lines or pushes for each expense and person removed
  perform set_config('heimat.import', 'on', true);
  delete from nudges where flat_id = p_flat;
  delete from settlements where flat_id = p_flat;
  delete from expenses where flat_id = p_flat;
  delete from flats where id = p_flat;
  perform set_config('heimat.import', '', true);
end; $function$;

revoke execute on function public.update_group(uuid, text, text) from public, anon;
revoke execute on function public.rename_member(uuid, uuid, text) from public, anon;
revoke execute on function public.delete_group(uuid) from public, anon;
grant execute on function public.update_group(uuid, text, text) to authenticated;
grant execute on function public.rename_member(uuid, uuid, text) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
