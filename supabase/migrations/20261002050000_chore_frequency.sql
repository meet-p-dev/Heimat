-- Chores as often as you like: every N days, weeks or months (1 to 99), so "every day",
-- "every 2 days" and "every 3 weeks" work as well as the weekly, fortnightly and monthly
-- ones. A cadence is still one word: the three old names stay as they are, anything else
-- is written '<N><d|w|m>' — '1d', '2d', '3w', '2m'. (Apps save 1 week / 2 weeks / 1 month
-- under the old names, so a chore made before reads the same.)
--
-- recurring_occurrence and occurrence_on only gain the new forms: every existing name
-- gives exactly the date it gave before (recurring expenses and bills don't allow the new
-- forms at all). The chore reminder says "Today" for a daily chore and "Until 4.10." for
-- other new ones.

alter table public.chores drop constraint if exists chores_cadence_check;
alter table public.chores add constraint chores_cadence_check
  check (cadence in ('weekly', 'biweekly', 'monthly') or cadence ~ '^[1-9][0-9]?[dwm]$');

-- The n-th date, counted from the first — never from the previous one, so the 31st becomes
-- the 28th/29th in February and the 31st again in March.
create or replace function public.recurring_occurrence(p_anchor date, p_cadence text, p_n integer)
returns date
language sql immutable parallel safe set search_path to 'public'
as $function$
  select case
    when p_cadence = 'weekly'    then p_anchor + 7 * p_n
    when p_cadence = 'biweekly'  then p_anchor + 14 * p_n
    when p_cadence = 'monthly'   then (p_anchor + make_interval(months => p_n))::date
    when p_cadence = 'quarterly' then (p_anchor + make_interval(months => 3 * p_n))::date
    when p_cadence = 'yearly'    then (p_anchor + make_interval(years => p_n))::date
    -- every N days, weeks or months
    when p_cadence ~ '^[1-9][0-9]?d$' then p_anchor + left(p_cadence, -1)::integer * p_n
    when p_cadence ~ '^[1-9][0-9]?w$' then p_anchor + 7 * left(p_cadence, -1)::integer * p_n
    when p_cadence ~ '^[1-9][0-9]?m$' then (p_anchor + make_interval(months => left(p_cadence, -1)::integer * p_n))::date
  end
$function$;

-- the number of the last occurrence on or before p_day (-1 when p_day is before the first)
create or replace function public.occurrence_on(p_anchor date, p_cadence text, p_day date)
returns integer
language plpgsql immutable set search_path to 'public'
as $function$
declare n integer; k integer; mo integer;
begin
  if p_day < p_anchor then return -1; end if;
  mo := (extract(year from age(p_day, p_anchor)) * 12 + extract(month from age(p_day, p_anchor)))::integer;
  k := case when p_cadence ~ '^[1-9][0-9]?[dwm]$' then left(p_cadence, -1)::integer end;
  n := case
    when p_cadence = 'weekly'    then (p_day - p_anchor) / 7
    when p_cadence = 'biweekly'  then (p_day - p_anchor) / 14
    when p_cadence = 'monthly'   then mo
    when p_cadence = 'quarterly' then mo / 3
    when p_cadence = 'yearly'    then extract(year from age(p_day, p_anchor))::integer
    when right(p_cadence, 1) = 'd' and k is not null then (p_day - p_anchor) / k
    when right(p_cadence, 1) = 'w' and k is not null then (p_day - p_anchor) / (7 * k)
    when right(p_cadence, 1) = 'm' and k is not null then mo / k
  end;
  -- months are uneven (31 January + 1 month is 28 February): settle on the exact one
  while n > 0 and recurring_occurrence(p_anchor, p_cadence, n) > p_day loop n := n - 1; end loop;
  while recurring_occurrence(p_anchor, p_cadence, n + 1) <= p_day loop n := n + 1; end loop;
  return n;
end; $function$;

-- The daily reminders, unchanged but for what a chore's first-day reminder says.
create or replace function public.run_reminders()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  d date := heimat_today(); b bills; c chores; t chore_turns; v_n integer; v_cb date; sent integer := 0;
  v_where text; v_to uuid;
begin
  -- nine in the morning onwards (a rehearsal's pinned day goes straight through)
  if nullif(current_setting('heimat.today', true), '') is null
     and extract(hour from now() at time zone 'Europe/Berlin') not between 9 and 20 then
    return 0;
  end if;

  for b in select * from bills where archived_at is null loop
    v_where := case when b.flat_id is null then null else (select name from flats where id = b.flat_id) end;
    -- pay today: to whoever pays it, when today is a due date and it isn't ticked
    v_n := occurrence_on(b.anchor_on, b.cadence, d);
    if b.payer is not null and v_n >= 0 and recurring_occurrence(b.anchor_on, b.cadence, v_n) = d
       and (b.flat_id is null or is_current_member(b.flat_id, b.payer))
       and not exists (select 1 from bill_payments where bill_id = b.id and due_on = d)
       and remind_once(b.id, d, 'bill_due') then
      perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', b.flat_id, 'to_user', b.payer,
        'title', 'Pay ' || b.name || ' today',
        'message', coalesce(case when b.amount is not null then replace(to_char(b.amount, 'FM999999990.00'), '.', ',') || ' ' || b.currency end, 'Due today')
                   || coalesce(' · ' || v_where, '') || ' — tick it once it''s paid'));
      sent := sent + 1;
    end if;
    -- cancel by: four weeks and one week before the last day
    v_cb := bill_cancel_by(b);
    v_to := coalesce(b.payer, b.owner_id, b.created_by);
    if v_cb is not null and v_to is not null and v_cb - d in (28, 7)
       and (b.flat_id is null or is_current_member(b.flat_id, v_to))
       and remind_once(b.id, v_cb, 'cancel_' || (v_cb - d)) then
      perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', b.flat_id, 'to_user', v_to,
        'title', b.name || ': cancel by ' || to_char(v_cb, 'DD.MM.YYYY'),
        'message', 'If you want to end it, cancel within ' || (v_cb - d) || ' days — otherwise it renews by itself'));
      sent := sent + 1;
    end if;
  end loop;

  for c in select * from chores where archived_at is null loop
    v_n := chore_ensure(c.id);
    select * into t from chore_turns where chore_id = c.id and chore_turns.n = v_n;
    continue when t.chore_id is null or t.state <> 'open' or t.assignee is null or t.starts_on > d;
    if t.starts_on = d and remind_once(c.id, d, 'chore_start') then
      perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', c.flat_id, 'to_user', t.assignee,
        'title', 'Your turn: ' || c.name,
        'message', case c.cadence when 'weekly' then 'This week' when 'biweekly' then 'These two weeks' when 'monthly' then 'This month'
                     when '1d' then 'Today' else 'Until ' || to_char(t.ends_on, 'FMDD.FMMM.') end
                   || ' · tick it in ' || (select name from flats where id = c.flat_id) || ' when it''s done'));
      sent := sent + 1;
    elsif t.ends_on = d and t.starts_on < d and remind_once(c.id, d, 'chore_last') then
      perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', c.flat_id, 'to_user', t.assignee,
        'title', c.name || ' is still open',
        'message', 'Today is the last day of your turn'));
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end; $function$;
