-- Whether the invite email actually went.
--
-- The send happens after the fact — a trigger posts to an edge function, which
-- returns 200 whatever happens so that a refused email can never roll back the
-- invite that caused it. Which left the app announcing "we've emailed them"
-- with no idea whether anything had been emailed to anyone; it said exactly
-- that while Resend was refusing every recipient with a 403.
--
-- So the function writes the outcome back here, and the app reports what
-- happened rather than what it hoped. Realtime is already subscribed to
-- flat_members, so the row arrives on its own a second later.
alter table public.flat_members
  add column if not exists invite_sent_at timestamptz,
  add column if not exists invite_error   text;
