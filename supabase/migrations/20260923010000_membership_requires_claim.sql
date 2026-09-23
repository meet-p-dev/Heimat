-- Membership means a claimed membership.
--
-- `is_member()` matched on user_id alone, which a pending invite's placeholder
-- id satisfies. Nothing could reach it — Supabase only issues a token for a
-- real auth.users row, and a placeholder has none — but the check should hold
-- on its own terms rather than on that, so it now also requires the row to
-- have been claimed.
--
-- Which means every path that adds a real member has to say so: create_flat
-- and join_flat predate invites and left claimed_at null, and would otherwise
-- lock people out of the flat they just made.

create or replace function public.is_member(p_flat uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from flat_members m
    where m.flat_id = p_flat and m.user_id = auth.uid() and m.claimed_at is not null
  );
$function$;

create or replace function public.create_flat(p_name text, p_display_name text)
returns public.flats
language plpgsql security definer set search_path to 'public'
as $function$
declare v_code text; v_flat flats;
begin
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from flats where join_code = v_code);
  end loop;
  insert into flats(name, join_code) values (coalesce(nullif(p_name,''),'My flat'), v_code)
    returning * into v_flat;
  insert into flat_members(flat_id, user_id, display_name, claimed_at)
    values (v_flat.id, auth.uid(), coalesce(nullif(p_display_name,''),'Me'), now());
  return v_flat;
end; $function$;

create or replace function public.join_flat(p_code text, p_display_name text)
returns public.flats
language plpgsql security definer set search_path to 'public'
as $function$
declare v_flat flats;
begin
  select * into v_flat from flats where join_code = upper(p_code);
  if v_flat.id is null then raise exception 'Invalid flat code'; end if;
  insert into flat_members(flat_id, user_id, display_name, claimed_at)
    values (v_flat.id, auth.uid(), coalesce(nullif(p_display_name,''),'Me'), now())
    on conflict (flat_id, user_id)
    do update set claimed_at = coalesce(flat_members.claimed_at, now());
  return v_flat;
end; $function$;
