/* Reads a shop receipt — the lines the camera's text recognition found — into what an
   expense needs: the shop, the day, the total and the lines on it. A port of the iPhone
   app's Receipt.swift, held to the same tests/receipt-vectors.json (tests/receipt.test.ts).
   Money is never guessed: every amount comes from a figure printed on the receipt, and
   the items are offered for a split only when they add up to the total to the cent. */

export interface ReceiptItem { name: string; /* cents */ minor: number }

export interface ReceiptResult {
  store: string | null
  /* yyyy-MM-dd */
  date: string | null
  /* cents */
  total: number | null
  /* read from a "Summe" / "Zu zahlen" line (or confirmed by the card or cash line), not the largest figure */
  totalSure: boolean
  items: ReceiptItem[]
  /* money taken off that belongs to no single line (Leergut, a coupon), in cents */
  discount: number
  /* Splitlife's category for the shop, when the shop says it */
  category: string | null
}

/* the lines, less what was taken off, come to the total exactly */
export const itemsMatch = (r: ReceiptResult) =>
  r.total != null && r.items.length > 0 && r.items.every((i) => i.minor > 0) && r.items.reduce((t, i) => t + i.minor, 0) - r.discount === r.total

/* ---- amounts ---- */

export interface Amount { minor: number; /* where the figure starts in the row */ at: number }

/* "1,49", "12.50", "-0,30", "0,30-", "1.234,56" — two decimals, never part of a date
   (03.10.2026), a percentage (19,00%) or a longer number. */
const amountRE = /(?<![\d.,])(-\s?)?(\d{1,3}(?:\.\d{3})+|\d{1,5})([.,])(\d{2})(?![\d%]|[.,]\d)(\s?-(?![\d]))?/g

export function amounts(row: string): Amount[] {
  const out: Amount[] = []
  for (const m of row.matchAll(amountRE)) {
    const whole = m[2], sep = m[3]
    // "1.234.56" is not an amount
    if (sep === '.' && whole.includes('.')) continue
    const v = Number(whole.replace(/\./g, '')) * 100 + Number(m[4])
    out.push({ minor: m[1] != null || m[5] != null ? -v : v, at: m.index! })
  }
  return out
}

/* ---- kinds of row ---- */

/* `\b` as the iPhone's regular expressions have it: between a letter or digit (in any
   alphabet — "öffnungszeiten") and anything else. JavaScript's own \b knows only a–z. */
const W = '[\\p{L}\\p{N}_]'
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`
const re = (p: string) => new RegExp(p.replace(/\\b/g, B), 'iu')
const has = (r: RegExp, s: string) => r.test(s)

/* what the receipt calls the amount to pay. "Zwischensumme" is a subtotal. */
const totalRE = re(String.raw`\b(zu\s*zahlen|zu\s*zahl|gesamtsumme|endsumme|summe|total|gesamtbetrag|rechnungsbetrag|zahlbetrag|gesamt|betrag)\b`)
const notTotalRE = re(String.raw`sub\s*total|zwischensumme|netto|mwst|ust\b|steuer|rabatt|ersparnis|gespart|sparen|bonus|punkte|payback`)
/* how it was paid — a figure on one of these repeats the total */
const paymentRE = re(String.raw`\b(karte|kartenzahlung|girocard|ec[- ]?karte|ec[- ]?cash|visa|mastercard|maestro|amex|kreditkarte|bar|paypal|apple\s*pay|google\s*pay|zahlung|bezahlt)\b`)
/* paid by card, which repeats the exact total (cash handed over need not) */
const cardRE = re(String.raw`\b(karte|kartenzahlung|girocard|ec[- ]?karte|ec[- ]?cash|visa|mastercard|maestro|amex|kreditkarte|paypal|apple\s*pay|google\s*pay)\b`)
/* cash handed over and change: not the total */
const cashRE = re(String.raw`gegeben|geg\.|rückgeld|ruckgeld|wechselgeld|zurück`)
/* "2 x 0,99", "1,076 kg x 1,20 EUR/kg": how a line's price came about */
const qualifierRE = re(String.raw`(\d\s*(x|×|\*)\s*\d)|((kg|stk|st\.|stück|g)\s*(x|×|\*))|(/\s*kg)|(eur\s*/)`)
/* "1,20 EUR/kg": a price per unit, never a line's own price */
const unitPriceRE = re(String.raw`(/\s*(kg|l|stk|st|100\s*g))|((eur|€)\s*/)`)
/* lines that are about the receipt, the till or the tax — never something bought */
const notItemRE = re(String.raw`\b(sub\s*total|zwischensumme|mwst|ust|steuer|netto|brutto|tel|telefon|fax|uid|st-?nr|steuer-?nr|www|http|bon|beleg|kasse|kassierer|terminal|trace|tse|signatur|seriennummer|transaktion|datum|uhrzeit|posten|filiale|öffnungszeiten|vielen dank|danke|iban|bic|kundenbeleg|genehmigung|autorisierung)\b`)
/* a line taking money off — Lidl's "Preisvorteil", a coupon, empties returned */
const reductionRE = re(String.raw`preisvorteil|rabatt|coupon|gutschein|nachlass|leergut|pfandrückgabe|pfandruckgabe|aktion|abzug|sofortrabatt`)
/* "EUR" over the price column is a heading, not something bought */
const currencyOnlyRE = re(String.raw`^\s*(eur|euro|€)\s*$`)
/* these take money off even when the minus isn't printed */
const alwaysOffRE = re(String.raw`preisvorteil|rabatt|nachlass|sofortrabatt|pfandrückgabe|pfandruckgabe|leergut`)
const emptiesRE = re('leergut|pfandr')
const notStoreRE = re(String.raw`kassenbon|rechnung|quittung|willkommen|beleg|eur\b`)
const dateRE = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/g

const letters = (s: string) => (s.match(/\p{L}/gu) || []).length
const chars = (s: string) => [...s].length

/* ---- reading ---- */

/* rows: the receipt top to bottom, one printed line each (what is left of a line and
   what is right of it, joined); now: today (yyyy-MM-dd), so a misread year can't put it in the future */
export function readReceipt(input: string[], now: string = new Date().toISOString().slice(0, 10)): ReceiptResult {
  const rows = input.map((r) => r.replace(/\t/g, '  ').replace(/^\p{Zs}+|\p{Zs}+$/gu, '')).filter((r) => r)
  const r: ReceiptResult = { store: null, date: null, total: null, totalSure: false, items: [], discount: 0, category: null }
  const amt = rows.map(amounts)
  const last = (i: number) => amt[i][amt[i].length - 1] as Amount | undefined

  // the total: the first line from the top that says so and shows a figure
  let totalRow: number | null = null
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!(has(totalRE, row) && !has(notTotalRE, row) && !has(cashRE, row))) continue
    const a = last(i)
    if (a && a.minor > 0) { r.total = a.minor; totalRow = i; break }
    // "SUMME" on one line, the figure alone on the next
    const b = i + 1 < rows.length ? last(i + 1) : undefined
    if (b && b.minor > 0 && letters(rows[i + 1]) <= 4) { r.total = b.minor; totalRow = i; break }
  }
  // how it was paid: a card line repeats the total
  const paidRows = rows.map((_, i) => i).filter((i) => has(paymentRE, rows[i]) && !has(cashRE, rows[i]) && (last(i)?.minor ?? 0) > 0)
  const cardRows = paidRows.filter((i) => has(cardRE, rows[i]))
  if (r.total == null && paidRows.length) { r.total = last(paidRows[0])!.minor; totalRow = paidRows[0] }

  // the lines bought: everything above the total with a price at its end
  const end = totalRow ?? (paidRows.length ? paidRows[0] : rows.length)
  let firstItemRow: number | null = null
  let pendingName: string | null = null
  for (let i = 0; i < end; i++) {
    const row = rows[i]
    const price = last(i)
    if (!price) {
      // a name whose price is on the next line
      pendingName = letters(row) >= 3 && !has(notItemRE, row) && !has(totalRE, row) ? row : null
      continue
    }
    dateRE.lastIndex = 0
    if (has(notItemRE, row) || has(cashRE, row) || (has(totalRE, row) && !has(reductionRE, row)) || dateRE.test(row)) { pendingName = null; continue }
    let name = clean(row.slice(0, price.at))
    // "Paulaner Spezi  4 * 0,95  3,80" (Kaufland): the name, how many at what, and the
    // line's price, all on one line — an item, named by what comes before the count
    const q = row.match(qualifierRE)
    const lead = q ? clean(row.slice(0, q.index!)) : ''
    if (!has(unitPriceRE, row) && q && amt[i].length >= 2 && letters(lead) >= 3) {
      name = lead
    } else if (has(unitPriceRE, row) || (q && (amt[i].length >= 2 || letters(name) < 3))) {
      // "2 x 0,99   1,98" under a name printed alone: that is the line's price
      if (pendingName != null) name = clean(pendingName); else { pendingName = null; continue }
    } else if (letters(name) < 2 || has(currencyOnlyRE, name)) {
      // a price alone on its line belongs to the name just above it
      if (pendingName == null) continue
      name = clean(pendingName)
    }
    pendingName = null
    if (firstItemRow == null) firstItemRow = i
    if (price.minor < 0 || has(alwaysOffRE, row)) {
      const off = Math.abs(price.minor)
      // "Preisvorteil" belongs to the line just above it
      const li = r.items.length - 1
      if (li >= 0 && has(reductionRE, row) && !has(emptiesRE, row) && r.items[li].minor > off) r.items[li].minor -= off
      else r.discount += off
      continue
    }
    r.items.push({ name, minor: price.minor })
  }

  // the shop: a chain we know in the lines above the first item, or the first line that reads like a name
  const header = rows.slice(0, Math.min(firstItemRow ?? totalRow ?? 10, 10))
  const c = chain(header)
  if (c) { r.store = c[0]; r.category = c[1] } else {
    const s = header.find((row) => letters(row) >= 3 && letters(row) / Math.max(chars(row), 1) > 0.5 && amounts(row).length === 0
      && !has(notItemRE, row) && !has(notStoreRE, row))
    r.store = s != null ? titled(s) : null
  }

  // Sure means two things on the receipt agree — a card line repeats it, or the lines
  // add up to it to the cent. A "Summe" alone is not enough: a misread digit would go
  // through unnoticed, and a card line saying something else means one of them was misread.
  if (r.total != null) {
    const after = totalRow ?? -1
    const confirmed = cardRows.some((i) => i > after && last(i)?.minor === r.total)
    const contradicted = cardRows.some((i) => i > after && i <= after + 3 && last(i) != null && last(i)!.minor !== r.total)
    r.totalSure = !contradicted && (confirmed || itemsMatch(r))
  }

  r.date = dateIn(rows, now)
  // no figure at all: whatever the first line says, this isn't a receipt we can read
  if (r.total == null && !r.items.length) { r.store = null; r.category = null }
  return r
}

/* "BIO HAFERDRINK  " → "Bio Haferdrink"; what is printed, tidied */
function clean(s: string): string {
  let t = s.replace(/\s+/g, ' ')
  t = t.replace(/^[\p{Zs}\t*#:\-€]+|[\p{Zs}\t*#:\-€]+$/gu, '')
  if (t.endsWith(' EUR')) t = t.slice(0, -4)
  return titled(t)
}

function titled(s: string): string {
  const t = s.trim()
  if (!(letters(t) > 4 && t === t.toUpperCase())) return t
  // a capital after anything that isn't a letter: "G&G ESL-MILCH" → "G&G Esl-Milch"
  let out = '', after = true
  for (const c of t.toLowerCase()) {
    out += after ? c.toUpperCase() : c
    after = !/\p{L}/u.test(c)
  }
  return out.replace(/\s+/g, ' ')
}

/* the first date that can be the day of the purchase: not in the future, not years ago */
function dateIn(rows: string[], now: string): string | null {
  const today = Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - 1, +now.slice(8, 10))
  for (const row of rows) {
    for (const m of row.matchAll(dateRE)) {
      const d = +m[1], mo = +m[2]
      let y = +m[3]
      if (y < 100) y += 2000
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue
      const when = new Date(Date.UTC(y, mo - 1, d))
      if (when.getUTCDate() !== d) continue
      const days = Math.round((today - when.getTime()) / 86400000)
      if (days < -1 || days > 730) continue
      return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  return null
}

/* chains people in Germany shop at, with the category their receipts belong in */
const CHAINS: [string, string, string | null][] = [
  [String.raw`\brewe\b`, 'REWE', 'groceries'], [String.raw`\blidl\b`, 'Lidl', 'groceries'],
  [String.raw`aldi\s*s[uü]d`, 'ALDI SÜD', 'groceries'], [String.raw`aldi\s*nord`, 'ALDI Nord', 'groceries'], [String.raw`\baldi\b`, 'ALDI', 'groceries'],
  [String.raw`\bedeka\b`, 'EDEKA', 'groceries'], [String.raw`\bkaufland\b`, 'Kaufland', 'groceries'],
  [String.raw`netto\s*marken|\bnetto\s*city|^netto$`, 'Netto', 'groceries'], [String.raw`\bpenny\b`, 'PENNY', 'groceries'],
  [String.raw`\bnorma\b`, 'NORMA', 'groceries'], [String.raw`\bglobus\b`, 'Globus', 'groceries'], [String.raw`\btegut\b`, 'tegut', 'groceries'],
  [String.raw`denn'?s\s*bio`, "denn's Biomarkt", 'groceries'], [String.raw`\balnatura\b`, 'Alnatura', 'groceries'],
  [String.raw`bio\s*company`, 'Bio Company', 'groceries'], [String.raw`\bmarktkauf\b`, 'Marktkauf', 'groceries'],
  [String.raw`\bdm[- ]drogerie|^dm$|\bdm\s*markt`, 'dm', 'household'], [String.raw`\brossmann\b`, 'Rossmann', 'household'],
  [String.raw`\bm[uü]ller\s*(drogerie|handels)`, 'Müller', 'household'],
  [String.raw`\bikea\b`, 'IKEA', 'household'], [String.raw`\baction\b`, 'Action', 'household'], [String.raw`\btedi\b`, 'TEDi', 'household'],
  [String.raw`\bobi\b`, 'OBI', 'household'], [String.raw`\bhornbach\b`, 'Hornbach', 'household'], [String.raw`\bbauhaus\b`, 'Bauhaus', 'household'],
  [String.raw`media\s*markt`, 'MediaMarkt', null], [String.raw`\bsaturn\b`, 'Saturn', null],
  [String.raw`mc\s*donald`, "McDonald's", 'eatout'], [String.raw`burger\s*king`, 'Burger King', 'eatout'], [String.raw`\bstarbucks\b`, 'Starbucks', 'eatout'],
  [String.raw`\bsubway\b`, 'Subway', 'eatout'], [String.raw`\bvapiano\b`, 'Vapiano', 'eatout'], [String.raw`\bkfc\b`, 'KFC', 'eatout'],
  [String.raw`back[- ]?werk`, 'BackWerk', 'eatout'], [String.raw`\bditsch\b`, 'Ditsch', 'eatout'],
  [String.raw`\baral\b`, 'Aral', 'transport'], [String.raw`\bshell\b`, 'Shell', 'transport'], [String.raw`\besso\b`, 'Esso', 'transport'],
  [String.raw`deutsche\s*bahn|db\s*fernverkehr|db\s*regio`, 'Deutsche Bahn', 'transport'],
]
const CHAIN_RE = CHAINS.map(([p, n, c]) => [re(p), n, c] as const)

function chain(rows: string[]): [string, string | null] | null {
  for (const [r, n, c] of CHAIN_RE) if (rows.some((row) => r.test(row.trim()))) return [n, c]
  return null
}
