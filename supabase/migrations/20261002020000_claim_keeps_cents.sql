-- Taking over a place keeps every share cent for cent (docs/money-engine.md, "People
-- joining and leaving"). Until now an equal or adjusted split was worked out again when
-- an invite was taken over, and the odd cent of each bill goes by account id — so a
-- new account could gain or lose a few cents (Dhruv, invited back on 2026-10-01: 49,82 €
-- became 49,80 €, the 2 cents moving to others in the group; the group still summed to 0).
--
--  * claim_member renames the stored shares for every split type (a merge — the account
--    already on the same expense — is still worked out again, as before);
--  * expense_postings accepts such a rename for equal and adjusted splits too, when it is
--    the server's own rewrite (heimat.internal) and the figures still add up to the bill.

create or replace function public.claim_member(p_member uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare m flat_members; existing_id uuid; f text; t text; came_back boolean := false;
begin
  select * into m from flat_members where id = p_member;
  -- an invite someone was removed from (kept as left for its history) is dead
  if m.id is null or m.claimed_at is not null or m.left_at is not null or p_uid is null then return; end if;
  f := m.user_id::text; t := p_uid::text;
  -- (a function's own SET clause can't carry a custom setting on Supabase; if anything
  -- below fails, rolling back restores it, and on success it is cleared at the end)
  perform set_config('heimat.internal', 'on', true);

  select id into existing_id from flat_members
    where flat_id = m.flat_id and user_id = p_uid and id <> m.id limit 1;
  -- the member row first, so they are in the flat by the time their expenses name them
  if existing_id is not null then
    -- already here (or here before, and invited back): one row for them, and they are back
    update flat_members set left_at = null where id = existing_id and left_at is not null;
    came_back := found;   -- log_member records that as 'joined'
  else
    update flat_members set user_id = p_uid, claimed_at = now() where id = m.id;
  end if;

  update expenses e set
      paid_by = case when e.paid_by = m.user_id then p_uid else e.paid_by end,
      split_among = array(select distinct x from unnest(array_replace(e.split_among, m.user_id, p_uid)) x),
      payers = rekey_uid(e.payers, f, t),
      split = rekey_split(e.split, f, t),
      -- the same cents under the new name — unless two people become one (both were on it),
      -- or it is an equal/adjust split: then expense_postings splits it again
      -- renamed, cent for cent, whatever the split type; only when the account was
      -- already on the expense too (a merge) is it worked out again
      shares = case when coalesce(e.shares, '{}') ? f and coalesce(e.shares, '{}') ? t
                    then e.shares else rekey_uid(e.shares, f, t) end
    where e.flat_id = m.flat_id
      and (e.paid_by = m.user_id or m.user_id = any(e.split_among)
           or coalesce(e.payers, '{}') ? f or coalesce(e.shares, '{}') ? f
           or position(f in coalesce(e.split::text, '')) > 0);
  update recurring_expenses r set
      paid_by = case when r.paid_by = m.user_id then p_uid else r.paid_by end,
      split_among = array(select distinct x from unnest(array_replace(r.split_among, m.user_id, p_uid)) x),
      payers = rekey_uid(r.payers, f, t),
      split = rekey_split(r.split, f, t)
    where r.flat_id = m.flat_id
      and (r.paid_by = m.user_id or m.user_id = any(r.split_among)
           or position(f in coalesce(r.payers::text, '') || coalesce(r.split::text, '')) > 0);
  update flats set default_split = rekey_split(default_split, f, t)
    where id = m.flat_id and position(f in coalesce(default_split::text, '')) > 0;
  -- a payment between the placeholder and the same person would be a payment to themselves:
  -- it moved no money between two people, so it goes (quietly: this is internal)
  delete from settlements where flat_id = m.flat_id
    and ((from_user = m.user_id and to_user = p_uid) or (from_user = p_uid and to_user = m.user_id));
  update settlements set from_user = p_uid where flat_id = m.flat_id and from_user = m.user_id;
  update settlements set to_user   = p_uid where flat_id = m.flat_id and to_user   = m.user_id;
  update flat_items  set added_by  = p_uid where flat_id = m.flat_id and added_by  = m.user_id;
  update flat_items  set bought_by = p_uid where flat_id = m.flat_id and bought_by = m.user_id;

  if existing_id is not null then
    delete from flat_members where id = m.id;   -- not logged as a withdrawn invite (internal)
    if not came_back then
      perform log(m.flat_id, p_uid, 'joined', (select display_name from flat_members where id = existing_id), null,
                  jsonb_build_object('who', p_uid));
    end if;
  end if;
  perform set_config('heimat.internal', '', true);
end; $function$;

create or replace function public.expense_postings()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v2 boolean;
  internal boolean := coalesce(current_setting('heimat.internal', true), '') = 'on';
  prev text[] := '{}';
  stray text;
begin
  v2 := coalesce(current_setting('heimat.v2_write', true), '') = new.id::text;
  perform set_config('heimat.v2_write', '', true);   -- read once; never carried over to another row

  new.split_type := coalesce(new.split_type, 'equal');
  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), flat_currency(new.flat_id), 'EUR'));
  -- stored to the currency's decimals, so every app's double reads back exactly what the server split
  new.amount := round(new.amount, minor_digits(new.currency));

  -- an app from before engine v2 editing an expense it cannot represent
  if tg_op = 'UPDATE' and not v2 and (
       -- a split it can't see: a changed set of people (in any order — Build 8 sends a Set),
       -- or a new total for a split made of fixed amounts
       (new.split_type <> 'equal' and new.split is not distinct from old.split
        and (array(select distinct u from unnest(new.split_among) u order by u)
               is distinct from array(select distinct u from unnest(old.split_among) u order by u)
             or (new.amount is distinct from old.amount and new.split_type in ('exact', 'adjust', 'itemized'))))
       -- several payers it can't see: a new payer or amount would be ignored, or no longer add up
    or (old.payers is not null and new.payers is not distinct from old.payers
        and (new.paid_by is distinct from old.paid_by or new.amount is distinct from old.amount))) then
    raise exception using errcode = 'P0001', message = 'update Heimat to edit this expense',
      detail = '{"code": "update_required"}';
  end if;

  -- "everyone in the flat" from an app that lists people who have left (Build 8's Siri
  -- shortcut does): they are no longer in the flat, so they are not in a new equal split
  if tg_op = 'INSERT' and new.split_type = 'equal' and not internal then
    new.split_among := array(select u from unnest(new.split_among) u
                             where not exists (select 1 from flat_members m
                                               where m.flat_id = new.flat_id and m.user_id = u and m.left_at is not null));
  end if;

  new.split := case when new.split_type = 'equal' then null else norm_split(new.split) end;
  new.payers := norm_payers(new.amount, new.currency, new.paid_by, new.payers);
  -- a server-side rewrite that only renamed someone (an invite taken over, a place
  -- invited back) keeps the stored figures cent for cent, for every split type: equal
  -- splits too, or the odd cent would move between people just because a new account
  -- id sorts differently. The apps read stored shares when they add up.
  if not (internal and tg_op = 'UPDATE'
          and new.shares is distinct from old.shares
          and coalesce((select bool_and(jint(value) is not null) and sum(jint(value)) = to_minor(new.amount, new.currency)
                        from jsonb_each(case when jsonb_typeof(new.shares) = 'object' then new.shares else '{}' end)), false)) then
    new.shares := split_shares(new.id, new.amount, new.currency, new.paid_by, new.split_among, new.split_type, new.split);
  end if;
  if new.split_type in ('exact', 'percent', 'shares', 'itemized') then
    -- who is in it, for everything that reads split_among (older apps, notifications);
    -- equal and adjust take split_among as their input, so it is left alone
    select coalesce(array_agg(key::uuid order by key), '{}') into new.split_among
      from jsonb_each(new.shares) where value::text::numeric <> 0;
  end if;

  -- money can only be booked to people in the flat: anyone named — who paid, a payer,
  -- anyone in the split — must be a current member (or pending invitee). Someone already
  -- on the expense who has left since may stay on it, but an edit can't make them owe
  -- more or change what they paid.
  if not internal then
    if tg_op = 'UPDATE' then
      prev := array[old.paid_by::text] || old.split_among::text[]
           || array(select jsonb_object_keys(case when jsonb_typeof(old.shares) = 'object' then old.shares else '{}' end))
           || array(select jsonb_object_keys(case when jsonb_typeof(old.payers) = 'object' then old.payers else '{}' end));
    end if;
    select z.u into stray
      from (select jsonb_object_keys(new.shares) as u
            union select jsonb_object_keys(coalesce(new.payers, '{}'))
            union select x::text from unnest(new.split_among) x
            union select new.paid_by::text) z
      where not exists (select 1 from flat_members m
                        where m.flat_id = new.flat_id and m.user_id::text = z.u and m.left_at is null)
        and (not (z.u = any(prev))
             or abs(coalesce(jint(new.shares -> z.u), 0))
                  > abs(coalesce(jint(case when jsonb_typeof(old.shares) = 'object' then old.shares -> z.u end), 0))
             or (case when new.payers is not null then coalesce(jint(new.payers -> z.u), 0)
                      when new.paid_by::text = z.u then to_minor(new.amount, new.currency) else 0 end)
                <> (case when jsonb_typeof(old.payers) = 'object' then coalesce(jint(old.payers -> z.u), 0)
                         when old.paid_by::text = z.u then to_minor(old.amount, old.currency) else 0 end))
      limit 1;
    if stray is not null then perform split_error('not_in_flat', null, stray); end if;
  end if;
  return new;
end; $function$;
