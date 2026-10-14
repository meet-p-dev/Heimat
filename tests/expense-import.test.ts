/*
  Bringing a group over from another app (src/lib/importExpenses.ts, src/lib/xlsx.ts). The
  iPhone app (ios-native/Heimat/ExpenseImport.swift, Xlsx.swift) is held to the same vectors by
  scripts/test-ledger-swift.sh.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { guessMe, importCsv, importSheets, nameFromFile, swAmount, swDate, sheetAmount } from '../src/lib/importExpenses.ts'
import { readXlsx } from '../src/lib/xlsx.ts'

const v = JSON.parse(readFileSync(new URL('./expense-import-vectors.json', import.meta.url), 'utf8'))

test('every kind of file gives the checked answer', async () => {
  for (const c of v.cases) {
    if (c.kind === 'xlsx') {
      const sheets = await readXlsx(Buffer.from(c.b64, 'base64'))
      assert.deepEqual(sheets, c.sheets, c.name + ': sheets')
      assert.deepEqual(importSheets(sheets, { fileName: c.file, ...c.opts }), c.want, c.name)
    } else assert.deepEqual(importCsv(c.text, { fileName: c.file, ...c.opts }), c.want, c.name)
  }
})

test('every row keeps the balances exactly as Splitwise had them', () => {
  for (const c of v.cases) {
    if (!c.want.ok) continue
    const f = c.want.file
    const sum = new Map<string, number>()
    const add = (k: string, cur: string, n: number) => sum.set(`${k}|${cur}`, (sum.get(`${k}|${cur}`) || 0) + n)
    for (const e of f.expenses) {
      const paid = Object.values(e.paid as Record<string, number>).reduce((a, b) => a + b, 0)
      const owed = Object.values(e.owed as Record<string, number>).reduce((a, b) => a + b, 0)
      assert.equal(paid, e.total, `${c.name}: ${e.t} paid`)
      assert.equal(owed, e.total, `${c.name}: ${e.t} owed`)
      for (const [k, n] of Object.entries(e.paid as Record<string, number>)) { assert.ok(n > 0); add(k, e.cur, n) }
      for (const [k, n] of Object.entries(e.owed as Record<string, number>)) { assert.ok(n > 0); add(k, e.cur, -n) }
    }
    for (const p of f.payments) { assert.notEqual(p.from, p.to); add(p.from, p.cur, p.total); add(p.to, p.cur, -p.total) }
    const got: Record<string, number> = {}
    for (const [k, n] of sum) if (n) got[k] = n
    assert.deepEqual(got, f.balances, c.name)
  }
})

test('random groups: rebuilt rows always move each balance by exactly its column', () => {
  let seed = 7
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  for (let g = 0; g < 400; g++) {
    const people = 2 + rnd(5)
    let csv = 'Date,Description,Category,Cost,Currency,' + Array.from({ length: people }, (_, i) => `P${i}`).join(',') + '\n'
    const want = new Array(people).fill(0)
    for (let r = 0; r < 1 + rnd(8); r++) {
      const nets = Array.from({ length: people }, () => rnd(3) ? rnd(20001) - 10000 : 0)
      nets[people - 1] -= nets.reduce((a, b) => a + b, 0)
      const up = nets.filter((n) => n > 0).reduce((a, b) => a + b, 0)
      const cost = rnd(4) ? up + rnd(5000) : up - 1 // sometimes a cost that can't be right
      nets.forEach((n, i) => (want[i] += n))
      csv += `2025-01-${String(1 + rnd(28)).padStart(2, '0')},Row ${r},General,${(cost / 100).toFixed(2)},EUR,${nets.map((n) => (n / 100).toFixed(2)).join(',')}\n`
    }
    const res = importCsv(csv)
    if (!res.ok) { assert.ok(want.every((n) => n === 0), csv); continue }
    const got = new Array(people).fill(0)
    for (const e of res.file.expenses) {
      for (const [k, n] of Object.entries(e.paid)) got[+k] += n
      for (const [k, n] of Object.entries(e.owed)) got[+k] -= n
    }
    for (const p of res.file.payments) { got[+p.from] += p.total; got[+p.to] -= p.total }
    assert.deepEqual(got, want, csv)
  }
})

test('dates, amounts, names', () => {
  assert.equal(swDate('2025-03-01'), '2025-03-01')
  assert.equal(swDate('2025-03-01 18:20:00 +0100'), '2025-03-01')
  assert.equal(swDate('29.02.2025'), null)
  assert.equal(swAmount('1000.00', 'JPY'), 1000)
  assert.equal(swAmount('1000.50', 'JPY'), null)
  assert.equal(swAmount('-12.75', 'USD'), -1275)
  assert.equal(swAmount('1,234.50', 'EUR'), 123450)
  assert.equal(sheetAmount('33.333333333333336', 'EUR'), 3333)
  assert.equal(sheetAmount('€ 12,50', 'EUR'), 1250)
  assert.equal(sheetAmount('', 'EUR'), 0)
  assert.equal(sheetAmount('abc', 'EUR'), null)
  assert.equal(swDate('10/13/2025', true), '2025-10-13')
  assert.equal(swDate('13/10/2025'), '2025-10-13')
  assert.equal(swDate('45748'), '2025-04-01')
  assert.equal(swDate('2 Oct 2025'), '2025-10-02')
  assert.equal(swDate('Oct 2, 2025'), '2025-10-02')
  assert.equal(swDate('20230722'), '2023-07-22')
  assert.equal(swDate('2. März 2025'), '2025-03-02')
  assert.equal(nameFromFile('wg-berlin_2024-05-03_export.csv'), 'Wg berlin')
  assert.equal(nameFromFile('export.csv'), '')
  const people = [{ key: '0', name: 'Alex Kim' }, { key: '1', name: 'Priya Nair' }, { key: '2', name: 'Priya S.' }]
  assert.equal(guessMe(people, 'alex kim'), '0')
  assert.equal(guessMe(people, 'Alex'), '0')
  assert.equal(guessMe(people, 'Priya'), null) // two Priyas: ask
  assert.equal(guessMe(people, ''), null)
})
