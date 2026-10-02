/*
  Bringing shifts in (src/lib/importShifts.ts). The iPhone app
  (ios-native/Heimat/ShiftImport.swift) is held to the same vectors by
  scripts/test-ledger-swift.sh.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { importShifts, normDate, normNum, normTime } from '../src/lib/importShifts.ts'

const v = JSON.parse(readFileSync(new URL('./shift-import-vectors.json', import.meta.url), 'utf8'))

test('every kind of file gives the checked answer', () => {
  for (const c of v.cases) assert.deepEqual(importShifts(c.text, v.have), c.want, c.name)
})

test('importing what was just imported adds nothing', () => {
  for (const c of v.cases) {
    const once = importShifts(c.text, v.have)
    const again = importShifts(c.text, [...v.have, ...once.shifts.map((s: { id: string | null }) => ({ ...s, id: s.id || undefined }))])
    assert.equal(again.shifts.length, 0, c.name)
  }
})

test('dates, times and numbers', () => {
  assert.equal(normDate('29.02.2028'), '2028-02-29')
  assert.equal(normDate('29.02.2027'), null)
  assert.equal(normDate('2026-9-2'), '2026-09-02')
  assert.equal(normTime('7'), '07:00')
  assert.equal(normTime('24:01'), null)
  assert.equal(normNum('1,234.50'), 1234.5)
  assert.equal(normNum('-3'), null)
  assert.equal(normNum('12 €'), 12)
})
