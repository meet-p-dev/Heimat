-- Activity: everything that happens in a group, in one place.
--
-- The activity table has always had expenses, payments, people joining and leaving and
-- repeating expenses (written by triggers, never by the apps). Home's new Activity page
-- shows it for every group at once, so the rest of a group's life goes in too:
--
--   shopping list   item_added, item_bought, item_removed (an item taken off before it was bought;
--                   clearing bought items is housekeeping and isn't written)
--   group bills     bill_added, bill_edited, bill_removed, bill_paid, bill_unpaid
--   chores          chore_added, chore_edited, chore_removed, chore_done, chore_undone,
--                   chore_skipped (meta.to: who has it now), swap_asked (meta.to),
--                   swap_accepted, swap_declined (meta.from: who had asked)
--
-- Personal bills (no group) are nobody else's business and are never written. Nothing here
-- sends a notification: Activity is something you look at, not something that calls you.
-- Every trigger is AFTER and only inserts into activity, so none of them can change or block
-- what it is watching.

-- ------------------------------------------------------------------ shopping list

create or replace function public.log_item()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform log(new.flat_id, coalesce(new.added_by, auth.uid()), 'item_added', new.title, null, '{}'::jsonb);
  elsif tg_op = 'UPDATE' then
    if new.bought and not old.bought then
      perform log(new.flat_id, coalesce(new.bought_by, auth.uid()), 'item_bought', new.title, null, '{}'::jsonb);
    end if;
  elsif tg_op = 'DELETE' then
    if not old.bought then
      perform log(old.flat_id, auth.uid(), 'item_removed', old.title, null, '{}'::jsonb);
    end if;
    return old;
  end if;
  return new;
end; $function$;

drop trigger if exists log_item on public.flat_items;
create trigger log_item after insert or update or delete on public.flat_items
  for each row execute function public.log_item();

-- ------------------------------------------------------------------ group bills

create or replace function public.log_bill()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.flat_id is not null then
      perform log(new.flat_id, coalesce(new.created_by, auth.uid()), 'bill_added', new.name, new.amount, '{}'::jsonb);
    end if;
    return new;
  end if;
  if new.flat_id is null then return new; end if;
  if new.archived_at is not null and old.archived_at is null then
    perform log(new.flat_id, auth.uid(), 'bill_removed', new.name, new.amount, '{}'::jsonb);
  elsif new.archived_at is null and (new.name is distinct from old.name or new.amount is distinct from old.amount
        or new.cadence is distinct from old.cadence or new.anchor_on is distinct from old.anchor_on
        or new.payer is distinct from old.payer) then
    perform log(new.flat_id, auth.uid(), 'bill_edited', new.name, new.amount, '{}'::jsonb);
  end if;
  return new;
end; $function$;

drop trigger if exists log_bill on public.bills;
create trigger log_bill after insert or update on public.bills
  for each row execute function public.log_bill();

create or replace function public.log_bill_payment()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare b bills;
begin
  if tg_op = 'INSERT' then
    if new.flat_id is null then return new; end if;
    select * into b from bills where id = new.bill_id;
    perform log(new.flat_id, coalesce(new.paid_by, auth.uid()), 'bill_paid', b.name, b.amount,
                jsonb_build_object('due', new.due_on));
    return new;
  end if;
  if old.flat_id is null then return old; end if;
  select * into b from bills where id = old.bill_id;
  -- a bill deleted outright takes its payments with it: that is not anyone un-ticking one
  if b.id is not null then
    perform log(old.flat_id, auth.uid(), 'bill_unpaid', b.name, b.amount, jsonb_build_object('due', old.due_on));
  end if;
  return old;
end; $function$;

drop trigger if exists log_bill_payment on public.bill_payments;
create trigger log_bill_payment after insert or delete on public.bill_payments
  for each row execute function public.log_bill_payment();

-- ------------------------------------------------------------------ chores

create or replace function public.log_chore()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform log(new.flat_id, coalesce(new.created_by, auth.uid()), 'chore_added', new.name, null, '{}'::jsonb);
  elsif new.archived_at is not null and old.archived_at is null then
    perform log(new.flat_id, auth.uid(), 'chore_removed', new.name, null, '{}'::jsonb);
  elsif new.archived_at is null and (new.name is distinct from old.name or new.cadence is distinct from old.cadence
        or new.anchor_on is distinct from old.anchor_on or new.rota is distinct from old.rota
        or new.points is distinct from old.points) then
    perform log(new.flat_id, auth.uid(), 'chore_edited', new.name, null, '{}'::jsonb);
  end if;
  return new;
end; $function$;

drop trigger if exists log_chore on public.chores;
create trigger log_chore after insert or update on public.chores
  for each row execute function public.log_chore();

create or replace function public.log_chore_turn()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare v_name text;
begin
  select name into v_name from chores where id = new.chore_id;
  if new.state = 'done' and old.state = 'open' then
    perform log(new.flat_id, coalesce(new.done_by, auth.uid()), 'chore_done', v_name, null, '{}'::jsonb);
  elsif new.state = 'open' and old.state = 'done' then
    perform log(new.flat_id, auth.uid(), 'chore_undone', v_name, null, '{}'::jsonb);
  elsif new.state = 'open' and old.state = 'open' and auth.uid() is not null
        and old.assignee = auth.uid() and new.assignee is distinct from auth.uid() and new.assignee is not null then
    -- chore_skip: the turn goes from you to whoever had the next one (a swap you were asked
    -- for is written by the swap itself, and there the turn comes *to* you)
    perform log(new.flat_id, auth.uid(), 'chore_skipped', v_name, null, jsonb_build_object('to', new.assignee));
  end if;
  return new;
end; $function$;

drop trigger if exists log_chore_turn on public.chore_turns;
create trigger log_chore_turn after update on public.chore_turns
  for each row execute function public.log_chore_turn();

create or replace function public.log_chore_swap()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare v_name text;
begin
  select name into v_name from chores where id = new.chore_id;
  if tg_op = 'INSERT' then
    perform log(new.flat_id, new.from_user, 'swap_asked', v_name, null, jsonb_build_object('to', new.to_user));
  elsif new.answer in ('accepted', 'declined') and old.answer is null then
    perform log(new.flat_id, new.to_user, 'swap_' || new.answer, v_name, null, jsonb_build_object('from', new.from_user));
  end if;
  return new;
end; $function$;

drop trigger if exists log_chore_swap on public.chore_swaps;
create trigger log_chore_swap after insert or update on public.chore_swaps
  for each row execute function public.log_chore_swap();

-- trigger functions are never called directly
revoke all on function public.log_item()         from public, anon, authenticated;
revoke all on function public.log_bill()         from public, anon, authenticated;
revoke all on function public.log_bill_payment() from public, anon, authenticated;
revoke all on function public.log_chore()        from public, anon, authenticated;
revoke all on function public.log_chore_turn()   from public, anon, authenticated;
revoke all on function public.log_chore_swap()   from public, anon, authenticated;
