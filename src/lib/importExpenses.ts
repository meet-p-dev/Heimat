/* Bringing a group over from another app: Splitwise, Tricount, Settle Up, Splid, or any
   spreadsheet of shared expenses (CSV, or Excel through xlsx.ts).

   None of them but Splitwise documents its export, so the file is recognised by its layout
   rather than by its app. Every layout ends up as who paid what and who owes what per row,
   in minor units — or, where a row only says how far each person is up or down, those
   figures — and the import is refused by the server (import_group) unless everyone ends up
   exactly where the rows say. The layouts:

   - net       one column per person, paid minus owed (Splitwise: Date, Description, Category,
               Cost, Currency, people…; a "Total balance" row at the end is checked against);
   - paidfor   "Paid by X" and "Paid for X" columns for each person (Tricount, Sesterce);
   - shares    a "Who paid" column and a column per person with their share (Settle Up);
   - list      a "Who paid" column and an optional "For whom" column naming people, split
               equally (Splid and plain spreadsheets) — also what "which column is what?" gives.

   A row with exact amounts that add up is kept as it is: one or more payers, each person's
   share. A row whose amounts can't stand as an expense (income, a refund, a negative cost) is
   rebuilt from how far each person is up or down, so balances still move exactly as in the
   file:
   - one person up: they paid the whole cost; everyone down owes what they are down;
   - several people up: what is left of the cost after everyone down is split equally among
     them as their own share (largest remainder, in column order);
   - a row where nobody is up or down changes no balance and is left out.
   A payment ("Payment" in Splitwise, a transfer or reimbursement elsewhere) between exactly
   two people becomes a payment.

   The iPhone app (ios-native/Heimat/ExpenseImport.swift) is held to the same answers by
   tests/expense-import-vectors.json. */
import { minorDigits, parseMinor } from './ledger.ts'
import { builtinCategory } from './suggest.ts'

export interface SwPerson { key: string; name: string }
export interface SwExpense { d: string; t: string; c: string; cur: string; total: number; paid: Record<string, number>; owed: Record<string, number> }
export interface SwPayment { d: string; t: string; from: string; to: string; cur: string; total: number }
export type Layout = 'net' | 'paidfor' | 'shares' | 'list'
export interface SwFile {
  name: string
  layout: Layout
  people: SwPerson[]
  expenses: SwExpense[]
  payments: SwPayment[]
  /* what everyone ends up at, per currency: "key|EUR" → minor units (non-zero only) */
  balances: Record<string, number>
  /* Splitwise's own "Total balance" row agrees with the rows: yes, off by rounding (a few
     cents), no, or there is no such row */
  totals: 'yes' | 'rounding' | 'no' | 'none'
  /* rows that change no balance, and rows that couldn't be read (line numbers) */
  skipped: number
  bad: number[]
  from: string | null
  to: string | null
  currencies: string[]
}
/* which column is what, when the file isn't recognised by itself (column numbers, -1 = none) */
export interface ColumnMap { date: number; description: number; amount: number; payer: number; forWhom: number; currency: number; category: number }
export type SwResult =
  | { ok: true; file: SwFile }
  | { ok: false; error: 'empty' | 'too_large' }
  | { ok: false; error: 'not_recognised'; header: string[]; sample: string[][] }
export interface ReadOpts { fileName?: string; currency?: string; map?: ColumnMap }

const MAX_ROWS = 5000
const MAX_PEOPLE = 49

// ------------------------------------------------------------------ reading cells

const cut = (s: string) => s.trim().replace(/\s+/g, ' ')
const low = (s: string) => cut(s).toLowerCase()

export function splitCsv(text: string, sep: string): string[][] {
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

/* a CSV's rows: comma, semicolon or tab, whichever the first line uses most */
export function csvTable(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const first = clean.split(/\r?\n/, 1)[0] || ''
  const count = (c: string) => first.split(c).length - 1
  const sep = count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ','
  return splitCsv(clean, sep)
}

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  return d > days ? null : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mär: 3, mae: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12,
}
/* "2024-01-31", "2024-01-31 18:20:00", "2024/01/31", "20240131", "31.01.2024", "31/01/24",
   "01/31/2024" when the file writes the month first, "31 Jan 2024", "Jan 31, 2024", and an
   Excel day number (45322) */
export function swDate(s: string, monthFirst = false): string | null {
  const t = cut(s).replace(/[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*([ap]\.?m\.?)?(\s*(z|[+-]\d{2}:?\d{2}))?$/i, '').trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t)
  if (m) return validDate(+m[1], +m[2], +m[3])
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t)
  if (m) return validDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return monthFirst ? validDate(y, +m[1], +m[2]) : validDate(y, +m[2], +m[1])
  }
  m = /^(\d{1,2})\.?\s+([a-zäé]{3,})\.?,?\s+(\d{4})$/i.exec(t)
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return validDate(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1])
  m = /^([a-zäé]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(t)
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return validDate(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2])
  m = /^(\d{5})(\.\d+)?$/.exec(t)
  if (m && +m[1] >= 36526 && +m[1] <= 73050) {
    // Excel's day 1 is 1 Jan 1900, counted as if 1900 were a leap year: day 25569 is 1 Jan 1970
    const d = new Date((+m[1] - 25569) * 86400000)
    return validDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  return null
}
/* does the file write the month first? only when some date can't be day-first */
function monthFirstIn(cells: string[]): boolean {
  let dayFirst = false, monthFirst = false
  for (const c of cells) {
    const m = /^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}/.exec(cut(c))
    if (!m) continue
    if (+m[1] > 12) dayFirst = true
    if (+m[2] > 12) monthFirst = true
  }
  return monthFirst && !dayFirst
}

const SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP', '$': 'USD', 'US$': 'USD', '₹': 'INR', '¥': 'JPY', '₩': 'KRW', 'CHF': 'CHF', 'zł': 'PLN', 'kr': 'SEK', '₺': 'TRY', 'R$': 'BRL', 'A$': 'AUD', 'C$': 'CAD' }
export function currencyOf(s: string, fallback: string): string {
  const t = cut(s)
  if (!t) return fallback.toUpperCase()
  return SYMBOLS[t] || t.toUpperCase()
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
/* a spreadsheet amount: as above, a currency sign or code around it allowed, and a computed
   share with more decimals than the currency has ("33.333333333333336") rounded half away from
   zero — the row is then evened out to its total */
export function sheetAmount(s: string, cur: string): number | null {
  const t = s.trim().replace(/^[^\d\-−+.,]+|[^\d.,]+$/g, '').trim()
  if (!t) return s.trim() ? null : 0
  const exact = swAmount(t, cur)
  if (exact !== null) return exact
  const m = /^([-−]?)(\d+)\.(\d+)$/.exec(t)
  if (!m) return null
  const dg = minorDigits(cur)
  const scaled = Number(`${m[2]}.${m[3]}`) * 10 ** dg
  const v = Math.round(scaled + 1e-9)
  return m[1] ? -v : v
}

// ------------------------------------------------------------------ recognising columns

const is = (re: RegExp) => (h: string) => re.test(low(h))
const isDate = is(/^(date|datum|date & time|date and time|date et heure|fecha|data|day|tag|when|wann|transaction date|expense date)$/)
const isDesc = is(/^(description|title|titel|purpose|zweck|what|was|beschreibung|bezeichnung|name|libellé|libelle|concept|concepto|item|subject|expense|ausgabe|titre|descripción|descripcion|descrizione)$/)
const isCat = is(/^(category|kategorie|catégorie|categorie|categoría|categoria)$/)
const isAmount = is(/^(cost|amount|total|betrag|kosten|montant|importe|importo|summe|price|preis|sum|value|wert|gesamt)( \([^)]*\))?$/)
const isCur = is(/^(currency|währung|waehrung|devise|moneda|valuta|cur)$/)
const isPayer = is(/^(paid by|who paid|payer|bezahlt von|gezahlt von|wer hat bezahlt|payé par|paye par|pagado por|pagato da|from|von)$/)
const isFor = is(/^(for whom|paid for|split between|split among|participants|für wen|fuer wen|bezahlt für|pour qui|para quién|para quien|per chi|shared with|beneficiaries|to|für|teilnehmer)$/)
const isType = is(/^(type|transaction type|art|typ|is reimbursement|kind)$/)
const PER_PAID = /^(?:paid by|bezahlt von|gezahlt von|payé par|paye par|pagado por|pagato da)\s+(.+)$/i
const PER_OWED = /^(?:paid for|bezahlt für|bezahlt fuer|payé pour|paye pour|pagado para|pagato per|impacted to|share|anteil|part de)\s+(.+)$/i
const PAYMENT = /^(payment|zahlung|pago|paiement|pagamento|betaling|płatność|transfer|money transfer|überweisung|ueberweisung|reimbursement|erstattung|rückzahlung|remboursement|reembolso|rimborso|yes|true|ja|oui|sí|si)$/i
const PAYMENT_DESC = /\b(paid|pays|settle|settled|repaid|reimburs|erstattet|zurückgezahlt|bezahlt an|a payé|pagó)\b/i
const TOTAL = /^(total balance|gesamtsaldo|saldo total|solde total|saldo totale|totaal saldo|total|totals|summe|gesamt|balance|saldo|sum)$/i
const NOT_A_PERSON = /(rate|kurs|exchange|default|converted|umgerechnet|\bid\b|balance|saldo|total|summe|sum|amount|betrag)/i
const EVERYONE = /^(all|everyone|everybody|alle|jeder|tous|tout le monde|todos|tutti|\*)$/i

/* Splitwise's categories → Splitlife's; anything else is guessed from its words or the description */
const CATEGORY: [RegExp, string][] = [
  [/^(rent|mortgage|miete)$/, 'rent'],
  [/^(groceries|liquor|lebensmittel|courses|supermarket)$/, 'groceries'],
  [/^(electricity|heat\/gas|water|utilities - other|utilities|trash|cleaning|nebenkosten)$/, 'utilities'],
  [/^(tv\/phone\/internet|internet|phone)$/, 'internet'],
  [/^(dining out|food and drink - other|restaurant|restaurants|food & drink|food|essen)$/, 'eatout'],
  [/^(bus\/train|car|gas\/fuel|parking|plane|taxi|transportation - other|bicycle|transport|transportation|travel|fuel)$/, 'transport'],
  [/^(household supplies|furniture|maintenance|home - other|electronics|pets|services|household|haushalt)$/, 'household'],
]
export function categoryOf(cat: string, description: string): string {
  const s = low(cat)
  for (const [re, c] of CATEGORY) if (re.test(s)) return c
  return (s && builtinCategory(s)) || builtinCategory(description) || 'other'
}

/* "wg-berlin_2024-05-03_export.csv" → "Wg berlin" */
export function nameFromFile(file: string): string {
  const s = file.replace(/\.[a-z0-9]+$/i, '').replace(/[_ -]*\d{4}-\d{2}-\d{2}[_ -]*export$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s && !/^export$/i.test(s) ? s[0].toUpperCase() + s.slice(1) : ''
}

/* names in a "for whom" cell: "Anna, Ben & Chris", "Anna; Ben", "Anna und Ben" */
const namesIn = (s: string) => cut(s).split(/\s*(?:[,;+&/|]|\band\b|\bund\b|\bet\b|\by\b|\be\b)\s*/i).map(cut).filter(Boolean)

/* `r` split equally among `keys` (in that order), largest remainder: the first ones get the odd cents */
function equalParts(r: number, keys: string[]): Map<string, number> {
  const out = new Map<string, number>()
  const base = Math.floor(r / keys.length)
  let left = r - base * keys.length
  for (const k of keys) { out.set(k, base + (left > 0 ? 1 : 0)); if (left > 0) left-- }
  return out
}

// ------------------------------------------------------------------ one row, any layout

/* what a row says: who paid and who owes (exact), or only how far each is up or down */
type Row = { line: number; d: string; t: string; cat: string; cur: string; cost: number | null; pay: boolean
             paid?: Map<string, number>; owed?: Map<string, number>; net?: Map<string, number> }

interface Book {
  keys: string[]
  expenses: SwExpense[]; payments: SwPayment[]; bad: number[]; skipped: number
  balances: Map<string, number>; from: string | null; to: string | null; tooLarge: boolean
}
const newBook = (keys: string[]): Book => ({ keys, expenses: [], payments: [], bad: [], skipped: 0, balances: new Map(), from: null, to: null, tooLarge: false })

function addRow(b: Book, r: Row) {
  const keys = b.keys
  const val = (m: Map<string, number> | undefined, k: string) => m?.get(k) || 0
  let net: number[]
  let exact = false
  if (r.net) net = keys.map((k) => val(r.net, k))
  else {
    // a row's amounts may be a cent or two out after rounding shares: even them out on the
    // largest share, when the difference is no more than a cent per person
    const sp = keys.reduce((a, k) => a + val(r.paid, k), 0)
    let so = keys.reduce((a, k) => a + val(r.owed, k), 0)
    if (sp !== so && r.owed && so !== 0 && Math.abs(sp - so) <= keys.length) {
      const big = keys.reduce((a, k) => (Math.abs(val(r.owed, k)) > Math.abs(val(r.owed, a)) ? k : a), keys[0])
      r.owed.set(big, val(r.owed, big) + sp - so)
      so = sp
    }
    if (sp !== so) { b.bad.push(r.line); return }
    net = keys.map((k) => val(r.paid, k) - val(r.owed, k))
    exact = sp > 0 && keys.every((k) => val(r.paid, k) >= 0 && val(r.owed, k) >= 0)
  }
  if (net.reduce((a, x) => a + x, 0) !== 0) { b.bad.push(r.line); return }
  const up = keys.filter((_, j) => net[j] > 0), down = keys.filter((_, j) => net[j] < 0)
  if (!up.length) { b.skipped++; return }
  if (b.expenses.length + b.payments.length >= MAX_ROWS) { b.tooLarge = true; return }
  if (!b.from || r.d < b.from) b.from = r.d
  if (!b.to || r.d > b.to) b.to = r.d
  keys.forEach((k, j) => { if (net[j]) { const id = `${k}|${r.cur}`; b.balances.set(id, (b.balances.get(id) || 0) + net[j]) } })
  const nk = (k: string) => net[keys.indexOf(k)]
  const sumUp = up.reduce((a, k) => a + nk(k), 0)
  const desc = r.t.slice(0, 200)
  if (r.pay && up.length === 1 && down.length === 1) {
    b.payments.push({ d: r.d, t: desc, from: up[0], to: down[0], cur: r.cur, total: sumUp })
    return
  }
  const owed: Record<string, number> = {}, paid: Record<string, number> = {}
  let total: number
  if (exact) {
    for (const k of keys) { if (val(r.paid, k)) paid[k] = val(r.paid, k); if (val(r.owed, k)) owed[k] = val(r.owed, k) }
    total = keys.reduce((a, k) => a + val(r.paid, k), 0)
  } else {
    const cost = r.cost ?? 0
    total = cost >= sumUp && cost > 0 ? cost : sumUp
    for (const k of down) owed[k] = -nk(k)
    const mine = equalParts(total - sumUp, up)
    for (const k of up) {
      if (mine.get(k)) owed[k] = mine.get(k) as number
      paid[k] = nk(k) + (mine.get(k) as number)
    }
  }
  b.expenses.push({ d: r.d, t: desc, c: categoryOf(r.cat, desc), cur: r.cur, total, paid, owed })
}

function finish(b: Book, people: SwPerson[], layout: Layout, fileName: string, totals: Map<string, number>): SwResult {
  if (b.tooLarge) return { ok: false, error: 'too_large' }
  if (!b.expenses.length && !b.payments.length) return { ok: false, error: 'empty' }
  const bal: Record<string, number> = {}
  for (const [k, v] of [...b.balances].sort((x, y) => (x[0] < y[0] ? -1 : 1))) if (v) bal[k] = v
  let state: SwFile['totals'] = 'none'
  if (totals.size) {
    const ids = new Set([...Object.keys(bal), ...[...totals.keys()].filter((k) => totals.get(k))])
    let worst = 0
    for (const id of ids) worst = Math.max(worst, Math.abs((bal[id] || 0) - (totals.get(id) || 0)))
    state = worst === 0 ? 'yes' : worst <= 5 ? 'rounding' : 'no'
  }
  const currencies = [...new Set([...b.expenses.map((e) => e.cur), ...b.payments.map((p) => p.cur)])].sort()
  return { ok: true, file: { name: nameFromFile(fileName), layout, people, expenses: b.expenses, payments: b.payments, balances: bal,
    totals: state, skipped: b.skipped, bad: b.bad, from: b.from, to: b.to, currencies } }
}

// ------------------------------------------------------------------ the layouts

type Ctx = { rows: string[][]; hi: number; head: string[]; fallback: string; fileName: string }
const col = (head: string[], test: (h: string) => boolean) => head.findIndex(test)
const cell = (r: string[], i: number) => (i >= 0 ? cut(r[i] ?? '') : '')
const dataRows = (c: Ctx) => c.rows.slice(c.hi + 1).map((r, i) => ({ r, line: c.hi + i + 2 })).filter(({ r }) => r.some((x) => cut(x) !== ''))
const isTotalRow = (r: string[], iDate: number, iDesc: number) => !swDate(cell(r, iDate)) && (TOTAL.test(cell(r, iDesc)) || TOTAL.test(cell(r, 0)))

function common(c: Ctx) {
  const iDate = col(c.head, isDate), iDesc = col(c.head, isDesc), iCat = col(c.head, isCat), iCur = col(c.head, isCur), iAmt = col(c.head, isAmount)
  const iType = col(c.head, isType)
  const mf = monthFirstIn(dataRows(c).map(({ r }) => cell(r, iDate)))
  const base = (r: string[], line: number) => {
    const d = swDate(cell(r, iDate), mf)
    const cur = currencyOf(cell(r, iCur), c.fallback)
    const t = cell(r, iDesc), cat = cell(r, iCat)
    const pay = PAYMENT.test(cell(r, iType)) || (iType < 0 && PAYMENT.test(cat))
    return { d, cur, t, cat, pay, line }
  }
  return { iDate, iDesc, iCat, iCur, iAmt, base }
}

/* Splitwise: Date, Description, Category, Cost, Currency, then one column per person */
function netLayout(c: Ctx): SwResult | null {
  const h = c.head
  let last = h.length
  while (last > 5 && cut(h[last - 1]) === '') last--
  if (last < 7 || !(isCur(h[4]) || isAmount(h[3]))) return null
  if (last - 5 > MAX_PEOPLE) return null
  const people = h.slice(5, last).map((name, i) => ({ key: String(i), name: cut(name) || `Person ${i + 1}` }))
  const keys = people.map((p) => p.key)
  const b = newBook(keys), totals = new Map<string, number>()
  const mf = monthFirstIn(dataRows(c).map(({ r }) => cell(r, 0)))
  for (const { r, line } of dataRows(c)) {
    const cur = currencyOf(cell(r, 4), c.fallback)
    const nets = keys.map((_, j) => swAmount(cell(r, 5 + j) || '0', cur))
    if (!swDate(cell(r, 0), mf) && TOTAL.test(cell(r, 1))) {
      if (/^[A-Z]{3}$/.test(cur) && nets.every((n) => n !== null)) keys.forEach((k, j) => totals.set(`${k}|${cur}`, (totals.get(`${k}|${cur}`) || 0) + (nets[j] as number)))
      continue
    }
    const d = swDate(cell(r, 0), mf), cost = swAmount(cell(r, 3), cur)
    if (!d || !/^[A-Z]{3}$/.test(cur) || cost === null || nets.some((n) => n === null)) { b.bad.push(line); continue }
    addRow(b, { line, d, t: cell(r, 1), cat: cell(r, 2), cur, cost, pay: /^(payment|zahlung|pago|paiement|pagamento|betaling|płatność)$/i.test(cell(r, 2)),
                net: new Map(keys.map((k, j) => [k, nets[j] as number])) })
  }
  return finish(b, people, 'net', c.fileName, totals)
}

/* Tricount, Sesterce: "Paid by X" and "Paid for X" for each person */
function paidForLayout(c: Ctx): SwResult | null {
  const by = new Map<string, number>(), forr = new Map<string, number>()
  c.head.forEach((h, i) => {
    const a = PER_PAID.exec(cut(h)), o = PER_OWED.exec(cut(h))
    if (a) by.set(cut(a[1]).toLowerCase(), i); else if (o) forr.set(cut(o[1]).toLowerCase(), i)
  })
  if (by.size < 1 || forr.size < 2) return null
  const names: string[] = []
  const display = new Map<string, string>()
  c.head.forEach((h) => {
    const m = PER_PAID.exec(cut(h)) || PER_OWED.exec(cut(h))
    if (m && !display.has(cut(m[1]).toLowerCase())) { display.set(cut(m[1]).toLowerCase(), cut(m[1])); names.push(cut(m[1]).toLowerCase()) }
  })
  if (names.length > MAX_PEOPLE) return null
  const people = names.map((n, i) => ({ key: String(i), name: display.get(n) as string }))
  const keyOf = new Map(names.map((n, i) => [n, String(i)]))
  const { iDate, iDesc, iAmt, base } = common(c)
  if (iDate < 0) return null
  const b = newBook(people.map((p) => p.key))
  for (const { r, line } of dataRows(c)) {
    if (isTotalRow(r, iDate, iDesc)) continue
    const x = base(r, line)
    const paid = new Map<string, number>(), owed = new Map<string, number>()
    let broken = !x.d || !/^[A-Z]{3}$/.test(x.cur)
    for (const [n, i] of by) { const v = sheetAmount(cell(r, i), x.cur); if (v === null) broken = true; else if (v) paid.set(keyOf.get(n)!, v) }
    for (const [n, i] of forr) { const v = sheetAmount(cell(r, i), x.cur); if (v === null) broken = true; else if (v) owed.set(keyOf.get(n)!, v) }
    if (broken) { b.bad.push(line); continue }
    const cost = iAmt >= 0 ? sheetAmount(cell(r, iAmt), x.cur) : null
    addRow(b, { ...x, d: x.d!, cost, paid, owed, pay: x.pay || (owed.size === 1 && paid.size === 1 && [...paid.keys()][0] !== [...owed.keys()][0] && PAYMENT_DESC.test(x.t)) })
  }
  return finish(b, people, 'paidfor', c.fileName, new Map())
}

/* the people a "who paid" layout names: every payer, every name in "for whom", and (for
   Settle Up) every column headed with one of those names */
function payerLayouts(c: Ctx): SwResult | null {
  const iPayer = col(c.head, isPayer)
  if (iPayer < 0) return null
  const { iDate, iDesc, iAmt, base } = common(c)
  if (iDate < 0 || iAmt < 0) return null
  const iFor = col(c.head, isFor)
  const rows = dataRows(c).filter(({ r }) => !isTotalRow(r, iDate, iDesc))
  const payerNames = new Set(rows.map(({ r }) => cell(r, iPayer).toLowerCase()).filter(Boolean))
  const known = new Set([iPayer, iFor, iDate, iDesc, iAmt, col(c.head, isCat), col(c.head, isCur), col(c.head, isType)])
  // Settle Up: a column per person, headed with their name and holding amounts — everyone's,
  // including people who never paid, once at least two of them are payers
  const numeric = c.head.map((h, i) => ({ h: cut(h), i })).filter(({ h, i }) => !known.has(i) && h && !NOT_A_PERSON.test(h)
    && rows.every(({ r }) => sheetAmount(cell(r, i), 'EUR') !== null))
  const memberCols = numeric.filter(({ h }) => payerNames.has(h.toLowerCase())).length >= 2 ? numeric : []
  const layout: Layout = memberCols.length >= 2 ? 'shares' : 'list'
  const names: string[] = [], display = new Map<string, string>()
  const meet = (n: string) => { const k = n.toLowerCase(); if (!k || EVERYONE.test(k) || display.has(k)) return; display.set(k, n); names.push(k) }
  if (layout === 'shares') memberCols.forEach(({ h }) => meet(h))
  for (const { r } of rows) {
    meet(cell(r, iPayer))
    if (layout === 'list' && iFor >= 0) namesIn(cell(r, iFor)).forEach(meet)
  }
  if (names.length < 2 || names.length > MAX_PEOPLE) return null
  const people = names.map((n, i) => ({ key: String(i), name: display.get(n) as string }))
  const keyOf = new Map(names.map((n, i) => [n, String(i)]))
  const keys = people.map((p) => p.key)
  const b = newBook(keys)
  for (const { r, line } of rows) {
    const x = base(r, line)
    const total = sheetAmount(cell(r, iAmt), x.cur)
    const payer = keyOf.get(cell(r, iPayer).toLowerCase())
    if (!x.d || !/^[A-Z]{3}$/.test(x.cur) || total === null || !payer) { b.bad.push(line); continue }
    const owed = new Map<string, number>()
    if (layout === 'shares') {
      let broken = false
      for (const { h, i } of memberCols) { const v = sheetAmount(cell(r, i), x.cur); if (v === null) broken = true; else if (v) owed.set(keyOf.get(h.toLowerCase())!, v) }
      if (broken) { b.bad.push(line); continue }
      if (!owed.size) equalParts(Math.abs(total), keys).forEach((v, k) => { if (v) owed.set(k, Math.sign(total) * v) })
    } else {
      const named = iFor >= 0 ? namesIn(cell(r, iFor)) : []
      const among = named.length && !named.some((n) => EVERYONE.test(n)) ? named.map((n) => keyOf.get(n.toLowerCase())) : keys
      if (among.some((k) => !k)) { b.bad.push(line); continue }
      const uniq = [...new Set(among as string[])].sort((p, q) => +p - +q)
      equalParts(Math.abs(total), uniq).forEach((v, k) => { if (v) owed.set(k, Math.sign(total) * v) })
    }
    const paid = new Map([[payer, total]])
    const pay = x.pay || (owed.size === 1 && !owed.has(payer) && PAYMENT_DESC.test(x.t))
    addRow(b, { ...x, d: x.d, cost: total, paid, owed, pay })
  }
  return finish(b, people, layout, c.fileName, new Map())
}

/* "which column is what?": the columns someone picked, read as a "who paid / for whom" list */
function mappedLayout(c: Ctx, map: ColumnMap): SwResult {
  const head = c.head.map(() => '')
  head[map.date] = 'date'; head[map.amount] = 'amount'; head[map.payer] = 'paid by'
  if (map.description >= 0) head[map.description] = 'description'
  if (map.forWhom >= 0) head[map.forWhom] = 'for whom'
  if (map.currency >= 0) head[map.currency] = 'currency'
  if (map.category >= 0) head[map.category] = 'category'
  return payerLayouts({ ...c, head }) || { ok: false, error: 'not_recognised', header: c.head, sample: dataRows(c).slice(0, 3).map(({ r }) => r) }
}

/* one sheet or CSV: find its header row (one of the first ten), then its layout */
export function importTable(rows: string[][], opts: ReadOpts = {}): SwResult {
  const nonEmpty = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.some((x) => cut(x) !== ''))
  if (!nonEmpty.length) return { ok: false, error: 'empty' }
  const fallback = (opts.currency || 'EUR').toUpperCase()
  const fileName = opts.fileName || ''
  if (opts.map) return mappedLayout({ rows, hi: nonEmpty[0].i, head: rows[nonEmpty[0].i].map(cut), fallback, fileName }, opts.map)
  for (const { i } of nonEmpty.slice(0, 10)) {
    const c: Ctx = { rows, hi: i, head: rows[i].map(cut), fallback, fileName }
    for (const layout of [paidForLayout, payerLayouts, netLayout]) {
      const res = layout(c)
      if (!res) continue
      if (res.ok || res.error === 'too_large') return res
    }
  }
  const c: Ctx = { rows, hi: nonEmpty[0].i, head: rows[nonEmpty[0].i].map(cut), fallback, fileName }
  if (nonEmpty.length === 1 || dataRows(c).length === 0) return { ok: false, error: 'empty' }
  return { ok: false, error: 'not_recognised', header: c.head, sample: dataRows(c).slice(0, 3).map(({ r }) => r) }
}

/* a workbook: the sheet that reads best (most rows taken in) */
export function importSheets(sheets: string[][][], opts: ReadOpts = {}): SwResult {
  let best: SwResult | null = null, fallback: SwResult | null = null
  for (const s of sheets) {
    const r = importTable(s, opts)
    if (r.ok) { if (!best || !best.ok || r.file.expenses.length + r.file.payments.length > best.file.expenses.length + best.file.payments.length) best = r }
    else if (r.error === 'too_large') return r
    else if (r.error === 'not_recognised' && (!fallback || fallback.ok || fallback.error !== 'not_recognised' || r.sample.length > fallback.sample.length)) fallback = r
    else if (!fallback) fallback = r
  }
  return best || fallback || { ok: false, error: 'empty' }
}

export const importCsv = (text: string, opts: ReadOpts = {}) => importTable(csvTable(text), opts)

/* which column is you: your name (or its first word) as the file wrote it */
export function guessMe(people: SwPerson[], myName: string): string | null {
  const n = myName.trim().toLowerCase()
  if (!n) return null
  const exact = people.find((p) => p.name.trim().toLowerCase() === n)
  if (exact) return exact.key
  const firstWord = n.split(/\s+/)[0]
  const hits = people.filter((p) => p.name.trim().toLowerCase().split(/\s+/)[0] === firstWord)
  return hits.length === 1 ? hits[0].key : null
}

export const SOURCES = ['splitwise', 'tricount', 'settleup', 'splid', 'other'] as const
export type Source = (typeof SOURCES)[number]

/* what to send to import_group */
export function importPayload(f: SwFile, me: string, name: string, kind: 'group' | 'flat', hash: string, source: Source = 'splitwise') {
  return {
    source, hash, name: name.trim() || f.name || 'Imported group', kind, me,
    people: f.people, balances: f.balances,
    expenses: f.expenses.map(({ d, t, c, cur, total, paid, owed }) => ({ d, t, c, cur, total, paid, owed })),
    payments: f.payments.map(({ d, t, from, to, cur, total }) => ({ d, t, from, to, cur, total })),
  }
}

/* a fingerprint of the file, so the same file isn't imported twice */
export async function fileHash(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()) : data
  const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* "42 expenses and 3 payments" */
export function swSummary(f: SwFile): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
  return [f.expenses.length ? n(f.expenses.length, 'expense') : '', f.payments.length ? n(f.payments.length, 'payment') : ''].filter(Boolean).join(' and ')
}
