-- Let a member rename themselves in the flats they belong to, so changing your
-- name in Profile reaches your flatmates too.
--
-- A row-level UPDATE policy alone would also let a member rewrite flat_id on
-- their own row and walk into any flat, bypassing join_flat(). So the grant is
-- column-level: display_name is the only column clients may update, and only
-- on their own row.
revoke update on public.flat_members from anon, authenticated;
grant update (display_name) on public.flat_members to authenticated;

drop policy if exists members_rename on public.flat_members;
create policy members_rename on public.flat_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
