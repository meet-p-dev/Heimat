-- Reminders at the right local time, a daily "anything to add today?", and the payer
-- hears about a payment the other person recorded.
--
-- Until now every reminder ran on German time: 9:00–20:00 in Berlin and Berlin's "today",
-- which is wrong for anyone living elsewhere. Each device now tells the server its time
-- zone (set_time_zone, sent by the apps on launch); someone without one is on Berlin time,
-- as before, so nothing changes for people on older builds.

create table if not exists public.notify_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- the phone's IANA time zone, e.g. Europe/Berlin, Asia/Kolkata, America/Toronto
  tz text not null default 'Europe/Berlin',
  -- the local hour of the daily reminder; null = off
  daily_hour smallint default 20 check (daily_hour between 0 and 23),
  updated_at timestamptz not null default now()
);
alter table public.notify_prefs enable row level security;
drop policy if exists notify_prefs_own on public.notify_prefs;
create policy notify_prefs_own on public.notify_prefs for select to authenticated using (user_id = auth.uid());
revoke all on public.notify_prefs from anon, authenticated;
grant select on public.notify_prefs to authenticated;

-- this person's time zone (Berlin until a device has said)
create or replace function public.user_tz(p_uid uuid)
returns text language sql stable security definer set search_path to 'public'
as $$ select coalesce((select tz from notify_prefs where user_id = p_uid), 'Europe/Berlin') $$;
revoke execute on function public.user_tz(uuid) from public, anon, authenticated;

-- "today" and "awake" for one person; a rehearsal's pinned day (heimat.today) goes straight through
create or replace function public.local_today(p_uid uuid)
returns date language sql stable security definer set search_path to 'public'
as $$ select coalesce(nullif(current_setting('heimat.today', true), '')::date, (now() at time zone user_tz(p_uid))::date) $$;
create or replace function public.local_awake(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select nullif(current_setting('heimat.today', true), '') is not null
          or extract(hour from now() at time zone user_tz(p_uid)) between 9 and 20 $$;
revoke execute on function public.local_today(uuid) from public, anon, authenticated;
revoke execute on function public.local_awake(uuid) from public, anon, authenticated;

create or replace function public.set_time_zone(p_tz text)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  insert into notify_prefs (user_id, tz) values (auth.uid(), p_tz)
  on conflict (user_id) do update set tz = excluded.tz, updated_at = now()
    where notify_prefs.tz is distinct from excluded.tz;
end; $$;

-- the daily reminder's local hour, or null for off
create or replace function public.set_daily_reminder(p_hour integer)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_hour is not null and p_hour not between 0 and 23 then
    raise exception 'Pick an hour between 0 and 23' using errcode = '22023';
  end if;
  insert into notify_prefs (user_id, daily_hour) values (auth.uid(), p_hour)
  on conflict (user_id) do update set daily_hour = excluded.daily_hour, updated_at = now();
end; $$;
revoke execute on function public.set_time_zone(text) from public, anon;
revoke execute on function public.set_daily_reminder(integer) from public, anon;
grant execute on function public.set_time_zone(text) to authenticated;
grant execute on function public.set_daily_reminder(integer) to authenticated;

-- Bills, contracts and chore turns: the same reminders as before, each at 9:00–20:00 in the
-- recipient's own time and on their own "today"
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
    select * into t from chore_turns where chore_id = c.id and chore_turns.n = v_n;
    continue when t.chore_id is null or t.state <> 'open' or t.assignee is null or not local_awake(t.assignee);
    d := local_today(t.assignee);
    continue when t.starts_on > d;
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

  return sent + run_daily_add();
end; $function$;

-- "Anything to add today?" — once a day at the hour someone picked (20:00 unless changed), in
-- their own time, and only when it helps: they share costs with someone, haven't added anything
-- today, and still use Splitlife (added something or joined in the last 14 days — no daily
-- nagging of someone who has stopped). Tapping it opens Add expense.
create or replace function public.run_daily_add()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_day date; sent integer := 0;
begin
  for r in
    select np.user_id, np.tz from notify_prefs np
    where np.daily_hour is not null
      and (nullif(current_setting('heimat.today', true), '') is not null
           or extract(hour from now() at time zone np.tz) = np.daily_hour)
      and exists (select 1 from push_subscriptions s where s.user_id = np.user_id)
  loop
    v_day := local_today(r.user_id);
    continue when not exists (select 1 from flat_members m where m.user_id = r.user_id and m.left_at is null and m.claimed_at is not null);
    continue when exists (select 1 from expenses e where e.created_by = r.user_id and e.recurring_id is null
                          and e.created_at >= (v_day::timestamp at time zone r.tz));
    continue when not exists (select 1 from expenses e where e.created_by = r.user_id and e.created_at > now() - interval '14 days')
              and not exists (select 1 from flat_members m where m.user_id = r.user_id and m.claimed_at > now() - interval '14 days');
    continue when not remind_once(r.user_id, v_day, 'daily_add');
    perform push_notify(jsonb_build_object('event', 'reminder', 'to_user', r.user_id, 'open', 'add',
      'title', 'Anything to add today?',
      'message', 'Groceries, a coffee, a ticket — add today''s expenses in a few seconds, before you forget.'));
    sent := sent + 1;
  end loop;
  return sent;
end; $function$;
revoke execute on function public.run_daily_add() from public, anon, authenticated;

-- a payment says who paid, so the payer hears about it when the other person recorded it
create or replace function public.on_settlement_insert()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform push_notify(jsonb_build_object(
    'event', 'settlement', 'flat_id', new.flat_id, 'actor', new.created_by,
    'to_user', new.to_user, 'from_user', new.from_user, 'amount', new.amount,
    'currency', coalesce(nullif(new.currency, ''), flat_currency(new.flat_id), 'EUR')
  ));
  return new;
end; $function$;
