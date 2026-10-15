-- Chores done on their day, and reminding whoever's turn it is.
--
-- Some chores belong to one day — the bins go out on collection day — and a turn "until
-- Sunday" is no use for them. A chore can now be done "on the day": its turn is just that
-- day (the date it falls on, every week, two weeks…), whoever's turn it is hears about it at
-- 18:00–20:00 the evening before and on the morning of the day, and the turn is missed once
-- the day is over. Other chores are unchanged (on_day false).
--
-- chore_remind(chore): anyone in the group can nudge whoever's turn it is now — once a day
-- each, never themselves, only while the turn is open and has started.

alter table public.chores add column if not exists on_day boolean not null default false;
grant insert (on_day), update (on_day) on public.chores to authenticated;

-- changing on_day starts the turns afresh, as a new frequency or start date does
create or replace function public.chores_changed()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.rota is distinct from old.rota or new.cadence <> old.cadence or new.anchor_on <> old.anchor_on
     or new.on_day <> old.on_day
     or (new.archived_at is not null and old.archived_at is null) then
    update chore_swaps set answer = 'withdrawn', answered_at = now() where chore_id = new.id and answer is null;
    delete from chore_turns where chore_id = new.id and state = 'open';
  end if;
  return new;
end; $function$;

-- a turn on its day ends that day; any other turn ends the day before the next one starts
create or replace function public.chore_ensure(p_chore uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare c chores; d date := heimat_today(); v_n integer; k integer;
begin
  select * into c from chores where id = p_chore;
  if c.id is null or c.archived_at is not null then return null; end if;
  v_n := greatest(occurrence_on(c.anchor_on, c.cadence, d), 0);
  for k in v_n .. v_n + 1 loop
    insert into chore_turns (chore_id, n, flat_id, starts_on, ends_on, assignee)
      values (c.id, k, c.flat_id, recurring_occurrence(c.anchor_on, c.cadence, k),
              case when c.on_day then recurring_occurrence(c.anchor_on, c.cadence, k)
                   else recurring_occurrence(c.anchor_on, c.cadence, k + 1) - 1 end,
              chore_default(c, k))
      on conflict (chore_id, n) do nothing;
  end loop;
  -- after making them, so a turn made today for a day already gone is missed at once
  update chore_turns set state = 'missed' where chore_id = c.id and state = 'open' and ends_on < d;
  update chore_swaps s set answer = 'withdrawn', answered_at = now()
    where s.chore_id = c.id and s.answer is null
      and not exists (select 1 from chore_turns t where t.chore_id = s.chore_id and t.n = s.n and t.state = 'open');
  update chore_turns t set assignee = chore_default(c, t.n)
    where t.chore_id = c.id and t.state = 'open' and t.n >= v_n
      and (t.assignee is null or not is_current_member(c.flat_id, t.assignee));
  return v_n;
end; $function$;

-- the same reminders as before; a chore on its day says "Today", and its next turn gets a
-- heads-up the evening before
create or replace function public.run_reminders()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  b bills; c chores; t chore_turns; v_n integer; v_cb date; d date; sent integer := 0;
  v_where text; v_to uuid;
begin
  for b in select * from bills where archived_at is null loop
    v_where := case when b.flat_id is null then null else (select name from flats where id = b.flat_id) end;
    -- pay today: to whoever pays it, when today (theirs) is a due date and it isn't ticked
    if b.payer is not null and local_awake(b.payer) then
      d := local_today(b.payer);
      v_n := occurrence_on(b.anchor_on, b.cadence, d);
      if v_n >= 0 and recurring_occurrence(b.anchor_on, b.cadence, v_n) = d
         and (b.flat_id is null or is_current_member(b.flat_id, b.payer))
         and not exists (select 1 from bill_payments where bill_id = b.id and due_on = d)
         and remind_once(b.id, d, 'bill_due') then
        perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', b.flat_id, 'to_user', b.payer,
          'title', 'Pay ' || b.name || ' today',
          'message', coalesce(case when b.amount is not null then replace(to_char(b.amount, 'FM999999990.00'), '.', ',') || ' ' || b.currency end, 'Due today')
                     || coalesce(' · ' || v_where, '') || ' — tick it once it''s paid'));
        sent := sent + 1;
      end if;
    end if;
    -- cancel by: four weeks and one week before the last day
    v_cb := bill_cancel_by(b);
    v_to := coalesce(b.payer, b.owner_id, b.created_by);
    if v_cb is not null and v_to is not null and local_awake(v_to) and v_cb - local_today(v_to) in (28, 7)
       and (b.flat_id is null or is_current_member(b.flat_id, v_to))
       and remind_once(b.id, v_cb, 'cancel_' || (v_cb - local_today(v_to))) then
      perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', b.flat_id, 'to_user', v_to,
        'title', b.name || ': cancel by ' || to_char(v_cb, 'DD.MM.YYYY'),
        'message', 'If you want to end it, cancel within ' || (v_cb - local_today(v_to)) || ' days — otherwise it renews by itself'));
      sent := sent + 1;
    end if;
  end loop;

  for c in select * from chores where archived_at is null loop
    v_n := chore_ensure(c.id);
    -- a chore done on its day: the evening before, a heads-up to whoever's turn it is next
    -- (the turn starting tomorrow is the next one, or before the first day the first one)
    if c.on_day then
      select * into t from chore_turns where chore_id = c.id and chore_turns.n in (v_n, v_n + 1)
        and chore_turns.state = 'open' and chore_turns.assignee is not null
        and chore_turns.starts_on = local_today(chore_turns.assignee) + 1
        order by chore_turns.n limit 1;
      if t.chore_id is not null and t.state = 'open' and t.assignee is not null
         and (c.cadence <> '1d')
         and t.starts_on = local_today(t.assignee) + 1
         and (nullif(current_setting('heimat.today', true), '') is not null
              or extract(hour from now() at time zone user_tz(t.assignee)) between 18 and 20)
         and remind_once(c.id, t.starts_on, 'chore_eve') then
        perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', c.flat_id, 'to_user', t.assignee,
          'title', 'Tomorrow: ' || c.name,
          'message', 'Your turn is tomorrow · ' || (select name from flats where id = c.flat_id)));
        sent := sent + 1;
      end if;
    end if;
    select * into t from chore_turns where chore_id = c.id and chore_turns.n = v_n;
    continue when t.chore_id is null or t.state <> 'open' or t.assignee is null or not local_awake(t.assignee);
    d := local_today(t.assignee);
    continue when t.starts_on > d or t.ends_on < d;
    if t.starts_on = d and remind_once(c.id, d, 'chore_start') then
      perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', c.flat_id, 'to_user', t.assignee,
        'title', 'Your turn: ' || c.name,
        'message', case when t.starts_on = t.ends_on then 'Today'
                        when c.cadence = 'weekly' then 'This week' when c.cadence = 'biweekly' then 'These two weeks'
                        when c.cadence = 'monthly' then 'This month'
                        else 'Until ' || to_char(t.ends_on, 'FMDD.FMMM.') end
                   || ' · tick it in ' || (select name from flats where id = c.flat_id) || ' when it''s done'));
      sent := sent + 1;
    elsif t.ends_on = d and t.starts_on < d and remind_once(c.id, d, 'chore_last') then
      perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', c.flat_id, 'to_user', t.assignee,
        'title', c.name || ' is still open',
        'message', 'Today is the last day of your turn'));
      sent := sent + 1;
    end if;
  end loop;

  return sent + run_daily_add();
end; $function$;

-- "Remind Dhruv": whoever's turn it is now, once a day from each person
create or replace function public.chore_remind(p_chore uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare me uuid := auth.uid(); c chores; t chore_turns; v_n integer; v_day date := heimat_today(); v_who text; v_to text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into c from chores where id = p_chore;
  if c.id is null or c.archived_at is not null or not is_member(c.flat_id) then
    raise exception using errcode = 'P0001', message = 'chores: that chore is not in your group', detail = '{"code": "not_yours"}';
  end if;
  v_n := chore_ensure(c.id);
  select * into t from chore_turns where chore_id = c.id and n = v_n;
  if t.chore_id is null or t.state <> 'open' or t.assignee is null or t.assignee = me
     or t.starts_on > v_day or t.ends_on < v_day then
    raise exception using errcode = 'P0001', message = 'chores: there''s nobody to remind right now', detail = '{"code": "nothing_open"}';
  end if;
  if not remind_once(t.chore_id, v_day, 'chore_nudge:' || me::text) then
    raise exception using errcode = 'P0001', message = 'chores: you already reminded them today', detail = '{"code": "already"}';
  end if;
  select coalesce(nullif(display_name, ''), 'A flatmate') into v_who from flat_members where flat_id = c.flat_id and user_id = me;
  select display_name into v_to from flat_members where flat_id = c.flat_id and user_id = t.assignee;
  perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', c.flat_id, 'to_user', t.assignee,
    'title', c.name,
    'message', coalesce(v_who, 'A flatmate') || ' reminds you — '
               || case when t.starts_on = t.ends_on then 'it''s today'
                       when t.ends_on = v_day then 'today is the last day'
                       else 'your turn runs until ' || to_char(t.ends_on, 'FMDD.FMMM.') end));
  return coalesce(v_to, 'them');
end; $function$;
revoke execute on function public.chore_remind(uuid) from public, anon;
grant execute on function public.chore_remind(uuid) to authenticated;
