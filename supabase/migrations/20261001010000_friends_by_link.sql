-- Friends you add from your contacts by name alone (someone with only a phone
-- number): a placeholder with no email and a personal link, which the app hands
-- you to send them over WhatsApp, iMessage or anything else. Nobody is emailed.
--
--  * friend_circle_id takes {"name": …} on its own, and treats a waiting
--    link-only placeholder as someone you know (so the same person can be
--    picked again by name, and stays one friend);
--  * new link-only people count towards the daily limit of new people;
--  * claim_invite: opening a link-only invite also takes every other place the
--    same placeholder waits (there is no address to match — the link is the
--    person), unless you are already in that place.

create or replace function public.friend_circle_id(p_people jsonb)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  p jsonb; m flat_members;
  v_uid uuid; v_email text; v_name text; v_pending boolean; v_link boolean;
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
    v_uid := null; v_email := null; v_pending := false; v_link := false;
    v_name := left(nullif(btrim(coalesce(p ->> 'name', '')), ''), 60);
    if nullif(btrim(coalesce(p ->> 'user_id', '')), '') is not null then
      begin
        v_uid := btrim(p ->> 'user_id')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = 'P0001', message = 'friends: choose who it is with', detail = '{"code": "bad_value"}';
      end;
      if v_uid = me then continue; end if;
      -- someone you share a flat, group or friend with (now or before): as an account,
      -- or as an invite that is still waiting (by email or by link) — a dead invite is nobody
      select m2.* into m
        from flat_members m1 join flat_members m2 on m2.flat_id = m1.flat_id
        where m1.user_id = me and m1.claimed_at is not null and m2.user_id = v_uid
          and (m2.claimed_at is not null
               or (m2.left_at is null and (m2.invite_email is not null or m2.invite_token is not null)))
        order by (m2.claimed_at is not null) desc, m2.joined_at desc, m2.id
        limit 1;
      if m.id is null then
        raise exception using errcode = 'P0001', message = 'friends: not someone you know here',
          detail = jsonb_build_object('code', 'not_a_friend', 'who', v_uid)::text;
      end if;
      if m.claimed_at is null then
        v_pending := true; v_email := lower(m.invite_email); v_link := m.invite_email is null;
        v_name := coalesce(v_name, m.display_name);
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
    elsif v_name is not null then
      -- a name and nothing else: someone new, reached by a link you send them
      v_uid := gen_random_uuid(); v_pending := true; v_link := true;
    else
      raise exception using errcode = 'P0001', message = 'friends: choose who it is with', detail = '{"code": "bad_value"}';
    end if;
    if v_uid = any(ids) then continue; end if;
    ids := ids || v_uid;
    ppl := ppl || jsonb_build_array(jsonb_build_object(
      'uid', v_uid, 'email', case when v_pending then v_email end, 'link', v_link,
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
  v_new := (select count(*) from jsonb_array_elements(ppl) x where x ->> 'email' is not null or (x ->> 'link')::boolean);
  if v_new > 0 and v_new + (select count(*) from flat_members fm join flats f on f.id = fm.flat_id
                            where f.kind = 'direct' and fm.invited_by = me and fm.claimed_at is null
                              and (fm.invite_email is not null or fm.invite_token is not null)
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
    if p ->> 'email' is null and not (p ->> 'link')::boolean then
      insert into flat_members (flat_id, user_id, display_name, invited_by, claimed_at)
        values (v_flat, (p ->> 'uid')::uuid, p ->> 'name', me, now());
    else
      insert into flat_members (flat_id, user_id, display_name, invite_email, invite_token, invited_by)
        values (v_flat, (p ->> 'uid')::uuid, p ->> 'name', p ->> 'email', replace(gen_random_uuid()::text, '-', ''), me);
    end if;
  end loop;
  return v_flat;
end; $function$;

-- Opening a link: takes over that invite. Someone already in that flat or group may
-- only do it with the invited (confirmed) address — otherwise any member could fold a
-- waiting person's money into their own. With the invited address — or, for someone
-- invited by link alone, the link itself — every other place that person is waiting
-- (the same placeholder) comes too.
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
     and (m.invite_email is null or v_email is distinct from lower(m.invite_email)) then
    raise exception 'You''re already in here — this invite is for someone else';
  end if;
  perform claim_member(m.id, auth.uid());
  if m.invite_email is null or v_email = lower(m.invite_email) then
    for r in select id, flat_id from flat_members where user_id = m.user_id and claimed_at is null and left_at is null loop
      -- (claim_member would fold the placeholder into an account already in that place)
      continue when m.invite_email is null
                and exists (select 1 from flat_members x where x.flat_id = r.flat_id and x.user_id = auth.uid());
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

revoke all on function public.friend_circle_id(jsonb) from public, anon, authenticated;
revoke all on function public.claim_invite(text)      from public, anon;
grant execute on function public.claim_invite(text)   to authenticated;
