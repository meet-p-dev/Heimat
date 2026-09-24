-- Only people in a flat can ask what someone is up or down there.
--
-- flat_balance() is SECURITY DEFINER, so it reads every flat's expenses, and
-- it is granted to `authenticated` because nudge() and remove_member() call it.
-- But it never asked who was calling: anyone signed in who knew a flat's id
-- and a person's id could read that person's balance through
-- /rest/v1/rpc/flat_balance. Both of its callers already check membership
-- first, so the same check here changes nothing for them.
--
-- It raises rather than returning null, because the callers compare the
-- result: `abs(null) > 0.5` is null, which remove_member would read as "square
-- up, go ahead".
--
-- A call with no user at all is let through — that is the database itself
-- (triggers, the SQL editor, the service role). The anon role cannot reach it:
-- it has no EXECUTE on this function (restated at the bottom).
create or replace function public.flat_balance(p_flat uuid, p_uid uuid)
returns numeric
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not is_member(p_flat) then
    raise exception 'Not your flat';
  end if;
  -- the same whole-cent maths as migration 20260924030000_ledger_cents
  return (
    with cur as (select public.flat_currency(p_flat) as c),
    e as (
      select x.id, x.amount, x.paid_by, x.split_among
      from expenses x, cur
      where x.flat_id = p_flat
        and (coalesce(x.currency, '') = '' or cur.c is null or x.currency = cur.c)
    )
    select round((
        coalesce((select sum(round(amount * 100)::bigint) from e where paid_by = p_uid), 0)
      - coalesce((select sum(s.cents) from e, lateral public.expense_shares(e.id, e.amount, e.paid_by, e.split_among) s
                  where s.user_id = p_uid), 0)
      + coalesce((select sum(round(amount * 100)::bigint) from settlements where flat_id = p_flat and from_user = p_uid), 0)
      - coalesce((select sum(round(amount * 100)::bigint) from settlements where flat_id = p_flat and to_user = p_uid), 0)
    ) / 100.0, 2)
  );
end;
$function$;

revoke all on function public.flat_balance(uuid, uuid) from public, anon;
grant execute on function public.flat_balance(uuid, uuid) to authenticated;
