/*
  The "cancel by" day the bill form shows must be the day the database reminds
  about (bill_cancel_by in supabase/migrations/20261002000000_bills_and_chores.sql).
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cancelByOf } from '../src/lib/cancelBy.ts'

test('cancel by: the end, less the notice — as Postgres counts it', () => {
  assert.equal(cancelByOf('2027-03-31', 3, 'month'), '2026-12-31')
  assert.equal(cancelByOf('2026-06-30', 2, 'week'), '2026-06-16')
  assert.equal(cancelByOf('2027-05-31', 3, 'month'), '2027-02-28')   // no 31 February: the month's last day
  assert.equal(cancelByOf('2028-05-31', 3, 'month'), '2028-02-29')   // a leap year
  assert.equal(cancelByOf('2027-01-15', 1, 'month'), '2026-12-15')   // across the year
})
