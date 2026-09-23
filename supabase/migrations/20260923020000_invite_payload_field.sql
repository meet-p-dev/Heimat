-- The invite trigger called its payload field `token`, and invite_notify adds
-- the shared auth `token` to everything it sends — so the invite token was
-- being overwritten by the auth token on its way out, and the email would have
-- carried a link to nothing.
--
-- Written out as its own migration because the first one has already run here.
-- A database built from these files in order gets the corrected version twice,
-- which costs nothing.

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
