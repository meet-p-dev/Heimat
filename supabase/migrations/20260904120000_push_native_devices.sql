-- push_subscriptions now holds native device tokens as well as web-push
-- subscriptions. A native row's endpoint is 'apns:<token>' or 'fcm:<token>' and
-- carries no encryption keys, so p256dh/auth become nullable; `platform` records
-- which transport the row speaks so it can be counted and cleaned up per device.
alter table public.push_subscriptions
  add column if not exists platform text not null default 'web';

alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth  drop not null;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check check (platform in ('web', 'ios', 'android'));
