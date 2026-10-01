-- Bills and the chores rota (docs/bills-screens.md, docs/chores-screens.md).
--
-- Bills: something paid again and again. A shared bill belongs to a group and every
-- member sees it; a personal bill (flat_id null) is seen only by its owner. Each due
-- date is a to-do: whoever paid ticks it (bill_payments). A tick only says "paid" —
-- it adds no expense and changes no balance. Optionally a bill is a contract that
-- renews unless cancelled: its end date and notice period give a "cancel by" day.
--
-- Chores: a rota per group. Each period (a week, two weeks or a month from anchor_on)
-- every chore belongs to one person, going round the rota. The current and the next
-- period are written down (chore_turns) so a skip can trade them: a skipped turn
-- passes to the next person and theirs comes back to you. A turn not ticked by the end
-- of its period is missed. Each chore done earns its points (1, 2 or 3).
--
-- Reminders: one job, hourly, sends what is due at nine in the morning, Berlin time
-- (Germany first): "pay today" to a bill's payer, cancel-by four weeks and one week
-- before, a chore's turn on its first day and once more on its last if still open.
-- reminders_sent makes each one go once.

-- ------------------------------------------------------------------ dates

-- today, where the people are: Berlin for now. A rehearsal can pin it with
-- set_config('heimat.today', '2026-10-05', true).
create or replace function public.heimat_today()
returns date
language sql stable set search_path to 'public'
as $function$
  select coalesce(nullif(current_setting('heimat.today', true), '')::date,
                  (now() at time zone 'Europe/Berlin')::date)
$function$;

-- the number of the last occurrence on or before p_day (-1 when p_day is before the first)
create or replace function public.occurrence_on(p_anchor date, p_cadence text, p_day date)
returns integer
language plpgsql immutable set search_path to 'public'
as $function$
declare n integer;
begin
  if p_day < p_anchor then return -1; end if;
  n := case p_cadence
    when 'weekly'    then (p_day - p_anchor) / 7
    when 'biweekly'  then (p_day - p_anchor) / 14
    when 'monthly'   then (extract(year from age(p_day, p_anchor)) * 12 + extract(month from age(p_day, p_anchor)))::integer
    when 'quarterly' then ((extract(year from age(p_day, p_anchor)) * 12 + extract(month from age(p_day, p_anchor)))::integer) / 3
    when 'yearly'    then extract(year from age(p_day, p_anchor))::integer
  end;
  -- months are uneven (31 January + 1 month is 28 February): settle on the exact one
  while n > 0 and recurring_occurrence(p_anchor, p_cadence, n) > p_day loop n := n - 1; end loop;
  while recurring_occurrence(p_anchor, p_cadence, n + 1) <= p_day loop n := n + 1; end loop;
  return n;
end; $function$;

-- ------------------------------------------------------------------ bills

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  -- a group's bill, or (null) one person's own
  flat_id uuid references public.flats(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  name text not null,
  -- optional: some bills change every time (electricity), the reminder still helps
  amount numeric check (amount is null or (amount >= 0 and amount < 1000000000)),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  category text not null default 'other',
  cadence text not null default 'monthly' check (cadence in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  -- the first due date; the rest follow from it
  anchor_on date not null check (anchor_on >= date '2000-01-01'),
  -- who pays it (and is reminded); a personal bill's is its owner
  payer uuid,
  -- a contract that renews itself: when it ends, and how long before you must cancel
  contract_ends_on date,
  notice_amount smallint check (notice_amount between 1 and 24),
  notice_unit text check (notice_unit in ('week', 'month')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check ((flat_id is null) <> (owner_id is null)),
  check ((notice_amount is null) = (notice_unit is null)),
  check (notice_amount is null or contract_ends_on is not null)
);
create index if not exists bills_flat on public.bills (flat_id) where flat_id is not null;
create index if not exists bills_owner on public.bills (owner_id) where owner_id is not null;

create table if not exists public.bill_payments (
  bill_id uuid not null references public.bills(id) on delete cascade,
  due_on date not null,
  -- whoever ticked it: the one who paid
  paid_by uuid,
  paid_at timestamptz not null default now(),
  -- for realtime filters and the read policy
  flat_id uuid references public.flats(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  primary key (bill_id, due_on)
);

-- the last day to cancel a contract: its end, less the notice
create or replace function public.bill_cancel_by(b public.bills)
returns date
language sql immutable set search_path to 'public'
as $function$
  select case when b.contract_ends_on is null then null
              when b.notice_amount is null then b.contract_ends_on
              when b.notice_unit = 'week' then b.contract_ends_on - 7 * b.notice_amount
              else (b.contract_ends_on - make_interval(months => b.notice_amount))::date end
$function$;

-- someone who can be reminded in a group: an account in it now
create or replace function public.is_current_member(p_flat uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from flat_members m where m.flat_id = p_flat and m.user_id = p_uid
                   and m.claimed_at is not null and m.left_at is null)
$function$;

create or replace function public.bills_check()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' or length(new.name) > 60 then
    raise exception using errcode = 'P0001', message = 'bills: give it a name (up to 60 letters)', detail = '{"code": "bad_name"}';
  end if;
  if tg_op = 'UPDATE' and (new.flat_id is distinct from old.flat_id or new.owner_id is distinct from old.owner_id) then
    raise exception using errcode = 'P0001', message = 'bills: a bill stays where it was made', detail = '{"code": "moved"}';
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := now(); end if;
  if new.flat_id is not null then
    if (select kind from flats where id = new.flat_id) = 'direct' then
      raise exception using errcode = 'P0001', message = 'bills: bills belong to a group', detail = '{"code": "not_a_group"}';
    end if;
    if new.payer is not null and not is_current_member(new.flat_id, new.payer) then
      raise exception using errcode = 'P0001', message = 'bills: who pays it must be in the group', detail = '{"code": "bad_payer"}';
    end if;
  else
    new.payer := new.owner_id;
  end if;
  if new.contract_ends_on is null then new.notice_amount := null; new.notice_unit := null; end if;
  return new;
end; $function$;

drop trigger if exists bills_check on public.bills;
create trigger bills_check before insert or update on public.bills
  for each row execute function public.bills_check();

alter table public.bills enable row level security;
alter table public.bill_payments enable row level security;

drop policy if exists bills_read on public.bills;
drop policy if exists bills_insert on public.bills;
drop policy if exists bills_update on public.bills;
drop policy if exists bills_delete on public.bills;
create policy bills_read on public.bills for select
  using ((flat_id is not null and is_member(flat_id)) or owner_id = auth.uid());
create policy bills_insert on public.bills for insert
  with check ((flat_id is not null and owner_id is null and is_member(flat_id)) or (flat_id is null and owner_id = auth.uid()));
create policy bills_update on public.bills for update
  using ((flat_id is not null and is_member(flat_id)) or owner_id = auth.uid())
  with check ((flat_id is not null and is_member(flat_id)) or owner_id = auth.uid());
create policy bills_delete on public.bills for delete
  using ((flat_id is not null and is_member(flat_id)) or owner_id = auth.uid());

-- ticks are written by tick_bill only
drop policy if exists bill_payments_read on public.bill_payments;
create policy bill_payments_read on public.bill_payments for select
  using ((flat_id is not null and is_member(flat_id)) or owner_id = auth.uid());

-- Every bill you can see, with the one to act on: the oldest unpaid due date up to
-- today (looking back at most twelve) — so a missed one stays overdue until ticked —
-- or, when they are all paid, the next. And the latest tick, to show "Paid ✓ by Nina".
create or replace function public.my_bills()
returns table (bill_id uuid, due_on date, state text, paid_on date, paid_by uuid, paid_at timestamptz, cancel_by date)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare b bills; d date := heimat_today(); n integer; k integer; v_due date; p bill_payments;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  for b in select * from bills x
            where x.archived_at is null
              and ((x.flat_id is not null and is_member(x.flat_id)) or x.owner_id = auth.uid())
            order by x.created_at, x.id loop
    n := occurrence_on(b.anchor_on, b.cadence, d);
    bill_id := b.id; cancel_by := bill_cancel_by(b);
    select * into p from bill_payments x where x.bill_id = b.id order by x.due_on desc limit 1;
    paid_on := p.due_on; paid_by := p.paid_by; paid_at := p.paid_at;
    if n < 0 then
      due_on := b.anchor_on; state := case when p.due_on = b.anchor_on then 'paid' else 'upcoming' end;
      if state = 'paid' then due_on := recurring_occurrence(b.anchor_on, b.cadence, 1); end if;
      return next; continue;
    end if;
    v_due := null;
    for k in greatest(0, n - 11) .. n loop
      if not exists (select 1 from bill_payments x where x.bill_id = b.id
                       and x.due_on = recurring_occurrence(b.anchor_on, b.cadence, k)) then
        v_due := recurring_occurrence(b.anchor_on, b.cadence, k); exit;
      end if;
    end loop;
    if v_due is null then
      v_due := recurring_occurrence(b.anchor_on, b.cadence, n + 1);
      -- paid ahead of time: the next is already ticked too
      while exists (select 1 from bill_payments x where x.bill_id = b.id and x.due_on = v_due) loop
        n := n + 1; v_due := recurring_occurrence(b.anchor_on, b.cadence, n + 1);
      end loop;
      due_on := v_due; state := 'paid';
    else
      due_on := v_due; state := case when v_due = d then 'due' else 'overdue' end;
    end if;
    return next;
  end loop;
end; $function$;

-- Tick (or untick) one due date of a bill as paid. Any due date up to the next one
-- can be ticked — paying a little early is normal.
create or replace function public.tick_bill(p_bill uuid, p_due date, p_paid boolean default true)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare b bills; n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into b from bills where id = p_bill;
  -- (coalesce: a group's bill has no owner, and null must not count as yes)
  if b.id is null or not coalesce((b.flat_id is not null and is_member(b.flat_id)) or b.owner_id = auth.uid(), false) then
    raise exception using errcode = 'P0001', message = 'bills: that bill is not yours to tick', detail = '{"code": "not_yours"}';
  end if;
  n := occurrence_on(b.anchor_on, b.cadence, p_due);
  if n < 0 or recurring_occurrence(b.anchor_on, b.cadence, n) <> p_due
     or p_due > recurring_occurrence(b.anchor_on, b.cadence, greatest(occurrence_on(b.anchor_on, b.cadence, heimat_today()), -1) + 1) then
    raise exception using errcode = 'P0001', message = 'bills: that is not one of its due dates', detail = '{"code": "bad_date"}';
  end if;
  if p_paid then
    insert into bill_payments (bill_id, due_on, paid_by, flat_id, owner_id)
      values (b.id, p_due, auth.uid(), b.flat_id, b.owner_id)
      on conflict (bill_id, due_on) do nothing;
  else
    delete from bill_payments where bill_id = b.id and due_on = p_due;
  end if;
end; $function$;

-- ------------------------------------------------------------------ chores

create table if not exists public.chores (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  name text not null,
  cadence text not null default 'weekly' check (cadence in ('weekly', 'biweekly', 'monthly')),
  -- the first day of the first period
  anchor_on date not null check (anchor_on >= date '2000-01-01'),
  points smallint not null default 1 check (points between 1 and 3),
  -- who takes part, in turn order
  rota uuid[] not null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chores_flat on public.chores (flat_id);

create table if not exists public.chore_turns (
  chore_id uuid not null references public.chores(id) on delete cascade,
  -- the period's number (0 = the one starting on anchor_on)
  n integer not null check (n >= 0),
  flat_id uuid not null references public.flats(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  assignee uuid,
  state text not null default 'open' check (state in ('open', 'done', 'missed')),
  done_by uuid,
  done_at timestamptz,
  -- what it earned, kept as it was when done
  points smallint,
  primary key (chore_id, n)
);
create index if not exists chore_turns_flat on public.chore_turns (flat_id, done_at);

create table if not exists public.chore_swaps (
  id uuid primary key default gen_random_uuid(),
  chore_id uuid not null references public.chores(id) on delete cascade,
  n integer not null,
  flat_id uuid not null references public.flats(id) on delete cascade,
  from_user uuid not null,
  to_user uuid not null,
  created_at timestamptz not null default now(),
  answer text check (answer in ('accepted', 'declined', 'withdrawn')),
  answered_at timestamptz
);
create index if not exists chore_swaps_open on public.chore_swaps (chore_id, n) where answer is null;

create or replace function public.chores_check()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare u uuid; v_rota uuid[] := '{}';
begin
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' or length(new.name) > 60 then
    raise exception using errcode = 'P0001', message = 'chores: give it a name (up to 60 letters)', detail = '{"code": "bad_name"}';
  end if;
  if tg_op = 'UPDATE' and new.flat_id is distinct from old.flat_id then
    raise exception using errcode = 'P0001', message = 'chores: a chore stays in its group', detail = '{"code": "moved"}';
  end if;
  if (select kind from flats where id = new.flat_id) = 'direct' then
    raise exception using errcode = 'P0001', message = 'chores: chores belong to a group', detail = '{"code": "not_a_group"}';
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := now(); end if;
  -- once each, everyone in the group now; someone who has since left may stay in an
  -- older rota (they are passed over), but nobody new who isn't here
  foreach u in array coalesce(new.rota, '{}') loop
    continue when u is null or u = any(v_rota);
    if not is_current_member(new.flat_id, u)
       and not (tg_op = 'UPDATE' and u = any(old.rota)) then
      raise exception using errcode = 'P0001', message = 'chores: everyone on the rota must be in the group', detail = '{"code": "bad_rota"}';
    end if;
    v_rota := v_rota || u;
  end loop;
  if cardinality(v_rota) = 0 then
    raise exception using errcode = 'P0001', message = 'chores: choose who takes part', detail = '{"code": "empty_rota"}';
  end if;
  new.rota := v_rota;
  return new;
end; $function$;

drop trigger if exists chores_check on public.chores;
create trigger chores_check before insert or update on public.chores
  for each row execute function public.chores_check();

-- a changed rota, period or start: the turns not yet done are worked out again
create or replace function public.chores_changed()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.rota is distinct from old.rota or new.cadence <> old.cadence or new.anchor_on <> old.anchor_on
     or (new.archived_at is not null and old.archived_at is null) then
    update chore_swaps set answer = 'withdrawn', answered_at = now() where chore_id = new.id and answer is null;
    delete from chore_turns where chore_id = new.id and state = 'open';
  end if;
  return new;
end; $function$;

drop trigger if exists chores_changed on public.chores;
create trigger chores_changed after update on public.chores
  for each row execute function public.chores_changed();

-- whose turn period n is by the rota, passing over anyone who has left
create or replace function public.chore_default(c public.chores, p_n integer)
returns uuid
language sql stable security definer set search_path to 'public'
as $function$
  with live as (
    select u, row_number() over (order by o) - 1 as i, count(*) over () as cnt
      from unnest(c.rota) with ordinality t(u, o) where is_current_member(c.flat_id, u)
  )
  select u from live where i = p_n % cnt
$function$;

-- Bring a chore's turns up to today: earlier open turns are missed; the current and
-- the next period are written down; a turn whose person has left goes by the rota.
create or replace function public.chore_ensure(p_chore uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare c chores; d date := heimat_today(); v_n integer; k integer;
begin
  select * into c from chores where id = p_chore;
  if c.id is null or c.archived_at is not null then return null; end if;
  v_n := occurrence_on(c.anchor_on, c.cadence, d);
  update chore_turns set state = 'missed' where chore_id = c.id and state = 'open' and ends_on < d;
  update chore_swaps s set answer = 'withdrawn', answered_at = now()
    where s.chore_id = c.id and s.answer is null
      and not exists (select 1 from chore_turns t where t.chore_id = s.chore_id and t.n = s.n and t.state = 'open');
  if v_n < 0 then v_n := 0; end if;
  for k in v_n .. v_n + 1 loop
    insert into chore_turns (chore_id, n, flat_id, starts_on, ends_on, assignee)
      values (c.id, k, c.flat_id, recurring_occurrence(c.anchor_on, c.cadence, k),
              recurring_occurrence(c.anchor_on, c.cadence, k + 1) - 1, chore_default(c, k))
      on conflict (chore_id, n) do nothing;
  end loop;
  update chore_turns t set assignee = chore_default(c, t.n)
    where t.chore_id = c.id and t.state = 'open' and t.n >= v_n
      and (t.assignee is null or not is_current_member(c.flat_id, t.assignee));
  return v_n;
end; $function$;

-- The chores of every group you are in: this period's turn and the next.
create or replace function public.my_chores()
returns setof public.chore_turns
language plpgsql security definer set search_path to 'public'
as $function$
declare c uuid; v_n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  for c in select x.id from chores x where x.archived_at is null and is_member(x.flat_id) order by x.created_at, x.id loop
    v_n := chore_ensure(c);
    return query select * from chore_turns t where t.chore_id = c and t.n in (v_n, v_n + 1) order by t.n;
  end loop;
end; $function$;

create or replace function public.chore_turn_for(p_chore uuid, p_n integer)
returns chore_turns
language plpgsql security definer set search_path to 'public'
as $function$
declare c chores; t chore_turns; v_n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from chores where id = p_chore;
  if c.id is null or c.archived_at is not null or not is_member(c.flat_id) then
    raise exception using errcode = 'P0001', message = 'chores: that chore is not in your group', detail = '{"code": "not_yours"}';
  end if;
  v_n := chore_ensure(c.id);
  select * into t from chore_turns where chore_id = c.id and chore_turns.n = p_n;
  if t.chore_id is null or p_n not in (v_n, v_n + 1) then
    raise exception using errcode = 'P0001', message = 'chores: that turn is over or not here yet', detail = '{"code": "bad_turn"}';
  end if;
  return t;
end; $function$;

-- Done (or not, after all). Whoever ticks it did it and earns its points. Only this
-- period's turn — the next one starts when it starts.
create or replace function public.chore_tick(p_chore uuid, p_n integer, p_done boolean default true)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare t chore_turns; v_pts smallint;
begin
  t := chore_turn_for(p_chore, p_n);
  if t.starts_on > heimat_today() then
    raise exception using errcode = 'P0001', message = 'chores: that turn hasn''t started yet', detail = '{"code": "not_started"}';
  end if;
  select points into v_pts from chores where id = p_chore;
  if p_done then
    update chore_turns set state = 'done', done_by = auth.uid(), done_at = now(), points = v_pts
      where chore_id = p_chore and n = p_n and state = 'open';
    update chore_swaps set answer = 'withdrawn', answered_at = now() where chore_id = p_chore and n = p_n and answer is null;
  else
    update chore_turns set state = 'open', done_by = null, done_at = null, points = null
      where chore_id = p_chore and n = p_n and state = 'done';
  end if;
end; $function$;

-- Skip: this period's turn goes to whoever has the next one, and the next one is
-- yours — so your turn comes back to you straight after.
create or replace function public.chore_skip(p_chore uuid, p_n integer)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare t chore_turns; nx chore_turns;
begin
  t := chore_turn_for(p_chore, p_n);
  if t.assignee is distinct from auth.uid() or t.state <> 'open' then
    raise exception using errcode = 'P0001', message = 'chores: only an open turn of yours can be skipped', detail = '{"code": "not_your_turn"}';
  end if;
  select * into nx from chore_turns where chore_id = p_chore and n = p_n + 1;
  if nx.chore_id is null or nx.state <> 'open' or nx.assignee is null or nx.assignee = auth.uid() then
    raise exception using errcode = 'P0001', message = 'chores: there is nobody to pass it to', detail = '{"code": "nobody_next"}';
  end if;
  update chore_turns set assignee = nx.assignee where chore_id = p_chore and n = p_n;
  update chore_turns set assignee = auth.uid() where chore_id = p_chore and n = p_n + 1;
  update chore_swaps set answer = 'withdrawn', answered_at = now()
    where chore_id = p_chore and n in (p_n, p_n + 1) and answer is null;
  perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', t.flat_id, 'to_user', nx.assignee,
    'title', (select name from chores where id = p_chore),
    'message', coalesce((select display_name from flat_members where flat_id = t.flat_id and user_id = auth.uid()), 'A flatmate')
               || ' skipped this turn — it''s yours now, and theirs next time'));
end; $function$;

-- Ask someone to take your turn (this period's or the next). It changes only when they say yes.
create or replace function public.chore_swap_ask(p_chore uuid, p_n integer, p_to uuid)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare t chore_turns; v_id uuid;
begin
  t := chore_turn_for(p_chore, p_n);
  if t.assignee is distinct from auth.uid() or t.state <> 'open' then
    raise exception using errcode = 'P0001', message = 'chores: only an open turn of yours can be swapped', detail = '{"code": "not_your_turn"}';
  end if;
  if p_to is null or p_to = auth.uid() or not is_current_member(t.flat_id, p_to) then
    raise exception using errcode = 'P0001', message = 'chores: ask someone in the group', detail = '{"code": "bad_person"}';
  end if;
  update chore_swaps set answer = 'withdrawn', answered_at = now() where chore_id = p_chore and n = p_n and answer is null;
  insert into chore_swaps (chore_id, n, flat_id, from_user, to_user) values (p_chore, p_n, t.flat_id, auth.uid(), p_to)
    returning id into v_id;
  perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', t.flat_id, 'to_user', p_to,
    'title', (select name from chores where id = p_chore),
    'message', coalesce((select display_name from flat_members where flat_id = t.flat_id and user_id = auth.uid()), 'A flatmate')
               || ' asks if you can take their turn'
               || case when t.starts_on > heimat_today() then ' next time' else '' end));
  return v_id;
end; $function$;

create or replace function public.chore_swap_answer(p_swap uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare s chore_swaps; t chore_turns;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into s from chore_swaps where id = p_swap;
  if s.id is null or s.to_user <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'chores: that request isn''t for you', detail = '{"code": "not_yours"}';
  end if;
  perform chore_ensure(s.chore_id);
  select * into s from chore_swaps where id = p_swap;
  if s.answer is not null then
    raise exception using errcode = 'P0001', message = 'chores: that request has already been answered', detail = '{"code": "answered"}';
  end if;
  select * into t from chore_turns where chore_id = s.chore_id and n = s.n;
  if p_accept and (t.state <> 'open' or t.assignee is distinct from s.from_user) then
    update chore_swaps set answer = 'withdrawn', answered_at = now() where id = s.id;
    raise exception using errcode = 'P0001', message = 'chores: that turn has changed since they asked', detail = '{"code": "changed"}';
  end if;
  update chore_swaps set answer = case when p_accept then 'accepted' else 'declined' end, answered_at = now() where id = s.id;
  if p_accept then
    update chore_turns set assignee = auth.uid() where chore_id = s.chore_id and n = s.n;
  end if;
  perform push_notify(jsonb_build_object('event', 'reminder', 'flat_id', s.flat_id, 'to_user', s.from_user,
    'title', (select name from chores where id = s.chore_id),
    'message', coalesce((select display_name from flat_members where flat_id = s.flat_id and user_id = auth.uid()), 'A flatmate')
               || case when p_accept then ' will take your turn' else ' can''t take your turn this time' end));
end; $function$;

alter table public.chores enable row level security;
alter table public.chore_turns enable row level security;
alter table public.chore_swaps enable row level security;

drop policy if exists chores_read on public.chores;
drop policy if exists chores_insert on public.chores;
drop policy if exists chores_update on public.chores;
drop policy if exists chores_delete on public.chores;
create policy chores_read on public.chores for select using (is_member(flat_id));
create policy chores_insert on public.chores for insert with check (is_member(flat_id));
create policy chores_update on public.chores for update using (is_member(flat_id)) with check (is_member(flat_id));
create policy chores_delete on public.chores for delete using (is_member(flat_id));
-- turns and swaps change through the functions above only
drop policy if exists chore_turns_read on public.chore_turns;
create policy chore_turns_read on public.chore_turns for select using (is_member(flat_id));
drop policy if exists chore_swaps_read on public.chore_swaps;
create policy chore_swaps_read on public.chore_swaps for select using (is_member(flat_id));

-- ------------------------------------------------------------------ reminders

create table if not exists public.reminders_sent (
  ref uuid not null,
  on_date date not null,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (ref, on_date, kind)
);
alter table public.reminders_sent enable row level security;

-- once: true the first time (ref, day, kind) is seen
create or replace function public.remind_once(p_ref uuid, p_on date, p_kind text)
returns boolean
language plpgsql security definer set search_path to 'public'
as $function$
declare v integer;
begin
  insert into reminders_sent (ref, on_date, kind) values (p_ref, p_on, p_kind) on conflict do nothing;
  get diagnostics v = row_count;
  return v = 1;
end; $function$;

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
        'message', case c.cadence when 'weekly' then 'This week' when 'biweekly' then 'These two weeks' else 'This month' end
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

-- ------------------------------------------------------------------ access

revoke all on function public.heimat_today()                           from public, anon;
revoke all on function public.occurrence_on(date, text, date)          from public, anon, authenticated;
revoke all on function public.bill_cancel_by(public.bills)             from public, anon, authenticated;
revoke all on function public.is_current_member(uuid, uuid)            from public, anon, authenticated;
revoke all on function public.bills_check()                            from public, anon, authenticated;
revoke all on function public.chores_check()                           from public, anon, authenticated;
revoke all on function public.chores_changed()                         from public, anon, authenticated;
revoke all on function public.chore_default(public.chores, integer)    from public, anon, authenticated;
revoke all on function public.chore_ensure(uuid)                       from public, anon, authenticated;
revoke all on function public.chore_turn_for(uuid, integer)            from public, anon, authenticated;
revoke all on function public.remind_once(uuid, date, text)            from public, anon, authenticated;
revoke all on function public.run_reminders()                          from public, anon, authenticated;
revoke all on function public.my_bills()                               from public, anon;
revoke all on function public.tick_bill(uuid, date, boolean)           from public, anon;
revoke all on function public.my_chores()                              from public, anon;
revoke all on function public.chore_tick(uuid, integer, boolean)       from public, anon;
revoke all on function public.chore_skip(uuid, integer)                from public, anon;
revoke all on function public.chore_swap_ask(uuid, integer, uuid)      from public, anon;
revoke all on function public.chore_swap_answer(uuid, boolean)         from public, anon;
grant execute on function public.heimat_today()                        to authenticated;
grant execute on function public.my_bills()                            to authenticated;
grant execute on function public.tick_bill(uuid, date, boolean)        to authenticated;
grant execute on function public.my_chores()                           to authenticated;
grant execute on function public.chore_tick(uuid, integer, boolean)    to authenticated;
grant execute on function public.chore_skip(uuid, integer)             to authenticated;
grant execute on function public.chore_swap_ask(uuid, integer, uuid)   to authenticated;
grant execute on function public.chore_swap_answer(uuid, boolean)      to authenticated;
revoke all on table public.reminders_sent from anon, authenticated;
revoke insert, update, delete on table public.bill_payments, public.chore_turns, public.chore_swaps from anon, authenticated;

-- live on every phone
do $pub$
declare t text;
begin
  foreach t in array array['bills', 'bill_payments', 'chores', 'chore_turns', 'chore_swaps'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $pub$;

-- hourly; run_reminders itself waits for nine o'clock, Berlin time
select cron.unschedule('heimat-reminders') where exists (select 1 from cron.job where jobname = 'heimat-reminders');
select cron.schedule('heimat-reminders', '10 * * * *', 'select public.run_reminders()');
