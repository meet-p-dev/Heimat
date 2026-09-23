-- Leaving a flat, being removed from one, and being reminded you owe.
--
-- The hard part is that a member with history cannot simply vanish. Their id
-- stays in expenses.split_among and in paid_by, and the balance maths counts
-- only ids it can put a name to while still dividing by the whole split — so
-- deleting the row leaves the flat quietly not adding up. That is exactly how
-- an expense ended up stranded in this database.
--
-- So a member who has been part of anything is marked as having left instead
-- of being deleted. They stop counting as a member — no access, not in new
-- splits — but every past expense still resolves to a name and the books
-- still balance. A member with no history at all is deleted outright, because
-- there is nothing to keep.
--
-- A BEFORE DELETE trigger does the converting, which means both apps get the
-- safe behaviour without either of them changing: the web app deletes the row
-- to leave a flat, exactly as it always has.

alter table public.flat_members add column if not exists left_at timestamptz;

create or replace function public.is_member(p_flat uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from flat_members m
    where m.flat_id = p_flat and m.user_id = auth.uid()
      and m.claimed_at is not null and m.left_at is null
  );
$function$;

create or replace function public.has_history(p_flat uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from expenses e
    where e.flat_id = p_flat and (e.paid_by = p_uid or p_uid = any(e.split_among))
  ) or exists (
    select 1 from settlements s
    where s.flat_id = p_flat and (s.from_user = p_uid or s.to_user = p_uid)
  );
$function$;

create or replace function public.on_member_delete()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if has_history(old.flat_id, old.user_id) then
    update flat_members set left_at = coalesce(left_at, now()) where id = old.id;
    return null;   -- cancels the delete; the row stays, marked as gone
  end if;
  return old;      -- nothing to keep
end; $function$;

drop trigger if exists member_delete on public.flat_members;
create trigger member_delete before delete on public.flat_members
  for each row execute function public.on_member_delete();

-- What someone is up or down in one flat, for the rule below.
create or replace function public.flat_balance(p_flat uuid, p_uid uuid)
returns numeric
language sql stable security definer set search_path to 'public'
as $function$
  with parts as (
    select e.paid_by, e.amount,
           case when cardinality(e.split_among) = 0 then array[e.paid_by] else e.split_among end as ppl
    from expenses e where e.flat_id = p_flat
  )
  select round(
      coalesce((select sum(case when p.paid_by = p_uid then p.amount else 0 end)
                     - sum(case when p_uid = any(p.ppl) then p.amount / cardinality(p.ppl) else 0 end)
                from parts p), 0)
    + coalesce((select sum(amount) from settlements where flat_id = p_flat and from_user = p_uid), 0)
    - coalesce((select sum(amount) from settlements where flat_id = p_flat and to_user = p_uid), 0)
  , 2);
$function$;

-- Taking someone out. Only when they are square: a debt that disappears
-- because somebody was removed is worse than an argument about removing them.
create or replace function public.remove_member(p_flat uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_bal numeric;
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  if p_uid = auth.uid() then raise exception 'Use Leave to remove yourself'; end if;
  v_bal := flat_balance(p_flat, p_uid);
  if abs(v_bal) > 0.5 then
    raise exception 'Settle up with them first — they are % here',
      case when v_bal > 0 then 'owed ' || to_char(v_bal, 'FM999999.00')
           else 'down ' || to_char(-v_bal, 'FM999999.00') end;
  end if;
  delete from flat_members where flat_id = p_flat and user_id = p_uid;  -- trigger decides how
end; $function$;

create or replace function public.leave_flat(p_flat uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  delete from flat_members where flat_id = p_flat and user_id = auth.uid();
end; $function$;

-- A nudge. Once a day per person, because the whole point is that it is
-- easier to send than to say, and that cuts both ways.
create table if not exists public.nudges (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats(id),
  from_user uuid not null,
  to_user uuid not null,
  sent_at timestamptz not null default now()
);
create index if not exists nudges_recent on public.nudges (flat_id, from_user, to_user, sent_at desc);

create or replace function public.nudge(p_flat uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare v_last timestamptz; v_bal numeric; v_name text;
begin
  if not is_member(p_flat) then raise exception 'Not your flat'; end if;
  if p_uid = auth.uid() then raise exception 'You do not owe yourself'; end if;

  select max(sent_at) into v_last from nudges
    where flat_id = p_flat and from_user = auth.uid() and to_user = p_uid;
  if v_last is not null and v_last > now() - interval '20 hours' then
    raise exception 'You already reminded them today';
  end if;

  v_bal := flat_balance(p_flat, p_uid);
  if v_bal >= -0.5 then raise exception 'They do not owe anything here'; end if;

  select coalesce(nullif(display_name, ''), 'Someone') into v_name
    from flat_members where flat_id = p_flat and user_id = auth.uid();

  insert into nudges(flat_id, from_user, to_user) values (p_flat, auth.uid(), p_uid);
  perform push_notify(jsonb_build_object(
    'event', 'nudge', 'flat_id', p_flat, 'actor', auth.uid(),
    'to_user', p_uid, 'amount', -v_bal, 'title', v_name
  ));
end; $function$;

revoke all on function public.has_history(uuid, uuid)   from public, anon, authenticated;
revoke all on function public.on_member_delete()        from public, anon, authenticated;
revoke all on function public.flat_balance(uuid, uuid)  from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.leave_flat(uuid)          from public, anon;
revoke all on function public.nudge(uuid, uuid)         from public, anon;
grant execute on function public.flat_balance(uuid, uuid)  to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_flat(uuid)          to authenticated;
grant execute on function public.nudge(uuid, uuid)         to authenticated;
