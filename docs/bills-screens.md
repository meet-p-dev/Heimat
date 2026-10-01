# Bills — the screens

Agreed with the owner on 2026-10-01. Built for iOS and the web together.

## What a bill is

Something paid again and again: rent, electricity, internet, phone, insurance, gym.
A bill has a name, an amount, how often (monthly by default; also weekly, every
3 months, yearly), the due day, and **who pays it** (one person).

Optionally a bill is also a **contract** that renews itself unless cancelled in time:
the date it ends and the notice period ("1 month", "3 months"). Splitlife works out
the last day to cancel and reminds before it. Rent and the like simply skip this.

No deposit in the first version.

## Where bills live

- **Shared bills belong to a group.** Each group has its own bills. The group's card
  shows the next one ("Rent due in 3 days", or "Internet overdue") and the group's
  page has a **Bills** section: this period's bills with a tick circle each.
- **Personal bills** (your own phone, insurance, gym) live in a **My bills** card on
  the Groups tab, next to Non-group expenses, seen only by you. Same reminders and ticks.

## Reminders and ticks

- Each bill comes back every period like a to-do.
- On the due day **the person who pays it** gets a notification: "Pay rent today".
  Everyone else just sees it in the list.
- Whoever paid **ticks it**. Everyone in the group then sees "Paid ✓ by Nina · 1 Oct".
  A tick only marks it paid; it adds no expense and changes no balance. A tick can be undone.
- Not ticked after the due day: it shows as overdue until ticked.
- Contracts: a reminder four weeks and one week before the last day to cancel.

## Not in it (for now)

Deposits, splitting a bill by ticking it, attachments or documents.
