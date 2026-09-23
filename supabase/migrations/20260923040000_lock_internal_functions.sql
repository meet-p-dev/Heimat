-- Internal plumbing was reachable over the REST API.
--
-- Postgres grants EXECUTE on a new function to PUBLIC, and PostgREST exposes
-- everything in `public` as /rest/v1/rpc/<name>. So helpers meant to be called
-- only by a trigger, or only by another function that had already checked who
-- was asking, could be called directly by anyone holding the anon key:
--
--   forget_member(flat, user)  deletes a member and strips them out of every
--                              split. The permission check lives in its
--                              caller, revoke_invite — so called directly it
--                              had none at all, and any flatmate could quietly
--                              remove another and rewrite the splits.
--   claim_member(member, uid)  hands a pending invite to whichever account id
--                              it is passed.
--   invite_notify / push_notify  post an arbitrary payload to the edge
--                              functions using the shared token, which is an
--                              open relay for email and push notifications.
--
-- The trigger functions are harmless to call loose — they fault without a
-- trigger context — but they have no business being exposed either.
--
-- What clients legitimately call keeps its grant: creating and joining,
-- inviting and revoking, previewing and claiming and declining an invite.
-- is_member stays granted because RLS policy expressions are evaluated as the
-- calling role, and every policy on every table is built on it.

revoke all on function public.forget_member(uuid, uuid)            from public, anon, authenticated;
revoke all on function public.claim_member(uuid, uuid)             from public, anon, authenticated;
revoke all on function public.invite_notify(jsonb)                 from public, anon, authenticated;
revoke all on function public.push_notify(jsonb)                   from public, anon, authenticated;
revoke all on function public.claim_invites_for_new_email()        from public, anon, authenticated;
revoke all on function public.on_expense_insert()                  from public, anon, authenticated;
revoke all on function public.on_flat_item_insert()                from public, anon, authenticated;
revoke all on function public.on_member_invited()                  from public, anon, authenticated;
revoke all on function public.on_settlement_insert()               from public, anon, authenticated;
revoke all on function public.rls_auto_enable()                    from public, anon, authenticated;

-- Signing in is required for all of these; anon holds the key before sign-up
-- but has no business creating flats or inviting people.
revoke all on function public.create_flat(text, text)              from public, anon;
revoke all on function public.create_group(text, text)             from public, anon;
revoke all on function public.join_flat(text, text)                from public, anon;
revoke all on function public.invite_member(uuid, text, text)      from public, anon;
revoke all on function public.revoke_invite(uuid)                  from public, anon;
revoke all on function public.claim_invite(text)                   from public, anon;
revoke all on function public.claim_invites()                      from public, anon;

grant execute on function public.create_flat(text, text)           to authenticated;
grant execute on function public.create_group(text, text)          to authenticated;
grant execute on function public.join_flat(text, text)             to authenticated;
grant execute on function public.invite_member(uuid, text, text)   to authenticated;
grant execute on function public.revoke_invite(uuid)               to authenticated;
grant execute on function public.claim_invite(text)                to authenticated;
grant execute on function public.claim_invites()                   to authenticated;

-- Reached from the invite link, by someone who has no account yet.
grant execute on function public.invite_preview(text)              to anon, authenticated;
grant execute on function public.decline_invite(text)              to anon, authenticated;
