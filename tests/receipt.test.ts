/*
  Reading a receipt (src/lib/receipt.ts). The iPhone app (ios-native/Heimat/Receipt.swift)
  is held to the same vectors by scripts/test-ledger-swift.sh.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readReceipt, amounts, itemsMatch } from '../src/lib/receipt.ts'

const v = JSON.parse(readFileSync(new URL('./receipt-vectors.json', import.meta.url), 'utf8'))

for (const c of v.cases) {
  test(c.name, () => {
    const r = readReceipt(c.rows, v.now)
    const w = c.want
    assert.equal(r.store, w.store ?? null, 'store')
    assert.equal(r.date, w.date ?? null, 'date')
    assert.equal(r.total, w.total ?? null, 'total')
    assert.equal(r.totalSure, w.totalSure, 'totalSure')
    assert.equal(r.category, w.category ?? null, 'category')
    assert.deepEqual(r.items.map((i) => [i.name, i.minor]), w.items, 'items')
    assert.equal(r.discount, w.discount, 'discount')
    assert.equal(itemsMatch(r), w.itemsMatch, 'itemsMatch')
  })
}

test('amounts', () => {
  for (const [text, want] of v.amounts) assert.deepEqual(amounts(text).map((a) => a.minor), want, text)
})

/* a photo taken at an angle: names on the left, prices on the right, every line leaning
   the same way — put back together into the printed lines */
test('pieces at a tilt come back as the printed lines', async () => {
  const { pageOf } = await import('../src/lib/receiptOcr.ts')
  const printed: [string, string | null][] = [['REWE', null], ['BIO HAFERDRINK', '1,49 B'], ['BANANE', '1,29 B'], ['TOAST VOLLKORN', '1,19 B'],
    ['SCHOKOLADE', '0,99 A'], ['MILCH', '1,09 B'], ['SUMME', '6,05'], ['Visa', '6,05']]
  // the receipt as printed, then turned 3° as a hand-held photo is
  const a = 3 * Math.PI / 180, H = 40
  const turn = (x: number, y: number) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
  const pieces = printed.flatMap(([name, price], i) => {
    const y = 2000 - i * 70
    const at = (text: string, x0: number, w: number) => {
      const c = [turn(x0, y - H / 2), turn(x0 + w, y - H / 2), turn(x0, y + H / 2), turn(x0 + w, y + H / 2)]
      const xs = c.map((q) => q[0]), ys = c.map((q) => q[1])
      return { text, minX: Math.min(...xs), maxX: Math.max(...xs), midX: xs.reduce((t, q) => t + q, 0) / 4, midY: ys.reduce((t, q) => t + q, 0) / 4, height: Math.max(...ys) - Math.min(...ys) }
    }
    return [at(name, 100, name.length * 22), ...(price ? [at(price, 900 - price.length * 22, price.length * 22)] : [])]
  })
  const p = pageOf(pieces, v.now)
  assert.deepEqual(p.rows, printed.map(([n, pr]) => (pr ? `${n}  ${pr}` : n)))
  assert.equal(p.steady, true)
})

/* a real reading from Android: "1, 49" for 1,49, and the prices sitting a little higher
   than their names — still the receipt as printed */
test('an Android scan reads like the iPhone one', async () => {
  const { pageOf } = await import('../src/lib/receiptOcr.ts')
  const a = JSON.parse(readFileSync(new URL('./receipt-android-pieces.json', import.meta.url), 'utf8'))
  const r = readReceipt(pageOf(a.pieces, a.now).rows, a.now)
  assert.equal(r.store, 'REWE')
  assert.equal(r.total, 422)
  assert.equal(r.totalSure, true)
  assert.equal(r.date, '2026-10-03')
  assert.deepEqual(r.items.map((i) => [i.name, i.minor]), [['Bio Haferdrink', 149], ['Banane', 129], ['Pfand 0,25 Euro', 25], ['Toast Vollkorn', 119]])
})
