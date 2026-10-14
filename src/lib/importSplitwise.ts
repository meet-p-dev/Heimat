/* Bringing a group over from Splitwise (Group → Settings → Export as spreadsheet).

   The file has one row per expense or payment: Date, Description, Category, Cost, Currency,
   then one column per person holding what that person paid minus what they owed. The last
   row is everyone's "Total balance". Splitlife needs who paid and who owes, so each row is
   rebuilt from those per-person figures so that every balance comes out exactly the same:

   - one person up (paid more than their share): they paid the whole cost; everyone down owes
     what they are down; the payer's own share is the rest;
   - several people up: they paid; what is left of the cost after everyone down is split
     equally among them as their own share (largest remainder, in column order), and each paid
     their share plus what they are up;
   - a row Splitwise calls a "Payment": the person up paid the person down;
   - a row whose cost doesn't fit (a refund, a negative amount, rounding): the cost becomes what
     the people up are up, so the balances still move exactly as in Splitwise;
   - a row where nobody is up or down changes no balance and is left out.

   The server (import_group) refuses the import unless everyone ends up exactly where this file
   says. The iPhone app (ios-native/Heimat/SplitwiseImport.swift) is held to the same answers
   by tests/splitwise-import-vectors.json. */
import { minorDigits, parseMinor } from './ledger.ts'
import { builtinCategory } from './suggest.ts'

export interface SwPerson { key: string; name: string }
export interface SwExpense { d: string; t: string; c: string; cur: string; total: number; paid: Record<string, number>; owed: Record<string, number> }
export interface SwPayment { d: string; t: string; from: string; to: string; cur: string; total: number }
export interface SwFile {
  name: string
  people: SwPerson[]
  expenses: SwExpense[]
  payments: SwPayment[]
  /* what everyone ends up at, per currency: "key|EUR" → minor units (non-zero only) */
  balances: Record<string, number>
  /* Splitwise's own "Total balance" row agrees with the rows: yes, off by rounding (a few
     cents), no, or there is no such row (or it can't be compared) */
  totals: 'yes' | 'rounding' | 'no' | 'none'
  /* rows that change no balance, and rows that couldn't be read (line numbers) */
  skipped: number
  bad: number[]
  from: string | null
  to: string | null
  currencies: string[]
}
export type SwResult = { ok: true; file: SwFile } | { ok: false; error: 'not_splitwise' | 'empty' | 'too_large' }

const MAX_ROWS = 5000
const MAX_PEOPLE = 49

/* Splitwise's categories → Splitlife's; anything else is guessed from the description */
const CATEGORY: [RegExp, string][] = [
  [/^(rent|mortgage)$/, 'rent'],
  [/^(groceries|liquor)$/, 'groceries'],
  [/^(electricity|heat\/gas|water|utilities - other|trash|cleaning)$/, 'utilities'],
  [/^(tv\/phone\/internet)$/, 'internet'],
  [/^(dining out|food and drink - other)$/, 'eatout'],
  [/^(bus\/train|car|gas\/fuel|parking|plane|taxi|transportation - other|bicycle)$/, 'transport'],
  [/^(household supplies|furniture|maintenance|home - other|electronics|pets|services)$/, 'household'],
]
export function categoryOf(splitwise: string, description: string): string {
  const s = splitwise.trim().toLowerCase()
  for (const [re, c] of CATEGORY) if (re.test(s)) return c
  return builtinCategory(description) || 'other'
}

const PAYMENT = /^(payment|zahlung|pago|paiement|pagamento|betaling|płatność)$/i
const TOTAL = /^(total balance|gesamtsaldo|saldo total|solde total|saldo totale|totaal saldo|total)$/i

function splitCsv(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  return d > days ? null : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
/* "2024-01-31", "2024-01-31 18:20:00", "31.01.2024", "31/01/2024" */
export function swDate(s: string): string | null {
  const t = s.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t)
  if (m) return validDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t)
  if (m) return validDate(+m[3], +m[2], +m[1])
  return null
}

/* an amount in minor units; Splitwise writes two decimals even for yen ("1000.00"), so
   zeros beyond what the currency has are dropped first */
export function swAmount(s: string, cur: string): number | null {
  let t = s.trim()
  const m = /^([-−]?\d+)[.,](\d+)$/.exec(t)
  if (m && m[2].length > minorDigits(cur) && /^0+$/.test(m[2].slice(minorDigits(cur)))) {
    const keep = m[2].slice(0, minorDigits(cur))
    t = keep ? `${m[1]}.${keep}` : m[1]
  }
  return parseMinor(t, cur)
}

/* "wg-berlin_2024-05-03_export.csv" → "Wg berlin" */
export function nameFromFile(file: string): string {
  const s = file.replace(/\.[a-z0-9]+$/i, '').replace(/[_ -]*\d{4}-\d{2}-\d{2}[_ -]*export$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s && !/^export$/i.test(s) ? s[0].toUpperCase() + s.slice(1) : ''
}

/* `r` split equally among `keys` (in that order), largest remainder: the first ones get the odd cents */
function equalParts(r: number, keys: string[]): Map<string, number> {
  const out = new Map<string, number>()
  const base = Math.floor(r / keys.length)
  let left = r - base * keys.length
  for (const k of keys) { out.set(k, base + (left > 0 ? 1 : 0)); if (left > 0) left-- }
  return out
}

export function importSplitwise(text: string, fileName = ''): SwResult {
  const clean = text.replace(/^﻿/, '')
  const first = clean.split(/\r?\n/, 1)[0] || ''
  const count = (c: string) => first.split(c).length - 1
  const sep = count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ','
  const rows = splitCsv(clean, sep)
  const hi = rows.findIndex((r) => r.some((c) => c.trim() !== ''))
  if (hi < 0) return { ok: false, error: 'empty' }
  const head = rows[hi].map((c) => c.trim())
  // Date, Description, Category, Cost, Currency, then at least two people
  let last = head.length
  while (last > 5 && head[last - 1] === '') last--
  if (last < 7 || last - 5 > MAX_PEOPLE) return { ok: false, error: 'not_splitwise' }
  const people: SwPerson[] = head.slice(5, last).map((name, i) => ({ key: String(i), name: name || `Person ${i + 1}` }))
  const keys = people.map((p) => p.key)

  const expenses: SwExpense[] = [], payments: SwPayment[] = [], bad: number[] = []
  const balances = new Map<string, number>(), totals = new Map<string, number>()
  let skipped = 0, from: string | null = null, to: string | null = null
  const add = (k: string, cur: string, v: number) => { const id = `${k}|${cur}`; balances.set(id, (balances.get(id) || 0) + v) }

  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i].map((c) => c.trim())
    if (!r.some((c) => c !== '')) continue
    const line = i + 1
    const cur = (r[4] || '').toUpperCase()
    const nets = keys.map((_, j) => swAmount(r[5 + j] || '0', cur))
    // Splitwise's own total: no date, a "Total balance" description
    if (!swDate(r[0] || '') && TOTAL.test(r[1] || '')) {
      if (/^[A-Z]{3}$/.test(cur) && nets.every((n) => n !== null)) keys.forEach((k, j) => totals.set(`${k}|${cur}`, (totals.get(`${k}|${cur}`) || 0) + (nets[j] as number)))
      continue
    }
    const d = swDate(r[0] || '')
    const cost = swAmount(r[3] || '', cur)
    if (!d || !/^[A-Z]{3}$/.test(cur) || cost === null || nets.some((n) => n === null)) { bad.push(line); continue }
    const net = nets as number[]
    if (net.reduce((a, b) => a + b, 0) !== 0) { bad.push(line); continue }
    const up = keys.filter((_, j) => net[j] > 0), down = keys.filter((_, j) => net[j] < 0)
    const nk = (k: string) => net[+k]
    const sumUp = up.reduce((a, k) => a + nk(k), 0)
    if (!up.length) { skipped++; continue }
    if (expenses.length + payments.length >= MAX_ROWS) return { ok: false, error: 'too_large' }
    if (!from || d < from) from = d
    if (!to || d > to) to = d
    keys.forEach((k) => { if (nk(k)) add(k, cur, nk(k)) })

    const desc = (r[1] || '').slice(0, 200)
    if (PAYMENT.test(r[2] || '') && up.length === 1 && down.length === 1) {
      payments.push({ d, t: desc, from: up[0], to: down[0], cur, total: sumUp })
      continue
    }
    const total = cost >= sumUp && cost > 0 ? cost : sumUp
    const owed: Record<string, number> = {}, paid: Record<string, number> = {}
    for (const k of down) owed[k] = -nk(k)
    const mine = equalParts(total - sumUp, up)
    for (const k of up) {
      if (mine.get(k)) owed[k] = mine.get(k) as number
      paid[k] = nk(k) + (mine.get(k) as number)
    }
    expenses.push({ d, t: desc, c: categoryOf(r[2] || '', desc), cur, total, paid, owed })
  }
  if (!expenses.length && !payments.length) return bad.length ? { ok: false, error: 'not_splitwise' } : { ok: false, error: 'empty' }

  const bal: Record<string, number> = {}
  for (const [k, v] of [...balances].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (v) bal[k] = v
  let state: SwFile['totals'] = 'none'
  if (totals.size) {
    const ids = new Set([...Object.keys(bal), ...[...totals.keys()].filter((k) => totals.get(k))])
    let worst = 0
    for (const id of ids) worst = Math.max(worst, Math.abs((bal[id] || 0) - (totals.get(id) || 0)))
    state = worst === 0 ? 'yes' : worst <= 5 ? 'rounding' : 'no'
  }
  const currencies = [...new Set([...expenses.map((e) => e.cur), ...payments.map((p) => p.cur)])].sort()
  return { ok: true, file: { name: nameFromFile(fileName), people, expenses, payments, balances: bal, totals: state, skipped, bad, from, to, currencies } }
}

/* which column is you: your name (or its first word) as Splitwise wrote it */
export function guessMe(people: SwPerson[], myName: string): string | null {
  const n = myName.trim().toLowerCase()
  if (!n) return null
  const exact = people.find((p) => p.name.trim().toLowerCase() === n)
  if (exact) return exact.key
  const firstWord = n.split(/\s+/)[0]
  const hits = people.filter((p) => p.name.trim().toLowerCase().split(/\s+/)[0] === firstWord)
  return hits.length === 1 ? hits[0].key : null
}

/* what to send to import_group */
export function importPayload(f: SwFile, me: string, name: string, kind: 'group' | 'flat', hash: string) {
  return {
    source: 'splitwise', hash, name: name.trim() || f.name || 'From Splitwise', kind, me,
    people: f.people, balances: f.balances,
    expenses: f.expenses.map(({ d, t, c, cur, total, paid, owed }) => ({ d, t, c, cur, total, paid, owed })),
    payments: f.payments.map(({ d, t, from, to, cur, total }) => ({ d, t, from, to, cur, total })),
  }
}

/* a fingerprint of the file, so the same file isn't imported twice */
export async function fileHash(text: string): Promise<string> {
  const norm = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* "42 expenses and 3 payments, March 2024 – May 2025" */
export function swSummary(f: SwFile): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
  const parts = [f.expenses.length ? n(f.expenses.length, 'expense') : '', f.payments.length ? n(f.payments.length, 'payment') : ''].filter(Boolean)
  return parts.join(' and ')
}
