/*
  What comes off a month's pay (src/lib/tax/estimate.ts). The tax itself is held to the
  Finance Ministry's calculator in lohnsteuer.test.ts; these hold the contributions and the
  way each kind of job is entered. Each figure here was worked out by hand from the 2026 rates.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deductions, monthDeductions } from '../src/lib/tax/estimate.ts'

const p = { taxClass: 1, church: false, churchRate: 0.09, kvz: 2.9, children: 0, over23: true, sachsen: false, minijobPensionOptOut: true } as any
const d = (gross: number, kind: any, extra: any = {}, main = true) => deductions({ employer: 'x', gross, kind, main }, { ...p, ...extra })

test('a normal job: 2 500 €, class I, childless, 2,9 % extra', () => {
  const r = d(2500, 'regular')
  // tax from the official plan; health 8,75 %, care 2,4 %, pension 9,3 %, unemployment 1,3 %
  assert.deepEqual([r.tax, r.health, r.care, r.pension, r.unemployment, r.net], [187.33, 218.75, 60, 232.5, 32.5, 1768.92])
})

test('a Midijob: contributions on 2000/1397 × (1 000 − 603) = 568,36 €', () => {
  const r = d(1000, 'regular')
  assert.deepEqual([r.tax, r.health, r.care, r.pension, r.unemployment], [0, 49.73, 13.64, 52.86, 7.39])
})

test('a working student pays pension only (reduced in the Midijob band)', () => {
  assert.deepEqual([d(1200, 'werkstudent').pension, d(1200, 'werkstudent').health, d(1200, 'werkstudent').unemployment], [79.49, 0, 0])
  assert.equal(d(2500, 'werkstudent').pension, 232.5)
})

test('a Minijob costs nothing, unless you kept the pension contribution', () => {
  assert.equal(d(500, 'minijob').net, 500)
  assert.equal(d(500, 'minijob', { minijobPensionOptOut: false }).pension, 18)
  // over the limit it is a normal job
  assert.ok(d(700, 'minijob').health > 0)
})

test('a second job is taxed in class VI', () => {
  const r = d(450, 'werkstudent', {}, false)
  assert.equal(r.taxClass, 6)
  assert.ok(r.tax > 0)
})

test('children lower the care rate; the ceilings hold', () => {
  assert.equal(d(2500, 'regular', { children: 3 }).care, 2500 * 0.013)
  assert.equal(d(9000, 'regular').health, 508.59)   // 5 812,50 × 8,75 %
  assert.equal(d(9000, 'regular').pension, 785.85)
})

test('church tax: 9 % or 8 % of its base', () => {
  const nine = d(4000, 'regular', { church: true }), eight = d(4000, 'regular', { church: true, churchRate: 0.08 })
  assert.ok(nine.churchTax > eight.churchTax && eight.churchTax > 0)
  assert.ok(Math.abs(nine.churchTax - nine.tax * 0.09) < 0.02)
})

test('the month adds up', () => {
  const m = monthDeductions([{ employer: 'Café', gross: 400, kind: 'minijob', main: false }, { employer: 'Lab', gross: 1100, kind: 'werkstudent', main: true }], p)
  assert.equal(m.gross, 1500)
  assert.equal(Math.round((m.tax + m.soli + m.churchTax + m.social + m.net) * 100), 150000)
})
