/*
  Writes tests/ledger-vectors.json: inputs and the exact answers the
  TypeScript engine gives for them. The Swift engine
  (ios-native/Tests/LedgerTests.swift) and the database's flat_balance() are
  checked against this file, so all three can only agree.

  Regenerate after changing src/lib/ledger.ts:  npm run vectors
*/
import { writeFileSync } from 'node:fs'
import { fnv1a, toMinor, parseMinor, allocate, buildLedger, settlePlan, sharesOf, allocateWeighted, computeShares, computePaid, convertNet, occurrence, dueOccurrences, spread } from '../src/lib/ledger.ts'
import type { SplitSpec } from '../src/lib/ledger.ts'
import type { Expense, Settlement } from '../src/lib/types.ts'

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('')
const uuid = (r: () => number) => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-a${hex(r, 3)}-${hex(r, 12)}`

const fnv = ['', 'a', 'foobar', 'ü', 'Kartik', '€', '0f8e2c1a-3b4d-4e5f-a6b7-c8d9e0f1a2b3:7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d']
  .map((s) => ({ s, h: fnv1a(s) }))

const minor = ([
  [12.5, 'EUR'], [0.29, 'EUR'], [1.005, 'EUR'], [-1.005, 'EUR'], [2.675, 'EUR'], [1234.5, 'JPY'],
  [1.2345, 'KWD'], [0, 'EUR'], [123456789.99, 'EUR'], [0.1 + 0.2, 'EUR'],
] as [number, string][]).map(([major, cur]) => ({ major, cur, minor: toMinor(major, cur) }))

const parse = ([
  ['12,50', 'EUR'], ['12.50', 'EUR'], ['1.200', 'EUR'], ['1,200', 'EUR'], ['1.234,56', 'EUR'], ['1,234.56', 'EUR'],
  ['1 234,56', 'EUR'], ["1'234.50", 'EUR'], ['1.234.567', 'EUR'], [',5', 'EUR'], ['5,', 'EUR'], ['-3,20', 'EUR'],
  ['0,125', 'EUR'], ['1.2.3', 'EUR'], ['abc', 'EUR'], ['', 'EUR'], ['0.500', 'EUR'], ['1.23,45', 'EUR'],
  ['1.234', 'KWD'], ['1.200', 'JPY'], ['12,5', 'JPY'],
] as [string, string][]).map(([s, cur]) => ({ s, cur, minor: parseMinor(s, cur) }))

const alloc = []
{
  const r = rng(11)
  for (let i = 0; i < 40; i++) {
    const people = Array.from({ length: 1 + Math.floor(r() * 7) }, () => uuid(r))
    const total = Math.floor(r() * 100000) * (i % 9 === 0 ? -1 : 1)
    const seed = uuid(r)
    alloc.push({ total, people, seed, out: Object.fromEntries(allocate(total, people, seed)) })
  }
}

const ledgers = []
for (let f = 0; f < 25; f++) {
  const r = rng(100 + f)
  const people = Array.from({ length: 2 + Math.floor(r() * 7) }, () => uuid(r))
  const expenses: Expense[] = []
  for (let i = 0, n = Math.floor(r() * 30); i < n; i++) {
    const among = people.filter(() => r() < 0.65)
    expenses.push({
      id: uuid(r), flat_id: 'f', description: '', category: 'other', created_by: '', spent_on: '2026-09-01',
      amount: Math.round(r() * r() * 60000) / 100 + 0.01, currency: f === 7 && i === 0 ? 'CHF' : 'EUR',
      paid_by: people[Math.floor(r() * people.length)], split_among: among,
    })
  }
  const settles: Settlement[] = []
  for (let i = 0, n = Math.floor(r() * 4); i < n; i++) {
    const a = people[Math.floor(r() * people.length)], b = people.filter((p) => p !== a)[Math.floor(r() * (people.length - 1))]
    settles.push({ id: uuid(r), flat_id: 'f', from_user: a, to_user: b, amount: Math.round(r() * 15000) / 100 + 0.01, created_by: '', settled_on: '2026-09-02' })
  }
  const L = buildLedger(expenses, settles)
  ledgers.push({
    expenses: expenses.map(({ id, amount, currency, paid_by, split_among }) => ({ id, amount, currency, paid_by, split_among })),
    settles: settles.map(({ id, amount, from_user, to_user }) => ({ id, amount, from_user, to_user })),
    currency: L.currency,
    excluded: L.excluded.map((e) => e.id),
    shares: Object.fromEntries(expenses.map((e) => [e.id, sharesOf(e).map((s) => [s.uid, s.minor])])),
    net: Object.fromEntries([...L.netMinor].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    owes: L.owes.map(({ from, to, minor }) => ({ from, to, minor })),
    plan: settlePlan(L.netMinor).map(({ from, to, minor }) => ({ from, to, minor })),
  })
}

/* balance sets built to have many ties and several optimal plans — where a non-deterministic sort shows */
const plans = []
{
  const r = rng(5)
  for (let i = 0; i < 40; i++) {
    const ids = Array.from({ length: 2 + Math.floor(r() * 11) }, () => uuid(r))
    const vals = ids.map(() => (Math.floor(r() * 7) - 3) * 500 + (r() < 0.2 ? Math.floor(r() * 90) : 0))
    vals[0] -= vals.reduce((a, b) => a + b, 0)
    const net = ids.map((u, k) => [u, vals[k]] as [string, number])
    plans.push({ net, plan: settlePlan(new Map(net)).map(({ from, to, minor }) => ({ from, to, minor })) })
  }
  // beyond the exact limit: the greedy fallback must match too
  const ids = Array.from({ length: 16 }, () => uuid(r))
  const vals = ids.map((_, k) => (k % 2 ? 1 : -1) * (300 + k * 7))
  vals[0] -= vals.reduce((a, b) => a + b, 0)
  const net = ids.map((u, k) => [u, vals[k]] as [string, number])
  plans.push({ net, plan: settlePlan(new Map(net)).map(({ from, to, minor }) => ({ from, to, minor })) })
}

// ------------------------------------------------------------- engine v2

const pickFrom = (r: () => number, ids: string[], min = 1) => { const s = ids.filter(() => r() < 0.6); return s.length >= min ? s : ids.slice(0, min) }

function specFor(r: () => number, total: number, ids: string[]): SplitSpec {
  const who = pickFrom(r, ids)
  const k = Math.floor(r() * 6), sign = total < 0 ? -1 : 1
  if (k === 0) return { type: 'equal', among: who }
  if (k === 1) return { type: 'exact', values: Object.fromEntries(allocateWeighted(total, who.map((u) => [u, 1 + Math.floor(r() * 9)] as [string, number]), 'e')) }
  if (k === 2) return { type: 'percent', values: Object.fromEntries(allocateWeighted(10000, who.map((u) => [u, 1 + Math.floor(r() * 9)] as [string, number]), 'p')) }
  if (k === 3) return { type: 'shares', values: Object.fromEntries(who.map((u) => [u, (1 + Math.floor(r() * 400)) / 100])) }
  if (k === 4) return { type: 'adjust', among: who, values: Object.fromEntries(who.filter(() => r() < 0.5).map((u) => [u, sign * Math.floor(r() * Math.max(1, Math.abs(total) / (who.length * 2)))])) }
  const items = Array.from({ length: 1 + Math.floor(r() * 4) }, () => ({ minor: 0, among: pickFrom(r, ids) }))
  const tax = Math.floor(r() * 300), tip = Math.floor(r() * 300), discount = r() < 0.2 ? Math.floor(r() * 100) : 0
  const lines = Math.abs(total) - tax - tip + discount
  if (lines < 0) return { type: 'equal', among: who }
  allocateWeighted(lines, items.map((_, i) => ['i' + i, 1 + i] as [string, number]), 'it').forEach((v, key) => (items[+key.slice(1)].minor = v))
  return { type: 'itemized', items, tax, tip, discount }
}
const resultOf = (res: ReturnType<typeof computeShares>) => (res.ok ? { ok: true, shares: Object.fromEntries(res.shares) } : { ok: false, error: res.error })

const weighted = []
{
  const r = rng(31)
  for (let i = 0; i < 40; i++) {
    const ids = Array.from({ length: 1 + Math.floor(r() * 6) }, () => uuid(r))
    const weights = ids.map((u) => [u, Math.floor(r() * 50000)] as [string, number])
    const total = Math.floor(r() * 10_000_000) * (i % 7 === 0 ? -1 : 1)
    const seed = uuid(r)
    weighted.push({ total, weights, seed, out: Object.fromEntries(allocateWeighted(total, weights, seed)) })
  }
}

const splits = []
{
  const r = rng(32)
  for (let i = 0; i < 120; i++) {
    const ids = Array.from({ length: 2 + Math.floor(r() * 6) }, () => uuid(r))
    const total = (1 + Math.floor(r() * 300000)) * (r() < 0.08 ? -1 : 1)
    const spec = specFor(r, total, ids)
    const seed = uuid(r)
    splits.push({ total, spec, seed, result: resultOf(computeShares(total, spec, seed)) })
  }
  // every error the engine can give
  const a = 'a1111111-1111-4111-a111-111111111111', b = 'b2222222-2222-4222-a222-222222222222'
  const bad: [number, SplitSpec][] = [
    [1000, { type: 'exact', values: { [a]: 500, [b]: 400 } }], [1000, { type: 'exact', values: { [a]: 600, [b]: 500 } }],
    [1000, { type: 'exact', values: { [a]: -100, [b]: 1100 } }], [1000, { type: 'percent', values: { [a]: 5000, [b]: 4000 } }],
    [1000, { type: 'percent', values: { [a]: 10001 } }], [1000, { type: 'shares', values: { [a]: 1.234 } }],
    [1000, { type: 'shares', values: { [a]: 0 } }], [1000, { type: 'adjust', among: [a, b], values: { [a]: 1500 } }],
    [1000, { type: 'adjust', among: [a], values: { [b]: 100 } }], [1000, { type: 'itemized', items: [{ minor: 900, among: [a] }] }],
    [1000, { type: 'itemized', items: [{ minor: 1000, among: [] }] }], [1000, { type: 'equal', among: [] }],
    [100_000_000_001, { type: 'equal', among: [a] }], [1000, { type: 'bogus' as any }],
    // each adjustment and receipt line is capped like the bill, so no share can outgrow exact integers
    [1000, { type: 'adjust', among: [a, b], values: { [a]: 100_000_000_001, [b]: -100_000_000_001 } }],
    [1000, { type: 'itemized', items: [{ minor: 100_000_000_001, among: [a] }], discount: 99_999_999_001 }],
    // a JSON null reads as missing, as in Postgres
    [1000, { type: 'adjust', among: [a, b], values: null as any }], [1000, { type: 'exact', values: null as any }],
    [1000, { type: 'itemized', items: [{ minor: 1000, among: null as any }] }],
  ]
  for (const [total, spec] of bad) splits.push({ total, spec, seed: 'err', result: resultOf(computeShares(total, spec, 'err')) })
}

const paid = []
{
  const a = 'a1111111-1111-4111-a111-111111111111', b = 'b2222222-2222-4222-a222-222222222222'
  const cases: [number, Record<string, number> | null][] = [[10000, { [a]: 6000, [b]: 4000 }], [10000, { [a]: 6000, [b]: 3000 }], [10000, null], [-500, { [a]: -200, [b]: -300 }], [500, { [a]: 700, [b]: -200 }]]
  for (const [total, payers] of cases) paid.push({ total, payers, paidBy: a, result: resultOf(computePaid(total, payers, a)) })
}

const ledgers2 = []
for (let f = 0; f < 30; f++) {
  const r = rng(200 + f)
  const people = Array.from({ length: 2 + Math.floor(r() * 6) }, () => uuid(r))
  const expenses: Expense[] = []
  for (let i = 0, n = 1 + Math.floor(r() * 20); i < n; i++) {
    const id = uuid(r)
    const cur = r() < 0.15 ? (r() < 0.5 ? 'SEK' : 'JPY') : 'EUR'
    const amount = cur === 'JPY' ? 1 + Math.floor(r() * 30000) : Math.round(r() * r() * 60000) / 100 + 0.01
    const total = toMinor(amount, cur)
    const spec = specFor(r, total, people)
    const payerIds = r() < 0.25 ? pickFrom(r, people, 2) : null
    const payers = payerIds ? Object.fromEntries(allocateWeighted(total, payerIds.map((u) => [u, 1 + Math.floor(r() * 4)] as [string, number]), 'pay' + id)) : null
    const res = computeShares(total, spec, id)
    const stored = r() < 0.3 && res.ok ? Object.fromEntries(res.shares) : null
    const e: Expense = {
      id, flat_id: 'f', description: '', category: 'other', created_by: '', spent_on: '2026-09-01', amount, currency: cur,
      paid_by: payerIds ? payerIds[0] : people[Math.floor(r() * people.length)],
      split_among: spec.type === 'itemized' ? [...new Set(spec.items!.flatMap((x) => x.among))] : spec.among || Object.keys(spec.values || {}),
      split_type: spec.type, split: spec.type === 'itemized' ? { items: spec.items as any, tax: spec.tax, tip: spec.tip, discount: spec.discount } : spec.type === 'equal' ? null : { values: spec.values as any },
      payers, shares: stored, deleted_at: r() < 0.05 ? '2026-09-02' : null,
    }
    expenses.push(e)
  }
  const settles: Settlement[] = []
  for (let i = 0, n = Math.floor(r() * 4); i < n; i++) {
    const a = people[Math.floor(r() * people.length)], b = people.filter((p) => p !== a)[Math.floor(r() * (people.length - 1))]
    settles.push({ id: uuid(r), flat_id: 'f', from_user: a, to_user: b, amount: Math.round(r() * 9000) / 100 + 0.01, currency: r() < 0.2 ? 'SEK' : null, created_by: '', settled_on: '2026-09-02' })
  }
  const L = buildLedger(expenses, settles)
  ledgers2.push({
    expenses, settles, currency: L.currency, excluded: L.excluded.map((e) => e.id), invalid: L.invalid.length,
    books: [...L.books.values()].map((b) => ({
      currency: b.currency,
      net: Object.fromEntries([...b.netMinor].sort((x, y) => (x[0] < y[0] ? -1 : 1))),
      owes: b.owes.map(({ from, to, minor }) => ({ from, to, minor })),
      plan: settlePlan(b.netMinor, b.currency).map(({ from, to, minor }) => ({ from, to, minor })),
    })),
    shares: Object.fromEntries(expenses.map((e) => [e.id, sharesOf(e).map((x) => [x.uid, x.minor])])),
  })
}

// fixed flats: the main currency counts live expenses only, and a flat with none takes its payments' currency
{
  const a = 'a1111111-1111-4111-a111-111111111111', b = 'b2222222-2222-4222-a222-222222222222'
  const ex = (id: string, amount: number, currency: string, paid_by: string, deleted: boolean): Expense => ({
    id, flat_id: 'f', description: '', category: 'other', created_by: '', spent_on: '2026-09-01', amount, currency, paid_by,
    split_among: [a, b], split_type: 'equal', split: null, payers: null, shares: null, deleted_at: deleted ? '2026-09-02' : null,
  })
  const st = (id: string, from_user: string, to_user: string, amount: number, currency: string | null): Settlement =>
    ({ id, flat_id: 'f', from_user, to_user, amount, currency, created_by: '', settled_on: '2026-09-02' })
  const fixed: [Expense[], Settlement[]][] = [
    [[ex('e0000000-0000-4000-a000-000000000001', 30, 'EUR', a, false), ex('e0000000-0000-4000-a000-000000000002', 50, 'CHF', b, true),
      ex('e0000000-0000-4000-a000-000000000003', 50, 'CHF', b, true)], []],
    [[], [st('50000000-0000-4000-a000-000000000001', a, b, 20, 'SEK'), st('50000000-0000-4000-a000-000000000002', b, a, 5, '')]],
  ]
  for (const [expenses, settles] of fixed) {
    const L = buildLedger(expenses, settles)
    ledgers2.push({
      expenses, settles, currency: L.currency, excluded: L.excluded.map((e) => e.id), invalid: L.invalid.length,
      books: [...L.books.values()].map((b) => ({
        currency: b.currency,
        net: Object.fromEntries([...b.netMinor].sort((x, y) => (x[0] < y[0] ? -1 : 1))),
        owes: b.owes.map(({ from, to, minor }) => ({ from, to, minor })),
        plan: settlePlan(b.netMinor, b.currency).map(({ from, to, minor }) => ({ from, to, minor })),
      })),
      shares: Object.fromEntries(expenses.map((e) => [e.id, sharesOf(e).map((x) => [x.uid, x.minor])])),
    })
  }
}

const convert = []
{
  const r = rng(41)
  for (let i = 0; i < 25; i++) {
    const ids = Array.from({ length: 2 + Math.floor(r() * 5) }, () => uuid(r))
    const books = ['EUR', 'SEK', 'JPY', 'KWD'].filter(() => r() < 0.7).map((c) => {
      const m = allocateWeighted(Math.floor(r() * 900000), ids.map((u) => [u, 1 + Math.floor(r() * 5)] as [string, number]), c + i)
      const n = new Map<string, number>(); let first = true
      for (const [u, v] of m) { n.set(u, first ? -([...m.values()].reduce((a, b) => a + b, 0) - v) : v); first = false }
      return { currency: c, netMinor: n, net: {}, owes: [] }
    })
    const rates: Record<string, string> = { SEK: '0.0873', JPY: '0.00617', KWD: '2.9812', EUR: '1' }
    if (r() < 0.2) delete rates.KWD
    const target = ['EUR', 'SEK', 'JPY'][Math.floor(r() * 3)]
    const rs = target === 'EUR' ? rates : Object.fromEntries(Object.entries(rates).map(([c, v]) => [c, c === target ? '1' : (Number(v) / Number(rates[target])).toPrecision(8).replace(/0+$/, '').replace(/\.$/, '')]))
    const res = convertNet(books, target, rs)
    convert.push({ books: books.map((b) => ({ currency: b.currency, net: Object.fromEntries(b.netMinor) })), target, rates: rs, net: Object.fromEntries(res.net), missing: res.missing })
  }
}

const dates = []
for (const cadence of ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const) {
  for (const anchor of ['2026-01-31', '2026-02-28', '2028-02-29', '2026-12-31', '2026-03-15', '2026-11-30', '1999-12-31']) {
    dates.push({ anchor, cadence, dates: Array.from({ length: 30 }, (_, n) => occurrence(anchor, cadence, n)) })
  }
}
const due = [
  { anchor: '2026-09-30', cadence: 'monthly', fromN: 0, today: '2026-12-01', until: null },
  { anchor: '2026-09-30', cadence: 'monthly', fromN: 2, today: '2026-12-31', until: '2026-12-15' },
  { anchor: '2026-01-05', cadence: 'weekly', fromN: 3, today: '2026-03-01', until: null },
].map((c) => ({ ...c, out: dueOccurrences(c.anchor, c.cadence as any, c.fromN, c.today, c.until) }))

/* one payment to one person, spread over the places you owe each other in */
const spreads = []
{
  const r = rng(77)
  const fixed: [number, [string, number][], string][] = [
    [1000, [['g1', 600], ['g2', 400]], 'c'], [600, [['g1', 600], ['g2', 400]], 'c'], [700, [['g1', 400], ['g2', 400]], 'c'],
    [600, [['g1', 1000], ['c', -400]], 'c'], [900, [['g1', 1000], ['g2', -400]], 'c'], [500, [['g1', -300]], 'c'],
    [250, [], 'c'], [1, [['b', 5], ['a', 5]], 'c'], [0, [['g1', 5]], 'c'], [1500, [['c', 1000]], 'c'],
  ]
  for (const [pay, pl, fb] of fixed) {
    const places = pl.map(([place, owed]) => ({ place, owed }))
    spreads.push({ pay, places, fallback: fb, out: spread(pay, places, fb) })
  }
  for (let i = 0; i < 300; i++) {
    const ids = Array.from({ length: Math.floor(r() * 5) }, () => uuid(r))
    const fb = r() < 0.5 && ids.length ? ids[0] : uuid(r)
    const places = ids.map((place) => ({ place, owed: Math.floor((r() - 0.3) * 20000) }))
    const net = places.reduce((a, p) => a + p.owed, 0)
    const pay = r() < 0.4 && net > 0 ? net : 1 + Math.floor(r() * 25000)
    spreads.push({ pay, places, fallback: fb, out: spread(pay, places, fb) })
  }
}

const out = { note: 'Generated by tests/make-vectors.ts from src/lib/ledger.ts. Do not edit by hand.', fnv, minor, parse, alloc, ledgers, plans, weighted, splits, paid, ledgers2, convert, dates, due, spreads }
writeFileSync(new URL('./ledger-vectors.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(`wrote ${fnv.length} fnv, ${minor.length} minor, ${parse.length} parse, ${alloc.length} allocation, ${ledgers.length} ledger, ${plans.length} plan cases; v2: ${weighted.length} weighted, ${splits.length} split, ${paid.length} payer, ${ledgers2.length} ledger, ${convert.length} conversion, ${dates.length} date series, ${due.length} due cases, ${spreads.length} spreads`)
