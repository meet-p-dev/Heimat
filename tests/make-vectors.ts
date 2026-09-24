/*
  Writes tests/ledger-vectors.json: inputs and the exact answers the
  TypeScript engine gives for them. The Swift engine
  (ios-native/Tests/LedgerTests.swift) and the database's flat_balance() are
  checked against this file, so all three can only agree.

  Regenerate after changing src/lib/ledger.ts:  npm run vectors
*/
import { writeFileSync } from 'node:fs'
import { fnv1a, toMinor, parseMinor, allocate, buildLedger, settlePlan, sharesOf } from '../src/lib/ledger.ts'
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

const out = { note: 'Generated by tests/make-vectors.ts from src/lib/ledger.ts. Do not edit by hand.', fnv, minor, parse, alloc, ledgers, plans }
writeFileSync(new URL('./ledger-vectors.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(`wrote ${fnv.length} fnv, ${minor.length} minor, ${parse.length} parse, ${alloc.length} allocation, ${ledgers.length} ledger, ${plans.length} plan cases`)
