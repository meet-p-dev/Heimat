import type { Cadence, Expense, Settlement, SplitItem, SplitType } from './types'

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
  Split `total` minor units in proportion to integer `weights`, so the parts add
  up to exactly `total` — the largest-remainder (Hamilton) method. Everyone gets
  floor(total × weight ÷ Σweights); the cents left over go one each to the
  largest remainders, and a tie between equal remainders goes to whoever sorts
  first by fnv1a(seed + ':' + person), then by id.

  Seeded by the expense id, the odd cent lands on a different person from one
  expense to the next — fair over a year of groceries, where "the payer always
  eats it" drifted real balances by up to 18 cents — yet the same expense
  always splits the same way, on every device, and editing its description or
  date moves nothing. Duplicate people add their weights; zero weights take no
  part; a negative total (a refund) splits the same way with the sign flipped.
  The arithmetic is BigInt, so no product of amount and weight can overflow.
*/
export function allocateWeighted(total: number, weights: ReadonlyArray<readonly [string, number]>, seed: string): Map<string, number> {
  const out = new Map<string, number>()
  if (!Number.isSafeInteger(total)) return out
  const w = new Map<string, bigint>()
  for (const [u, x] of weights) {
    if (!u) continue
    if (!Number.isSafeInteger(x) || x < 0) return new Map()
    if (x) w.set(u, (w.get(u) ?? 0n) + BigInt(x))
  }
  if (!w.size) return out
  let W = 0n
  for (const v of w.values()) W += v
  const T = BigInt(Math.abs(total))
  const rows = [...w].map(([u, v]) => ({ u, base: (T * v) / W, rem: (T * v) % W, k: fnv1a(seed + ':' + u) }))
  let extra = T
  for (const r of rows) extra -= r.base
  rows.sort((a, b) => (a.rem !== b.rem ? (a.rem > b.rem ? -1 : 1) : a.k - b.k || cmp(a.u, b.u)))
  for (const r of rows) {
    let v = r.base
    if (extra > 0n) { v += 1n; extra -= 1n }
    const n = Number(v)
    out.set(r.u, total < 0 && n ? -n : n)
  }
  return out
}

/* an equal split: the weighted split with everyone weighing 1 */
export function allocate(total: number, people: readonly string[], seed: string): Map<string, number> {
  return allocateWeighted(total, [...new Set(people.filter(Boolean))].map((u) => [u, 1] as const), seed)
}

// --------------------------------------------------------------------- splits

/* no single bill is larger than this many minor units (a billion euros); keeps every product exact everywhere */
export const MAX_MINOR = 100_000_000_000

export type SplitError =
  | { code: 'empty' }                          // nobody to split between
  | { code: 'too_large' }
  | { code: 'bad_value'; who?: string }        // not a number, negative, or too many decimals
  | { code: 'sum_mismatch'; diff: number }     // exact amounts / payers / items: short (−) or over (+) by this many minor units
  | { code: 'percent_total'; diff: number }    // percentages: off 100 % by this many basis points
  | { code: 'remainder_negative'; diff: number } // adjustments add up to more than the bill
  | { code: 'not_in_split'; who: string }      // an adjustment for someone the bill is not split between
  | { code: 'unknown_type' }

export type SplitResult = { ok: true; shares: Map<string, number> } | { ok: false; error: SplitError }

export interface SplitSpec {
  type: SplitType
  /* equal and adjust: who shares it */
  among?: readonly string[]
  /* exact: minor units · percent: basis points · shares: a weight with up to two decimals · adjust: ± minor units */
  values?: Readonly<Record<string, number>>
  /* itemized */
  items?: ReadonlyArray<SplitItem>
  tax?: number; tip?: number; discount?: number
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const entries = (r: Readonly<Record<string, number>> | undefined) => Object.entries(r || {}).filter(([u]) => !!u).sort((a, b) => cmp(a[0], b[0]))

/* a share weight like 1.5 → 150; null if it has more than two decimals or is out of range. Read from
   the number's shortest decimal form, as Postgres reads the JSON — so 0.1 + 0.2 (0.30000000000000004)
   is refused everywhere rather than rounded here and refused there */
function weight100(v: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000) return null
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(v))
  return m ? Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0')) : null
}

/*
  What each person owes for one bill of `total` minor units, split as `spec`
  says — always whole minor units that add up to exactly `total`, or a reason
  it cannot be split that way. The same function gives the preview in the form
  and, in the database (split_shares), the figure that is stored.

  equal    — `among` share it equally.
  exact    — each person's amount is given; they must add up to the bill.
  percent  — basis points (10000 = 100 %) per person, adding up to exactly 100 %.
  shares   — weights (1, 2, 1.5 …); each pays in proportion.
  adjust   — each person's ± adjustment comes first, the rest is split equally
             between `among` (Splitwise's "split by adjustment").
  itemized — receipt lines, each split equally between the people who had it;
             tax and tip are then spread in proportion to what each person
             ordered, and a discount taken off the same way.
*/
export function computeShares(total: number, spec: SplitSpec, seed: string): SplitResult {
  if (!isInt(total)) return { ok: false, error: { code: 'bad_value' } }
  if (Math.abs(total) > MAX_MINOR) return { ok: false, error: { code: 'too_large' } }
  const sign = total < 0 ? -1 : 1
  switch (spec.type) {
    case 'equal': {
      const who = [...new Set((spec.among || []).filter(Boolean))]
      if (!who.length) return { ok: false, error: { code: 'empty' } }
      return { ok: true, shares: allocate(total, who, seed) }
    }
    case 'exact': {
      const vals = entries(spec.values)
      if (!vals.length) return { ok: false, error: { code: 'empty' } }
      const out = new Map<string, number>()
      let sum = 0
      for (const [u, v] of vals) {
        if (!isInt(v) || v * sign < 0) return { ok: false, error: { code: 'bad_value', who: u } }
        if (v) out.set(u, v)
        sum += v
      }
      if (sum !== total) return { ok: false, error: { code: 'sum_mismatch', diff: sum - total } }
      if (!out.size) return total === 0 ? { ok: true, shares: out } : { ok: false, error: { code: 'empty' } }
      return { ok: true, shares: out }
    }
    case 'percent': {
      const vals = entries(spec.values)
      if (!vals.length) return { ok: false, error: { code: 'empty' } }
      let bp = 0
      for (const [u, v] of vals) {
        if (!isInt(v) || v < 0 || v > 10_000) return { ok: false, error: { code: 'bad_value', who: u } }
        bp += v
      }
      if (bp !== 10_000) return { ok: false, error: { code: 'percent_total', diff: bp - 10_000 } }
      return { ok: true, shares: allocateWeighted(total, vals, seed) }
    }
    case 'shares': {
      const vals: [string, number][] = []
      for (const [u, v] of entries(spec.values)) {
        const w = weight100(v)
        if (w == null) return { ok: false, error: { code: 'bad_value', who: u } }
        if (w) vals.push([u, w])
      }
      if (!vals.length) return { ok: false, error: { code: 'empty' } }
      return { ok: true, shares: allocateWeighted(total, vals, seed) }
    }
    case 'adjust': {
      const who = [...new Set((spec.among || []).filter(Boolean))]
      if (!who.length) return { ok: false, error: { code: 'empty' } }
      let adj = 0
      for (const [u, v] of entries(spec.values)) {
        if (!isInt(v) || Math.abs(v) > MAX_MINOR) return { ok: false, error: { code: 'bad_value', who: u } }
        if (v && !who.includes(u)) return { ok: false, error: { code: 'not_in_split', who: u } }
        adj += v
      }
      const rest = total - adj
      if (rest * sign < 0) return { ok: false, error: { code: 'remainder_negative', diff: -rest * sign } }
      const out = allocate(rest, who, seed)
      for (const [u, v] of entries(spec.values)) if (v) out.set(u, (out.get(u) || 0) + v)
      return { ok: true, shares: out }
    }
    case 'itemized': {
      const items = spec.items || []
      if (!items.length) return { ok: false, error: { code: 'empty' } }
      const tax = spec.tax ?? 0, tip = spec.tip ?? 0, discount = spec.discount ?? 0
      for (const x of [tax, tip, discount]) if (!isInt(x) || x < 0 || x > MAX_MINOR) return { ok: false, error: { code: 'bad_value' } }
      const sub = new Map<string, number>()
      let itemsTotal = 0
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        const who = [...new Set((it.among || []).filter(Boolean))]
        if (!isInt(it.minor) || it.minor < 0 || it.minor > MAX_MINOR) return { ok: false, error: { code: 'bad_value' } }
        if (!who.length) return { ok: false, error: { code: 'empty' } }
        itemsTotal += it.minor
        for (const [u, v] of allocate(it.minor, who, `${seed}:item:${i}`)) sub.set(u, (sub.get(u) || 0) + v)
      }
      // signed: a refund's receipt is entered as positive lines against a negative bill
      const expected = (itemsTotal + tax + tip - discount) * sign
      if (expected !== total) return { ok: false, error: { code: 'sum_mismatch', diff: expected - total } }
      const extra = (tax + tip - discount) * sign
      const weights = [...sub].filter(([, v]) => v > 0).sort((a, b) => cmp(a[0], b[0]))
      if (extra && !weights.length) return { ok: false, error: { code: 'empty' } }
      const out = new Map<string, number>()
      for (const [u, v] of sub) out.set(u, v * sign)
      for (const [u, v] of allocateWeighted(extra, weights, `${seed}:extra`)) out.set(u, (out.get(u) || 0) + v)
      return { ok: true, shares: out }
    }
    default:
      return { ok: false, error: { code: 'unknown_type' } }
  }
}

/* who paid how much: `payers` when more than one person did (they must add up to the bill), else the payer alone */
export function computePaid(total: number, payers: Readonly<Record<string, number>> | null | undefined, paidBy: string): SplitResult {
  const vals = entries(payers || undefined)
  if (!vals.length) return paidBy ? { ok: true, shares: new Map([[paidBy, total]]) } : { ok: false, error: { code: 'empty' } }
  const sign = total < 0 ? -1 : 1
  const out = new Map<string, number>()
  let sum = 0
  for (const [u, v] of vals) {
    if (!isInt(v) || v * sign < 0) return { ok: false, error: { code: 'bad_value', who: u } }
    if (v) out.set(u, v)
    sum += v
  }
  if (sum !== total) return { ok: false, error: { code: 'sum_mismatch', diff: sum - total } }
  return { ok: true, shares: out }
}

/* the split an expense row describes; rows from before engine v2 are equal splits */
export function specOf(e: Pick<Expense, 'split_type' | 'split' | 'split_among' | 'paid_by'>): SplitSpec {
  const type = e.split_type || 'equal'
  const among = participantsOf(e)
  const d = e.split || {}
  if (type === 'itemized') return { type, items: d.items || [], tax: d.tax, tip: d.tip, discount: d.discount }
  return { type, among, values: d.values }
}

// ------------------------------------------------------------------- postings

/* everyone the bill is split between; an empty split means the payer alone */
export const participantsOf = (e: Pick<Expense, 'split_among' | 'paid_by'>): string[] =>
  e.split_among && e.split_among.length ? [...new Set(e.split_among)] : [e.paid_by]

export interface Postings {
  currency: string
  total: number
  /* minor units each person put down */
  paid: Map<string, number>
  /* minor units each person owes for it */
  owed: Map<string, number>
}

type ExpenseRow = Pick<Expense, 'id' | 'amount' | 'currency' | 'paid_by' | 'split_among'> & Partial<Pick<Expense, 'split_type' | 'split' | 'payers' | 'shares'>>

/*
  One expense as postings: what each person paid, and what each owes. The
  shares stored by the database win — they are the record, and a later change
  to the rules must never re-split an old bill; they are used only when they
  add up to the bill. Otherwise (rows from before shares were stored, or a
  preview before saving) they are worked out from the split. Null when the row
  cannot be read.
*/
export function postingsOf(e: ExpenseRow, cur?: string): Postings | null {
  const currency = e.currency || cur || 'EUR'
  const total = toMinor(e.amount, currency)
  if (!Number.isSafeInteger(total) || !e.paid_by) return null
  const paid = computePaid(total, e.payers, e.paid_by)
  if (!paid.ok) return null
  let owed: Map<string, number> | null = null
  if (e.shares && typeof e.shares === 'object') {
    const m = new Map<string, number>()
    let sum = 0, fine = true
    for (const [u, v] of Object.entries(e.shares)) { if (!isInt(v)) { fine = false; break } if (v) m.set(u, v); sum += v }
    if (fine && sum === total && (m.size || total === 0)) owed = m
  }
  if (!owed) {
    const r = computeShares(total, specOf(e), e.id)
    if (!r.ok) return null
    owed = r.shares
  }
  return { currency, total, paid: paid.shares, owed }
}

/* each participant's share of one expense, in minor units: the order the expense lists them, then anyone else */
export function sharesOf(e: ExpenseRow): { uid: string; minor: number }[] {
  const p = postingsOf(e)
  if (!p) return []
  const listed = participantsOf(e).filter((u) => p.owed.has(u))
  const rest = [...p.owed.keys()].filter((u) => !listed.includes(u)).sort(cmp)
  return [...listed, ...rest].map((uid) => ({ uid, minor: p.owed.get(uid) ?? 0 }))
}

/* one person's share of one expense in major units; 0 if they are not in it */
export function shareOf(e: ExpenseRow, uid: string | null | undefined): number {
  if (!uid) return 0
  const s = sharesOf(e).find((x) => x.uid === uid)
  return s ? toMajor(s.minor, e.currency) : 0
}

/* a person's total share across expenses (their spending), summed in minor units — of one
   currency when given (the flat's main one, say): minor units of two currencies never add up */
export function myShareMinor(expenses: Expense[], uid: string | null | undefined, currency?: string): number {
  if (!uid) return 0
  let t = 0
  for (const e of expenses) if (!currency || (e.currency || currency) === currency) t += postingsOf(e)?.owed.get(uid) ?? 0
  return t
}

/*
  Who owes whom for one expense. Each person is up (paid more than their share)
  or down (paid less); everyone down owes the people up, in proportion to how
  far up each of them is. Debtors are taken in id order and each is split over
  what the creditors are still owed, so every creditor ends exactly square —
  the per-pair figures add up to each person's balance to the cent. With one
  payer this is simply: everyone owes the payer their share.
*/
export function debtsOf(p: Postings, seed: string): { from: string; to: string; minor: number }[] {
  const people = new Set([...p.paid.keys(), ...p.owed.keys()])
  const net: [string, number][] = [...people].map((u) => [u, (p.paid.get(u) || 0) - (p.owed.get(u) || 0)] as [string, number]).sort((a, b) => cmp(a[0], b[0]))
  const cap = new Map(net.filter(([, v]) => v > 0))
  const out: { from: string; to: string; minor: number }[] = []
  for (const [d, v] of net) {
    if (v >= 0) continue
    const split = allocateWeighted(-v, [...cap].filter(([, c]) => c > 0), `${seed}:${d}`)
    for (const [c, m] of split) {
      if (!m) continue
      out.push({ from: d, to: c, minor: m })
      cap.set(c, (cap.get(c) || 0) - m)
    }
  }
  return out
}

// -------------------------------------------------------------------- ledger

export interface Owe { from: string; to: string; minor: number; amount: number }

export interface Book {
  currency: string
  /* minor units, for everyone who appears in any expense or settlement in
     this currency — including people who have left — so it sums to exactly 0 */
  netMinor: Map<string, number>
  /* the same, in major units, for display */
  net: Record<string, number>
  /* who owes whom, pair by pair — what people actually owe each other, netted
     within each pair and nowhere else. Largest first. */
  owes: Owe[]
}

export interface Ledger extends Book {
  /* one book per currency the flat's money is in; the flat's main one is also spread on the ledger itself */
  books: Map<string, Book>
  /* expenses in another currency than the main one: kept in their own book,
     never added to these figures as bare numbers */
  excluded: Expense[]
  /* rows that could not be read (no amount, no payer, a split that does not add up) */
  invalid: (Expense | Settlement)[]
}

/* the currency most of a flat's live expenses are in (ties: alphabetical); a flat
   with none takes the one most of its payments were recorded in, then the fallback */
export function flatCurrency(expenses: Expense[], fallback = 'EUR', settles: Settlement[] = []): string {
  const most = (cs: (string | null | undefined)[]) => {
    const n = new Map<string, number>()
    for (const c of cs) if (c) n.set(c, (n.get(c) || 0) + 1)
    let best = '', c = 0
    for (const [k, v] of n) if (v > c || (v === c && cmp(k, best) < 0)) { best = k; c = v }
    return best
  }
  return most(expenses.filter(e => !e.deleted_at).map(e => e.currency)) || most(settles.map(s => s.currency)) || fallback
}

export function buildLedger(expenses: Expense[], settles: Settlement[], fallbackCur = 'EUR'): Ledger {
  const currency = flatCurrency(expenses, fallbackCur, settles)
  type Acc = { net: Map<string, number>; pair: Map<string, number> }
  const acc = new Map<string, Acc>()
  const bookFor = (c: string) => { let a = acc.get(c); if (!a) acc.set(c, (a = { net: new Map(), pair: new Map() })); return a }
  const excluded: Expense[] = [], invalid: (Expense | Settlement)[] = []
  const bump = (a: Acc, u: string, v: number) => a.net.set(u, (a.net.get(u) || 0) + v)
  const owe = (a: Acc, debtor: string, creditor: string, v: number) => {
    if (debtor === creditor || !v) return
    const lo = debtor < creditor
    const k = lo ? debtor + '\u0000' + creditor : creditor + '\u0000' + debtor
    a.pair.set(k, (a.pair.get(k) || 0) + (lo ? v : -v))
  }
  bookFor(currency)

  for (const e of expenses) {
    if (e.deleted_at) continue
    const c = e.currency || currency
    const p = postingsOf(e, c)
    if (!p) { invalid.push(e); continue }
    if (c !== currency) excluded.push(e)
    const a = bookFor(c)
    for (const [u, v] of p.paid) bump(a, u, v)
    for (const [u, v] of p.owed) bump(a, u, -v)
    for (const d of debtsOf(p, e.id)) owe(a, d.from, d.to, d.minor)
  }
  for (const s of settles) {
    const c = s.currency || currency
    const m = toMinor(s.amount, c)
    if (!Number.isSafeInteger(m) || !s.from_user || !s.to_user || s.from_user === s.to_user) { invalid.push(s); continue }
    const a = bookFor(c)
    bump(a, s.from_user, m)
    bump(a, s.to_user, -m)
    owe(a, s.from_user, s.to_user, -m) // paying someone back reduces what you owe them
  }

  const books = new Map<string, Book>()
  for (const [c, a] of [...acc].sort((x, y) => (x[0] === currency ? -1 : y[0] === currency ? 1 : cmp(x[0], y[0])))) {
    const owes: Owe[] = []
    for (const [k, v] of a.pair) {
      if (!v) continue
      const [lo, hi] = k.split('\u0000')
      const minor = Math.abs(v)
      owes.push({ from: v > 0 ? lo : hi, to: v > 0 ? hi : lo, minor, amount: toMajor(minor, c) })
    }
    owes.sort(byTransfer)
    const net: Record<string, number> = {}
    for (const [u, v] of a.net) net[u] = toMajor(v, c)
    books.set(c, { currency: c, netMinor: a.net, net, owes })
  }
  const main = books.get(currency)!
  return { ...main, books, excluded, invalid }
}

// ---------------------------------------------------------------- currencies

/* "0.09563" → [9563n, 5]: an exchange rate as an exact decimal; null if it is not a positive decimal */
function decimal(rate: string): [bigint, number] | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim())
  if (!m) return null
  const frac = m[2] || ''
  const n = BigInt(m[1] + frac)
  return n > 0n ? [n, frac.length] : null
}

/*
  Everyone's balances across several currencies, as one figure in `target` —
  for showing, never for rewriting history: the books stay in the currency the
  money was spent in. `rates[c]` is how many `target` units one `c` buys, as a
  decimal string (1 SEK = "0.09563" USD), so nothing is lost to binary
  fractions. The exact converted values are rounded with the largest-remainder
  method, so the converted balances still sum to exactly zero. Books whose
  rate is missing are left out and listed.
*/
export function convertNet(books: Iterable<Book>, target: string, rates: Readonly<Record<string, string>>): { net: Map<string, number>; missing: string[] } {
  const dt = minorDigits(target)
  const terms: { net: Map<string, number>; num: bigint; shift: number }[] = []
  const missing: string[] = []
  for (const b of books) {
    const r = b.currency === target ? ([1n, 0] as [bigint, number]) : rates[b.currency] != null ? decimal(String(rates[b.currency])) : null
    if (!r) { missing.push(b.currency); continue }
    // value in target minor units = net × num × 10^dt / 10^(frac + dc)
    terms.push({ net: b.netMinor, num: r[0] * 10n ** BigInt(dt), shift: r[1] + minorDigits(b.currency) })
  }
  const F = terms.reduce((m, t) => Math.max(m, t.shift), 0)
  const D = 10n ** BigInt(F)
  const exact = new Map<string, bigint>()
  for (const t of terms) {
    const k = t.num * 10n ** BigInt(F - t.shift)
    for (const [u, v] of t.net) exact.set(u, (exact.get(u) ?? 0n) + BigInt(v) * k)
  }
  const floorDiv = (a: bigint) => (a >= 0n ? a / D : -((-a + D - 1n) / D))
  const rows = [...exact].map(([u, x]) => { const f = floorDiv(x); return { u, f, rem: x - f * D } })
  let short = 0n
  for (const r of rows) short -= r.f // the floors undershoot zero by this many units
  rows.sort((a, b) => (a.rem !== b.rem ? (a.rem > b.rem ? -1 : 1) : cmp(a.u, b.u)))
  const net = new Map<string, number>()
  for (const r of rows) {
    let v = r.f
    if (short > 0n && r.rem > 0n) { v += 1n; short -= 1n }
    net.set(r.u, Number(v))
  }
  return { net, missing: missing.sort(cmp) }
}

// ----------------------------------------------------------------- recurring

const MONTHS_OF: Record<Cadence, number> = { weekly: 0, biweekly: 0, monthly: 1, quarterly: 3, yearly: 12 }
const DAYS_OF: Record<Cadence, number> = { weekly: 7, biweekly: 14, monthly: 0, quarterly: 0, yearly: 0 }
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/*
  The date of the `n`th time a recurring expense falls due (n = 0 is the
  first). Always counted from the first date, never from the previous one, so
  rent set up for the 31st lands on the 28th/29th in February and back on the
  31st in March — never skipped, never drifting to the 28th for good, and a
  yearly one on 29 February falls on the 28th in other years. Calendar dates
  only; no time zones.
*/
export function occurrence(anchor: string, cadence: Cadence, n: number): string {
  const y = +anchor.slice(0, 4), m = +anchor.slice(5, 7) - 1, d = +anchor.slice(8, 10)
  if (DAYS_OF[cadence]) {
    const t = new Date(Date.UTC(y, m, d + n * DAYS_OF[cadence]))
    return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
  }
  const k = m + n * MONTHS_OF[cadence]
  const yy = y + Math.floor(k / 12), mm = ((k % 12) + 12) % 12
  return iso(yy, mm, Math.min(d, daysIn(yy, mm)))
}

/* the occurrences from number `fromN` that are due by `today` (and not after `until`), oldest first — at most `limit` */
export function dueOccurrences(anchor: string, cadence: Cadence, fromN: number, today: string, until?: string | null, limit = 400): { n: number; date: string }[] {
  const out: { n: number; date: string }[] = []
  for (let n = fromN; out.length < limit; n++) {
    const date = occurrence(anchor, cadence, n)
    if (date > today || (until && date > until)) break
    out.push({ n, date })
  }
  return out
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
