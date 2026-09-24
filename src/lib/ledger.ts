import type { Expense, Settlement } from './types'

/*
  Heimat's money engine.

  Every amount is handled as a whole number of the currency's smallest unit —
  cents, for euros — never as a binary fraction, which cannot hold 0,10 exactly
  and used to leave balances at 1e-12 instead of 0. An expense is turned into
  whole-cent shares that add up to exactly its total, and every figure the app
  shows — a share, a balance, who owes whom, the settle-up plan — is a sum of
  those same shares. So no two figures can disagree, and a flat's balances
  always add up to exactly zero.

  The same rules are implemented in ios-native/Heimat/Ledger.swift and in the
  database's flat_balance(); tests/ledger-vectors.json holds all three to
  identical answers. Change one, change all three, and regenerate the vectors.
*/

// ---------------------------------------------------------------- currencies

/* ISO 4217 minor-unit exponents that are not 2 */
const DIGITS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
}
const SCALE = [1, 10, 100, 1000]

export const minorDigits = (cur?: string | null): number => DIGITS[(cur || '').toUpperCase()] ?? 2

/*
  12.5 EUR → 1250. NaN for anything that is not a finite number.

  Shifts the decimal point in the number's shortest decimal form ("1.005" →
  "100.5") instead of multiplying in binary, where 1.005 × 100 is
  100.49999…, then rounds half away from zero. So it rounds what the number
  says, and Swift — which prints the same shortest digits — gets the same.
*/
export function toMinor(major: number | string | null | undefined, cur?: string | null): number {
  const n = typeof major === 'string' ? Number(major) : major
  if (typeof n !== 'number' || !Number.isFinite(n)) return NaN
  const d = minorDigits(cur), a = Math.abs(n), s = String(a)
  const shifted = /e/i.test(s) ? a * SCALE[d] : Number(s + 'e' + d)
  const v = Math.round(shifted)
  return v === 0 ? 0 : n < 0 ? -v : v // no -0
}

/* 1250 → 12.5. Always the double nearest the exact decimal, so formatting it
   never lands on a half-cent and web and iOS print the same digits. */
export const toMajor = (minor: number, cur?: string | null): number => minor / SCALE[minorDigits(cur)]

// ------------------------------------------------------------------- parsing

/*
  What someone typed, as minor units — or null if it is not an amount.

  Heimat prints German numbers ("1.234,56 €") to people from everywhere, so
  both conventions come back in: "1.234,56", "1,234.56", "12,5", "12.50",
  "1 200", "1'200.50". With both separators present the later one is the
  decimal point. A lone separator followed by exactly three digits is a
  thousands separator when the currency has fewer than three decimals —
  "1.200" is twelve hundred euros, not one euro twenty, because a euro amount
  cannot have three decimals. More decimals than the currency has is refused
  rather than silently rounded.
*/
export function parseMinor(input: string | null | undefined, cur?: string | null): number | null {
  const digits = minorDigits(cur)
  let s = String(input ?? '').replace(/[\s\u00a0\u202f'\u2019]/g, '')
  let sign = 1
  if (s.startsWith('-') || s.startsWith('−')) { sign = -1; s = s.slice(1) } else if (s.startsWith('+')) s = s.slice(1)
  if (!s || !/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null

  const dots = s.split('.').length - 1, commas = s.split(',').length - 1
  let intPart: string, frac = ''
  if (dots && commas) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const grp = dec === '.' ? ',' : '.'
    const at = s.lastIndexOf(dec)
    if (s.indexOf(dec) !== at) return null // two decimal points
    intPart = s.slice(0, at); frac = s.slice(at + 1)
    if (!groupedOk(intPart, grp)) return null
    intPart = intPart.split(grp).join('')
  } else if (dots + commas > 1) {
    const grp = dots ? '.' : ','
    if (!groupedOk(s, grp)) return null
    intPart = s.split(grp).join('')
  } else if (dots + commas === 1) {
    const at = s.search(/[.,]/)
    const before = s.slice(0, at), after = s.slice(at + 1)
    if (after.length === 3 && digits < 3 && /^[1-9]\d{0,2}$/.test(before)) intPart = before + after
    else { intPart = before; frac = after }
  } else intPart = s

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || frac.length > digits) return null
  if (intPart.replace(/^0+/, '').length > 13) return null // beyond any real bill, and beyond exact doubles
  const v = Number(intPart || '0') * SCALE[digits] + Number(frac.padEnd(digits, '0') || '0')
  return v === 0 ? 0 : sign * v
}

/* "1.234.567": first group 1-3 digits, every later group exactly 3 */
function groupedOk(s: string, grp: string): boolean {
  const g = s.split(grp)
  return /^\d{1,3}$/.test(g[0]) && g.slice(1).every((x) => /^\d{3}$/.test(x))
}

/* 1250 → "12,50", for pre-filling an input the user may then edit */
export function minorToInput(minor: number, cur?: string | null): string {
  const d = minorDigits(cur)
  const neg = minor < 0, a = Math.abs(minor)
  const whole = Math.floor(a / SCALE[d]), rest = a - whole * SCALE[d]
  return (neg ? '-' : '') + whole + (d ? ',' + String(rest).padStart(d, '0') : '')
}

// ---------------------------------------------------------------- allocation

const utf8 = new TextEncoder()

/* 32-bit FNV-1a over the UTF-8 bytes. Chosen because it is a few lines in
   TypeScript, Swift and SQL alike and gives all three the same number. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (const b of utf8.encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h >>> 0
}

/*
  Split `total` minor units between `people` so the parts add up to exactly
  `total` (largest-remainder / Hamilton apportionment; with equal weights every
  remainder ties, so the tiebreak decides it). Everyone gets the floor; the
  cents left over go one each to the people who sort first by
  fnv1a(seed + ':' + person). Seeded by the expense id, the odd cent lands on
  a different person from one expense to the next — fair over a year of
  groceries, where "the payer always eats it" drifted real balances by up to
  18 cents — yet the same expense always splits the same way, on every device,
  and editing its description or date moves nothing. Duplicates count once;
  a negative total (a refund) splits the same way with the sign flipped.
*/
export function allocate(total: number, people: readonly string[], seed: string): Map<string, number> {
  const who = [...new Set(people.filter(Boolean))]
  const out = new Map<string, number>()
  if (!who.length || !Number.isSafeInteger(total)) return out
  const abs = Math.abs(total), base = Math.floor(abs / who.length)
  let extra = abs - base * who.length
  const order = who
    .map((u) => ({ u, k: fnv1a(seed + ':' + u) }))
    .sort((a, b) => a.k - b.k || cmp(a.u, b.u))
  for (const { u } of order) {
    const v = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra--
    out.set(u, total < 0 && v ? -v : v)
  }
  return out
}

/* everyone the bill is split between; an empty split means the payer alone */
export const participantsOf = (e: Pick<Expense, 'split_among' | 'paid_by'>): string[] =>
  e.split_among && e.split_among.length ? [...new Set(e.split_among)] : [e.paid_by]

/* each participant's share of one expense, in minor units, in the order the expense lists them */
export function sharesOf(e: Pick<Expense, 'id' | 'amount' | 'currency' | 'paid_by' | 'split_among'>): { uid: string; minor: number }[] {
  const parts = participantsOf(e)
  const m = allocate(toMinor(e.amount, e.currency), parts, e.id)
  return parts.map((uid) => ({ uid, minor: m.get(uid) ?? 0 }))
}

/* one person's share of one expense in major units; 0 if they are not in it */
export function shareOf(e: Pick<Expense, 'id' | 'amount' | 'currency' | 'paid_by' | 'split_among'>, uid: string | null | undefined): number {
  if (!uid) return 0
  const s = sharesOf(e).find((x) => x.uid === uid)
  return s ? toMajor(s.minor, e.currency) : 0
}

/* a person's total share across expenses (their spending), summed in minor units */
export function myShareMinor(expenses: Expense[], uid: string | null | undefined): number {
  if (!uid) return 0
  let t = 0
  for (const e of expenses) for (const s of sharesOf(e)) if (s.uid === uid) t += s.minor
  return t
}

// -------------------------------------------------------------------- ledger

export interface Owe { from: string; to: string; minor: number; amount: number }

export interface Ledger {
  currency: string
  /* minor units, for everyone who appears in any expense or settlement —
     including people who have left — so it always sums to exactly 0 */
  netMinor: Map<string, number>
  /* the same, in major units, for display */
  net: Record<string, number>
  /* who owes whom, pair by pair — what people actually owe each other, netted
     within each pair and nowhere else. Largest first. */
  owes: Owe[]
  /* expenses in another currency: never added to these figures, because
     adding CHF to EUR as bare numbers is meaningless */
  excluded: Expense[]
  /* rows that could not be read (no amount, no payer) */
  invalid: (Expense | Settlement)[]
}

/* the currency most of a flat's expenses are in (ties: alphabetical); settlements carry none and follow it */
export function flatCurrency(expenses: Expense[], fallback = 'EUR'): string {
  const n = new Map<string, number>()
  for (const e of expenses) if (e.currency) n.set(e.currency, (n.get(e.currency) || 0) + 1)
  let best = '', c = 0
  for (const [k, v] of n) if (v > c || (v === c && cmp(k, best) < 0)) { best = k; c = v }
  return best || fallback
}

export function buildLedger(expenses: Expense[], settles: Settlement[], fallbackCur = 'EUR'): Ledger {
  const currency = flatCurrency(expenses, fallbackCur)
  const netMinor = new Map<string, number>()
  const pair = new Map<string, number>() // "lo\u0000hi" → what lo owes hi (negative: hi owes lo)
  const excluded: Expense[] = [], invalid: (Expense | Settlement)[] = []
  const bump = (u: string, v: number) => netMinor.set(u, (netMinor.get(u) || 0) + v)
  const owe = (debtor: string, creditor: string, v: number) => {
    if (debtor === creditor || !v) return
    const lo = debtor < creditor
    const k = lo ? debtor + '\u0000' + creditor : creditor + '\u0000' + debtor
    pair.set(k, (pair.get(k) || 0) + (lo ? v : -v))
  }

  for (const e of expenses) {
    if (e.currency && e.currency !== currency) { excluded.push(e); continue }
    const total = toMinor(e.amount, currency)
    if (!Number.isSafeInteger(total) || !e.paid_by) { invalid.push(e); continue }
    bump(e.paid_by, total)
    for (const [u, s] of allocate(total, participantsOf(e), e.id)) {
      bump(u, -s)
      owe(u, e.paid_by, s)
    }
  }
  for (const s of settles) {
    const a = toMinor(s.amount, currency)
    if (!Number.isSafeInteger(a) || !s.from_user || !s.to_user || s.from_user === s.to_user) { invalid.push(s); continue }
    bump(s.from_user, a)
    bump(s.to_user, -a)
    owe(s.from_user, s.to_user, -a) // paying someone back reduces what you owe them
  }

  const owes: Owe[] = []
  for (const [k, v] of pair) {
    if (!v) continue
    const [lo, hi] = k.split('\u0000')
    const minor = Math.abs(v)
    owes.push({ from: v > 0 ? lo : hi, to: v > 0 ? hi : lo, minor, amount: toMajor(minor, currency) })
  }
  owes.sort(byTransfer)
  const net: Record<string, number> = {}
  for (const [u, v] of netMinor) net[u] = toMajor(v, currency)
  return { currency, netMinor, net, owes, excluded, invalid }
}

/* what `uid` and each other person owe each other; positive: they owe `uid` */
export function pairwiseFor(owes: Owe[], uid: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const o of owes) {
    if (o.to === uid) out.set(o.from, (out.get(o.from) || 0) + o.minor)
    else if (o.from === uid) out.set(o.to, (out.get(o.to) || 0) - o.minor)
  }
  return out
}

// ---------------------------------------------------------------- settle up

export interface Transfer { from: string; to: string; minor: number; amount: number }

/* the exact solver's size limit: 2^12 subsets, about 0.6 ms on a phone */
export const EXACT_LIMIT = 12

/*
  The fewest payments that bring every balance to exactly zero.

  Finding that is NP-hard in general (it contains PARTITION), and the usual
  greedy — largest debtor pays largest creditor — needs more payments than
  necessary in about 30% of random flats, while the app promised "the fewest".
  For up to EXACT_LIMIT people with money outstanding this solves it exactly:
  a partition of the balances into the most groups that each sum to zero needs
  (people − groups) payments, which is the minimum; a bitmask dynamic
  programme over subsets finds that partition in O(3^n). Beyond the limit it
  falls back to the greedy, which never needs more than people − 1.

  Every tie is broken by id, so the plan is a pure function of the balances —
  identical across launches, devices and the two apps.
*/
export function settlePlan(net: Map<string, number> | Record<string, number>, cur?: string | null): Transfer[] {
  const entries = (net instanceof Map ? [...net] : Object.entries(net).map(([u, v]) => [u, toMinor(v, cur)] as [string, number]))
    .filter(([u, v]) => !!u && v !== 0 && Number.isSafeInteger(v))
    .sort((a, b) => cmp(a[0], b[0]))
  const groups = entries.length <= EXACT_LIMIT ? zeroSumGroups(entries.map(([, v]) => v)) : [entries.map((_, i) => i)]
  const out: Transfer[] = []
  for (const g of groups) {
    for (const t of greedy(g.map((i) => entries[i]))) out.push({ ...t, amount: toMajor(t.minor, cur) })
  }
  return out.sort(byTransfer)
}

/* indices of `vals` partitioned into the most subsets that each sum to zero */
export function zeroSumGroups(vals: number[]): number[][] {
  const n = vals.length
  if (!n) return []
  const full = (1 << n) - 1
  const sums = new Float64Array(full + 1)
  for (let m = 1; m <= full; m++) {
    const low = m & -m
    sums[m] = sums[m ^ low] + vals[31 - Math.clz32(low)]
  }
  const best = new Uint8Array(full + 1), pick = new Int32Array(full + 1)
  for (let m = 1; m <= full; m++) {
    const low = m & -m
    let b = best[m ^ low], p = 0 // the lowest person in no zero-sum group
    for (let sub = m; sub > 0; sub = (sub - 1) & m) {
      if (sub & low && sums[sub] === 0 && 1 + best[m ^ sub] > b) { b = 1 + best[m ^ sub]; p = sub }
    }
    best[m] = b; pick[m] = p
  }
  const groups: number[][] = [], rest: number[] = []
  for (let m = full; m > 0;) {
    const low = m & -m, p = pick[m]
    if (p) { groups.push(bits(p)); m ^= p } else { rest.push(31 - Math.clz32(low)); m ^= low }
  }
  if (rest.length) groups.push(rest) // unreachable when the balances sum to zero
  return groups
}

const bits = (m: number) => { const o: number[] = []; for (let i = 0; m; i++, m >>>= 1) if (m & 1) o.push(i); return o }

/* largest debtor pays largest creditor; ties by id. Within a zero-sum group of k people this makes exactly k − 1 payments. */
function greedy(entries: [string, number][]): { from: string; to: string; minor: number }[] {
  const byAmount = (a: { u: string; v: number }, b: { u: string; v: number }) => b.v - a.v || cmp(a.u, b.u)
  const debt = entries.filter(([, v]) => v < 0).map(([u, v]) => ({ u, v: -v })).sort(byAmount)
  const cred = entries.filter(([, v]) => v > 0).map(([u, v]) => ({ u, v })).sort(byAmount)
  const out: { from: string; to: string; minor: number }[] = []
  for (let i = 0, j = 0; i < debt.length && j < cred.length;) {
    const pay = Math.min(debt[i].v, cred[j].v)
    out.push({ from: debt[i].u, to: cred[j].u, minor: pay })
    debt[i].v -= pay; cred[j].v -= pay
    if (!debt[i].v) i++
    if (!cred[j].v) j++
  }
  return out
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byTransfer = (a: { from: string; to: string; minor: number }, b: { from: string; to: string; minor: number }) =>
  b.minor - a.minor || cmp(a.from, b.from) || cmp(a.to, b.to)
