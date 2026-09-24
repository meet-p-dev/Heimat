/*
  The money engine's guarantees, checked as properties over thousands of
  random flats rather than a handful of hand-picked ones — the bugs this
  replaced (a cent that went missing, a plan that changed between launches)
  only showed up on inputs nobody thought to write down.

  Run with: npm test
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fnv1a, allocate, sharesOf, buildLedger, settlePlan, zeroSumGroups, parseMinor, minorToInput,
  toMinor, pairwiseFor, EXACT_LIMIT, flatCurrency,
} from '../src/lib/ledger.ts'
import type { Expense, Settlement } from '../src/lib/types.ts'

// deterministic PRNG (mulberry32), so a failure is reproducible from its seed
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)]
const PEOPLE = ['ana', 'ben', 'cara', 'dev', 'eli', 'fin', 'gus', 'hal']

function randomFlat(seed: number, opts: { people?: number; expenses?: number; settles?: number } = {}) {
  const r = rng(seed)
  const people = PEOPLE.slice(0, opts.people ?? 2 + Math.floor(r() * 6))
  const expenses: Expense[] = []
  const nE = opts.expenses ?? Math.floor(r() * 40)
  for (let i = 0; i < nE; i++) {
    const among = people.filter(() => r() < 0.7)
    expenses.push({
      id: `e${seed}-${i}`, flat_id: 'f', description: '', currency: 'EUR', category: 'other', created_by: '', spent_on: '2026-09-01',
      amount: Math.round(r() * r() * 50000) / 100 + 0.01, // 0,01 € … 500 €, skewed to small bills
      paid_by: pick(r, people), split_among: among,
    })
  }
  const settles: Settlement[] = []
  const nS = opts.settles ?? Math.floor(r() * 5)
  for (let i = 0; i < nS; i++) {
    const from = pick(r, people), to = pick(r, people.filter((p) => p !== from))
    if (to) settles.push({ id: `s${seed}-${i}`, flat_id: 'f', from_user: from, to_user: to, amount: Math.round(r() * 20000) / 100 + 0.01, created_by: '', settled_on: '2026-09-02' })
  }
  return { people, expenses, settles }
}
const sum = (it: Iterable<number>) => { let s = 0; for (const v of it) s += v; return s }

// ------------------------------------------------------------------ hashing

test('fnv1a matches the published FNV-1a 32-bit test vectors', () => {
  assert.equal(fnv1a(''), 0x811c9dc5)
  assert.equal(fnv1a('a'), 0xe40c292c)
  assert.equal(fnv1a('foobar'), 0xbf9cf968)
  assert.equal(fnv1a('\u00fc'), 0x119dd44a) // hashed as UTF-8 bytes C3 BC, not UTF-16 or Latin-1 (0x790b80bb)
})

// --------------------------------------------------------------- allocation

test('allocate: parts always add up to exactly the total, each within one cent of fair', () => {
  const r = rng(1)
  for (let t = 0; t < 20000; t++) {
    const n = 1 + Math.floor(r() * 12)
    const total = Math.floor(r() * 2_000_000) * (r() < 0.1 ? -1 : 1)
    const m = allocate(total, PEOPLE.concat(['i', 'j', 'k', 'l']).slice(0, n), 'seed' + t)
    assert.equal(sum(m.values()), total)
    for (const v of m.values()) assert.ok(Math.abs(v - total / n) < 1, `${v} vs ${total}/${n}`)
  }
})

test('allocate: order of people and duplicates do not matter', () => {
  const a = allocate(1000, ['ana', 'ben', 'cara'], 'x')
  const b = allocate(1000, ['cara', 'ana', 'ben', 'ana'], 'x')
  assert.deepEqual([...a].sort(), [...b].sort())
  assert.equal(sum(b.values()), 1000)
})

test('allocate: the odd cent rotates between people rather than always landing on one', () => {
  const extra: Record<string, number> = { ana: 0, ben: 0, cara: 0 }
  for (let i = 0; i < 3000; i++) {
    const m = allocate(1000, ['ana', 'ben', 'cara'], `expense-${i}`)
    for (const [u, v] of m) if (v === 334) extra[u]++
  }
  for (const u in extra) assert.ok(extra[u] > 900 && extra[u] < 1100, `${u} took ${extra[u]} of 3000`)
})

test('allocate: refunds split with the sign flipped; zero and empty are safe', () => {
  const m = allocate(-1000, ['ana', 'ben', 'cara'], 'x')
  assert.equal(sum(m.values()), -1000)
  assert.deepEqual([...allocate(0, ['ana', 'ben'], 'x').values()], [0, 0])
  assert.equal(allocate(100, [], 'x').size, 0)
  assert.equal(allocate(NaN, ['ana'], 'x').size, 0)
})

test('10,00 € split three ways shows 3,34 + 3,33 + 3,33 — never 3,33 × 3 = 9,99', () => {
  const s = sharesOf({ id: 'e1', amount: 10, currency: 'EUR', paid_by: 'ana', split_among: ['ana', 'ben', 'cara'] })
  assert.equal(sum(s.map((x) => x.minor)), 1000)
  assert.deepEqual(s.map((x) => x.minor).sort(), [333, 333, 334])
})

// ------------------------------------------------------------------- ledger

test('ledger: balances always sum to exactly zero, and every expense is conserved', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const { expenses, settles } = randomFlat(seed)
    const L = buildLedger(expenses, settles)
    assert.equal(sum(L.netMinor.values()), 0, `seed ${seed}`)
    for (const v of L.netMinor.values()) assert.ok(Number.isSafeInteger(v))
  }
})

test('ledger: who-owes-whom adds up to each person\'s balance, exactly', () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const { expenses, settles } = randomFlat(seed)
    const L = buildLedger(expenses, settles)
    for (const [u, v] of L.netMinor) assert.equal(sum(pairwiseFor(L.owes, u).values()), v, `seed ${seed} ${u}`)
    for (const o of L.owes) assert.ok(o.minor > 0 && o.from !== o.to)
    // each pair appears once
    const keys = L.owes.map((o) => [o.from, o.to].sort().join('|'))
    assert.equal(new Set(keys).size, keys.length)
  }
})

test('ledger: the order rows arrive in changes nothing', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const { expenses, settles } = randomFlat(seed)
    const a = buildLedger(expenses, settles)
    const b = buildLedger([...expenses].reverse(), [...settles].reverse())
    assert.deepEqual([...a.netMinor].sort(), [...b.netMinor].sort())
    assert.deepEqual(a.owes, b.owes)
  }
})

test('ledger: where every split is even, balances equal the old maths to the cent', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const { expenses, settles } = randomFlat(seed)
    const even = expenses.map((e) => { const n = e.split_among.length || 1; return { ...e, amount: Math.max(1, Math.round(e.amount)) * n } })
    const L = buildLedger(even, settles)
    const old: Record<string, number> = {}
    for (const e of even) {
      const parts = e.split_among.length ? e.split_among : [e.paid_by]
      old[e.paid_by] = (old[e.paid_by] || 0) + e.amount
      for (const u of parts) old[u] = (old[u] || 0) - e.amount / parts.length
    }
    for (const s of settles) { old[s.from_user] = (old[s.from_user] || 0) + s.amount; old[s.to_user] = (old[s.to_user] || 0) - s.amount }
    for (const u in old) assert.equal(L.netMinor.get(u) ?? 0, Math.round(old[u] * 100), `seed ${seed} ${u}`)
  }
})

test('ledger: someone with no member row keeps their money on the books', () => {
  // Cara left (or was never a member row). Ana paid 90 € for all three.
  const e: Expense = { id: 'x', flat_id: 'f', description: '', amount: 90, currency: 'EUR', paid_by: 'ana', split_among: ['ana', 'ben', 'cara'], category: 'rent', created_by: 'ana', spent_on: '2026-09-01' }
  const L = buildLedger([e], [])
  assert.deepEqual(Object.fromEntries(L.netMinor), { ana: 6000, ben: -3000, cara: -3000 })
  // and the reverse: Cara paid, and is still owed
  const L2 = buildLedger([{ ...e, paid_by: 'cara' }], [])
  assert.equal(L2.netMinor.get('cara'), 6000)
  // a settlement to her is two-sided, not credit from nowhere
  const L3 = buildLedger([{ ...e, paid_by: 'cara' }], [{ id: 's', flat_id: 'f', from_user: 'ben', to_user: 'cara', amount: 30, created_by: 'ben', settled_on: '2026-09-02' }])
  assert.equal(sum(L3.netMinor.values()), 0)
  assert.equal(L3.netMinor.get('ben'), 0)
})

test('ledger: paying the amount shown clears the debt to exactly zero', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const { expenses } = randomFlat(seed, { settles: 0 })
    const L = buildLedger(expenses, [])
    const paid: Settlement[] = L.owes.map((o, i) => ({ id: 'p' + i, flat_id: 'f', from_user: o.from, to_user: o.to, amount: Number(minorToInput(o.minor).replace(',', '.')), created_by: '', settled_on: '' }))
    const after = buildLedger(expenses, paid)
    for (const v of after.netMinor.values()) assert.equal(v, 0)
    assert.equal(after.owes.length, 0)
  }
})

test('ledger: other currencies are kept out, never added as bare numbers', () => {
  const base = { flat_id: 'f', description: '', category: 'other', created_by: '', spent_on: '2026-09-01', split_among: ['ana', 'ben'] }
  const L = buildLedger([
    { ...base, id: '1', amount: 100, currency: 'EUR', paid_by: 'ana' },
    { ...base, id: '2', amount: 100, currency: 'EUR', paid_by: 'ana' },
    { ...base, id: '3', amount: 500, currency: 'CHF', paid_by: 'ben' },
  ], [])
  assert.equal(L.currency, 'EUR')
  assert.equal(L.excluded.length, 1)
  assert.equal(L.netMinor.get('ana'), 10000)
  assert.equal(flatCurrency([], 'GBP'), 'GBP')
})

test('ledger: unreadable rows are reported, not silently turned into zero', () => {
  const L = buildLedger([{ id: 'bad', flat_id: 'f', description: '', amount: NaN, currency: 'EUR', paid_by: 'ana', split_among: [], category: '', created_by: '', spent_on: '' }], [])
  assert.equal(L.invalid.length, 1)
  assert.equal(L.netMinor.size, 0)
})

// --------------------------------------------------------------- settle up

/* an independent brute force: the most zero-sum groups a set can be cut into */
function bruteGroups(vals: number[]): number {
  let best = 0
  const go = (rest: number[], groups: number) => {
    if (!rest.length) { best = Math.max(best, groups); return }
    const [first, ...others] = rest
    const n = others.length
    for (let m = 0; m < 1 << n; m++) {
      let s = first; const inG: number[] = [], out: number[] = []
      for (let i = 0; i < n; i++) (m >> i) & 1 ? (s += others[i], inG.push(others[i])) : out.push(others[i])
      if (s === 0) go(out, groups + 1)
    }
  }
  go(vals.filter((v) => v !== 0), 0)
  return best
}

function applyPlan(net: Map<string, number>, plan: { from: string; to: string; minor: number }[]) {
  const m = new Map(net)
  for (const t of plan) { m.set(t.from, (m.get(t.from) || 0) + t.minor); m.set(t.to, (m.get(t.to) || 0) - t.minor) }
  return m
}

test('settle plan: always brings every balance to exactly zero', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const { expenses, settles } = randomFlat(seed)
    const L = buildLedger(expenses, settles)
    const plan = settlePlan(L.netMinor)
    for (const v of applyPlan(L.netMinor, plan).values()) assert.equal(v, 0, `seed ${seed}`)
    for (const t of plan) assert.ok(t.minor > 0 && t.from !== t.to)
  }
})

test('settle plan: provably the fewest payments (checked against brute force)', () => {
  const r = rng(7)
  for (let t = 0; t < 3000; t++) {
    const n = 2 + Math.floor(r() * 7)
    const vals = Array.from({ length: n }, () => Math.floor(r() * 41) - 20)
    vals[0] -= sum(vals)
    const net = new Map(vals.map((v, i) => [PEOPLE[i], v]))
    const nonzero = vals.filter((v) => v !== 0).length
    assert.equal(settlePlan(net).length, nonzero - bruteGroups(vals), `case ${vals}`)
  }
})

test('settle plan: beats the old greedy on the case it got wrong', () => {
  const net = new Map([['ana', 1000], ['ben', -600], ['cara', -400], ['dev', 700], ['eli', -700]])
  const plan = settlePlan(net)
  assert.equal(plan.length, 3) // greedy made 4
  assert.deepEqual(plan.map((t) => `${t.from}>${t.to}:${t.minor}`), ['eli>dev:700', 'ben>ana:600', 'cara>ana:400'])
})

test('settle plan: identical output however the balances are ordered (the iOS launch-to-launch bug)', () => {
  const r = rng(3)
  for (let t = 0; t < 1000; t++) {
    const n = 2 + Math.floor(r() * (PEOPLE.length - 1))
    const vals = Array.from({ length: n }, () => (Math.floor(r() * 5) - 2) * 1000) // many ties on purpose
    vals[0] -= sum(vals)
    const entries = vals.map((v, i) => [PEOPLE[i], v] as [string, number])
    const a = settlePlan(new Map(entries))
    const b = settlePlan(new Map([...entries].reverse()))
    assert.deepEqual(a, b)
  }
})

test('settle plan: tiny debts are real debts — nothing under 0,50 € silently vanishes', () => {
  const plan = settlePlan(new Map([['ana', 45], ['ben', 500], ['cara', -545]]))
  assert.equal(sum(plan.map((t) => t.minor)), 545)
})

test('settle plan: fast enough to run on every change', () => {
  const vals = Array.from({ length: EXACT_LIMIT }, (_, i) => (i % 2 ? 1 : -1) * (1000 + i * 37))
  vals[0] -= sum(vals)
  const net = new Map(vals.map((v, i) => ['p' + String(i).padStart(2, '0'), v]))
  const t0 = performance.now()
  for (let i = 0; i < 10; i++) settlePlan(net)
  const ms = (performance.now() - t0) / 10
  assert.ok(ms < 25, `${ms.toFixed(2)} ms at the exact limit`)
  // beyond the limit it still settles everything, just not provably minimally
  const big = new Map(Array.from({ length: 40 }, (_, i) => ['q' + i, i % 2 ? 100 : -100]))
  const plan = settlePlan(big)
  for (const v of applyPlan(big, plan).values()) assert.equal(v, 0)
  assert.ok(plan.length <= 39)
})

test('ledger: fast on years of history', () => {
  const { expenses, settles } = randomFlat(99, { people: 8, expenses: 5000, settles: 200 })
  const t0 = performance.now()
  buildLedger(expenses, settles)
  const ms = performance.now() - t0
  assert.ok(ms < 100, `${ms.toFixed(1)} ms for 5000 expenses`)
})

test('zeroSumGroups: every group sums to zero and every index appears once', () => {
  const g = zeroSumGroups([5, -5, 3, -1, -2, 7, -7])
  assert.equal(g.length, 3)
  assert.deepEqual(g.flat().sort(), [0, 1, 2, 3, 4, 5, 6])
})

// ------------------------------------------------------------------ parsing

test('parseMinor reads what people actually type', () => {
  const cases: [string, number | null][] = [
    ['12,50', 1250], ['12.50', 1250], ['12,5', 1250], ['12', 1200], ['0,1', 10], [',5', 50], ['5,', 500],
    ['1.200', 120000], ['1,200', 120000], ['1.234,56', 123456], ['1,234.56', 123456], ['1 234,56', 123456],
    ['1 234,56', 123456], ["1'234.50", 123450], ['1.234.567', 123456700], ['-3,20', -320], ['+7', 700],
    ['0,125', null], ['12,345,6', null], ['1.2.3', null], ['abc', null], ['', null], ['.', null], ['12.34.56', null],
    ['1.23,45', null], ['12a', null], ['0.500', null],
  ]
  for (const [s, want] of cases) assert.equal(parseMinor(s), want, JSON.stringify(s))
  assert.equal(parseMinor('1.234', 'KWD'), 1234) // three-decimal currency: a decimal point
  assert.equal(parseMinor('1.200', 'JPY'), 1200)
  assert.equal(parseMinor('12,5', 'JPY'), null)
})

test('minorToInput round-trips through parseMinor', () => {
  for (const v of [0, 1, 9, 10, 99, 100, 1250, 123456, -320]) assert.equal(parseMinor(minorToInput(v)), v)
  assert.equal(minorToInput(1250), '12,50')
  assert.equal(minorToInput(1200, 'JPY'), '1200')
})

test('toMinor survives what the database and the network send', () => {
  assert.equal(toMinor(0.29), 29) // 0.29 * 100 = 28.999999999999996
  assert.equal(toMinor(1.005), 101) // 1.005 * 100 = 100.49999999999999
  assert.equal(toMinor(-1.005), -101)
  assert.equal(toMinor(2.675), 268)
  assert.equal(toMinor(1e-7), 0)
  assert.equal(toMinor(123456789.99), 12345678999)
  assert.equal(toMinor('12.34'), 1234)
  assert.ok(Number.isNaN(toMinor(null)))
  assert.ok(Number.isNaN(toMinor('x')))
  assert.equal(Object.is(toMinor(-0.001), 0), true)
})
