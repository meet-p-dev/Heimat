-- Tell the push function who actually paid, so it can notify the people in an
-- expense rather than the whole flat.
--
-- The payload carried split_among but not paid_by, so the function had no way
-- to tell that the payer belongs in the conversation even when the split does
-- not include them. It notified everyone instead, and non-participants got a
-- message with no share attached to it.
create or replace function public.on_expense_insert()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform push_notify(jsonb_build_object(
    'event', 'expense_added',
    'flat_id', new.flat_id,
    'actor', new.created_by,
    'amount', new.amount,
    'description', coalesce(nullif(new.description, ''), 'New shared expense'),
    'paid_by', new.paid_by,
    'split_among', to_jsonb(new.split_among)
  ));
  return new;
end;
$function$;
