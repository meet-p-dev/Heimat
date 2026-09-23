-- What happened, who did it, and when.
--
-- Additions were always recoverable from created_by and created_at, but an
-- edit overwrote the thing it changed and a deletion took the whole row with
-- it — and those are exactly what you go looking for when the numbers stop
-- matching what you remember. So every change writes a line here.
--
-- Written by triggers rather than by the app, so it cannot be skipped by a
-- client that forgets, or by the widget, or by an App Intent. Read-only to
-- everyone: there is no point in a history that can be edited.

create table if not exists public.activity (
  id       uuid primary key default gen_random_uuid(),
  flat_id  uuid not null references public.flats(id) on delete cascade,
  actor    uuid,                 -- null when nobody was signed in, or backfilled
  kind     text not null,
  subject  text,                 -- the expense's description, or a person's name
  amount   numeric,
  at       timestamptz not null default now(),
  meta     jsonb not null default '{}'::jsonb
);

create index if not exists activity_flat_at on public.activity (flat_id, at desc);

alter table public.activity enable row level security;
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select using (is_member(flat_id));

create or replace function public.log(p_flat uuid, p_actor uuid, p_kind text,
                                      p_subject text, p_amount numeric, p_meta jsonb)
returns void
language sql security definer set search_path to 'public'
as $function$
  insert into activity(flat_id, actor, kind, subject, amount, meta)
  values (p_flat, p_actor, p_kind, nullif(p_subject, ''), p_amount, coalesce(p_meta, '{}'::jsonb));
$function$;

-- expenses ------------------------------------------------------------------

create or replace function public.log_expense()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform log(new.flat_id, new.created_by, 'expense_added', new.description, new.amount,
                jsonb_build_object('expense', new.id, 'paid_by', new.paid_by));
    return new;
  elsif tg_op = 'UPDATE' then
    -- only the things a person would notice; touching a row is not an edit
    if new.amount is distinct from old.amount
       or new.description is distinct from old.description
       or new.paid_by is distinct from old.paid_by
       or new.split_among is distinct from old.split_among
       or new.spent_on is distinct from old.spent_on
       or new.category is distinct from old.category then
      perform log(new.flat_id, auth.uid(), 'expense_edited', new.description, new.amount,
                  jsonb_build_object('expense', new.id, 'was_amount', old.amount,
                                     'was_description', old.description));
    end if;
    return new;
  else
    perform log(old.flat_id, auth.uid(), 'expense_deleted', old.description, old.amount,
                jsonb_build_object('expense', old.id));
    return old;
  end if;
end; $function$;

drop trigger if exists log_expense_ins on public.expenses;
drop trigger if exists log_expense_upd on public.expenses;
drop trigger if exists log_expense_del on public.expenses;
create trigger log_expense_ins after insert on public.expenses for each row execute function public.log_expense();
create trigger log_expense_upd after update on public.expenses for each row execute function public.log_expense();
create trigger log_expense_del after delete on public.expenses for each row execute function public.log_expense();

-- settlements ---------------------------------------------------------------

create or replace function public.log_settlement()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform log(new.flat_id, coalesce(new.created_by, new.from_user), 'settled',
                (select display_name from flat_members where flat_id = new.flat_id and user_id = new.to_user),
                new.amount, jsonb_build_object('from', new.from_user, 'to', new.to_user));
    return new;
  end if;
  perform log(old.flat_id, auth.uid(), 'settle_undone',
              (select display_name from flat_members where flat_id = old.flat_id and user_id = old.to_user),
              old.amount, jsonb_build_object('from', old.from_user, 'to', old.to_user));
  return old;
end; $function$;

drop trigger if exists log_settlement_ins on public.settlements;
drop trigger if exists log_settlement_del on public.settlements;
create trigger log_settlement_ins after insert on public.settlements for each row execute function public.log_settlement();
create trigger log_settlement_del after delete on public.settlements for each row execute function public.log_settlement();

-- people --------------------------------------------------------------------

create or replace function public.log_member()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform log(new.flat_id, coalesce(new.invited_by, new.user_id),
                case when new.invite_email is not null and new.claimed_at is null then 'invited' else 'joined' end,
                new.display_name, null, jsonb_build_object('who', new.user_id));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.left_at is null and new.left_at is not null then
      perform log(new.flat_id, auth.uid(), 'left', new.display_name, null,
                  jsonb_build_object('who', new.user_id));
    elsif old.claimed_at is null and new.claimed_at is not null then
      perform log(new.flat_id, new.user_id, 'joined', new.display_name, null,
                  jsonb_build_object('who', new.user_id));
    end if;
    return new;
  else
    perform log(old.flat_id, auth.uid(),
                case when old.claimed_at is null then 'invite_withdrawn' else 'left' end,
                old.display_name, null, jsonb_build_object('who', old.user_id));
    return old;
  end if;
end; $function$;

drop trigger if exists log_member_ins on public.flat_members;
drop trigger if exists log_member_upd on public.flat_members;
drop trigger if exists log_member_del on public.flat_members;
create trigger log_member_ins after insert on public.flat_members for each row execute function public.log_member();
create trigger log_member_upd after update on public.flat_members for each row execute function public.log_member();
create trigger log_member_del after delete on public.flat_members for each row execute function public.log_member();

-- the past ------------------------------------------------------------------
--
-- Everything already stored, so the feed is not empty on the day it ships.
-- Only additions can be recovered — an edit or a deletion before today left
-- nothing behind to find — so this is honest about being additions only.

insert into public.activity (flat_id, actor, kind, subject, amount, at, meta)
select e.flat_id, e.created_by, 'expense_added', nullif(e.description,''), e.amount, e.created_at,
       jsonb_build_object('expense', e.id, 'paid_by', e.paid_by, 'backfilled', true)
from public.expenses e
where not exists (select 1 from public.activity a where a.meta->>'expense' = e.id::text);

insert into public.activity (flat_id, actor, kind, subject, amount, at, meta)
select s.flat_id, coalesce(s.created_by, s.from_user), 'settled',
       (select display_name from public.flat_members m where m.flat_id = s.flat_id and m.user_id = s.to_user),
       s.amount, s.created_at,
       jsonb_build_object('from', s.from_user, 'to', s.to_user, 'backfilled', true)
from public.settlements s;

insert into public.activity (flat_id, actor, kind, subject, amount, at, meta)
select m.flat_id, m.user_id, 'joined', m.display_name, null, m.joined_at,
       jsonb_build_object('who', m.user_id, 'backfilled', true)
from public.flat_members m
where not exists (
  select 1 from public.activity a
  where a.flat_id = m.flat_id and a.kind = 'joined' and a.meta->>'who' = m.user_id::text);

revoke all on function public.log(uuid, uuid, text, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.log_expense()    from public, anon, authenticated;
revoke all on function public.log_settlement() from public, anon, authenticated;
revoke all on function public.log_member()     from public, anon, authenticated;
