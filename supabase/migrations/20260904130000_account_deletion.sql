-- Deleting a user must not take the flat's shared history with it, and must not
-- be blocked by it either. Every column that merely records "who did this" is
-- made nullable and set to null when the user goes; flat membership is deleted
-- outright by the delete-account function before the user row is removed.
alter table public.expenses         alter column created_by drop not null;
alter table public.settlements      alter column created_by drop not null;
alter table public.flat_categories  alter column created_by drop not null;
alter table public.flat_items       alter column added_by   drop not null;
alter table public.flats            alter column created_by drop not null;

alter table public.expenses drop constraint if exists expenses_created_by_fkey;
alter table public.expenses add constraint expenses_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.settlements drop constraint if exists settlements_created_by_fkey;
alter table public.settlements add constraint settlements_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.flat_categories drop constraint if exists flat_categories_created_by_fkey;
alter table public.flat_categories add constraint flat_categories_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.flat_items drop constraint if exists flat_items_added_by_fkey;
alter table public.flat_items add constraint flat_items_added_by_fkey
  foreign key (added_by) references auth.users(id) on delete set null;

alter table public.flat_items drop constraint if exists flat_items_bought_by_fkey;
alter table public.flat_items add constraint flat_items_bought_by_fkey
  foreign key (bought_by) references auth.users(id) on delete set null;

alter table public.flats drop constraint if exists flats_created_by_fkey;
alter table public.flats add constraint flats_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
