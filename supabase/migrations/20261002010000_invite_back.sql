-- "Invite back": someone who deleted their account keeps their name on the group's
-- expenses, but nothing can reach that history any more — signing up again and
-- joining with the code makes a new member. A member of the group can now turn
-- the old place back into a personal invite; whoever opens that link (claim_invite)
-- takes over the history, payments and balance, the way an emailed invite does.
--
-- Only for an account that is gone: someone who left but still has an account
-- gets their place back simply by joining with the code (join_flat).
-- A member decides, not whoever knows the code — the code alone must never be
-- enough to claim someone else's history and money.

create or replace function public.invite_back(p_member uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members; v_token text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into m from flat_members where id = p_member;
  if m.id is null or not is_member(m.flat_id) then
    raise exception using errcode = 'P0001', message = 'invite_back: they aren''t in a group of yours', detail = '{"code": "not_yours"}';
  end if;
  -- already waiting for them: the same link again
  if m.claimed_at is null and m.left_at is null and m.invite_token is not null then
    return m.invite_token;
  end if;
  if m.left_at is null then
    raise exception using errcode = 'P0001', message = 'invite_back: they''re still in the group', detail = '{"code": "still_here"}';
  end if;
  if exists (select 1 from auth.users u where u.id = m.user_id) then
    raise exception using errcode = 'P0001', message = 'invite_back: they still have their account — they can join again with the group''s code, and their history comes back',
      detail = '{"code": "has_account"}';
  end if;
  update flat_members set claimed_at = null, left_at = null, invite_email = null,
         invite_token = replace(gen_random_uuid()::text, '-', ''), invited_by = auth.uid()
   where id = m.id
  returning invite_token into v_token;
  return v_token;
end; $function$;

revoke all on function public.invite_back(uuid) from public, anon;
grant execute on function public.invite_back(uuid) to authenticated;
