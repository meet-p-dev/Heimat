/* Bringing shifts in: Splitlife's own "Export my data" (JSON) or "Export shifts" (CSV), or a
   timesheet from a spreadsheet — comma, semicolon or tab, English or German headings,
   2026-10-02 or 02.10.2026, 12,50 or 12.50. Shifts already on this device are left alone
   (same id, or same day, employer and times), so importing twice adds nothing.
   The iPhone app (ios-native/Heimat/ShiftImport.swift) is held to tests/shift-import-vectors.json. */

export interface ImportedShift {
  id: string | null; date: string; employer: string; start: string; end: string
  breakMin: number; paidBreak: boolean; wage: number; hours: number | null
  /* what it paid, when the file says (older shifts may have pay but no hourly wage) */
  pay: number | null
}
export interface ImportResult { shifts: ImportedShift[]; skipped: number; bad: number }
type Have = { id?: string | null; date: string; employer?: string; start?: string; end?: string; hours?: number | null }

const MAX = 5000

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  if (d > days) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
export function normDate(s: string): string | null {
  const t = s.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return validDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t)   // day first, as in Germany
  if (m) return validDate(+m[3], +m[2], +m[1])
  return null
}
/* "9:00", "09:00", "9.00", "9" → "09:00"; "" stays ""; anything else is null */
export function normTime(s: string): string | null {
  const t = s.trim()
  if (!t) return ''
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(t)
  if (!m || +m[1] > 24 || +(m[2] || 0) > 59 || (+m[1] === 24 && +(m[2] || 0) > 0)) return null
  return `${m[1].padStart(2, '0')}:${m[2] || '00'}`
}
/* "12,50", "12.50", "1.234,50", "1,234.50", "€ 12" → number; "" → 0; junk → null */
export function normNum(s: string): number | null {
  let t = s.replace(/[€\s]/g, '')
  if (!t) return 0
  const c = t.lastIndexOf(','), d = t.lastIndexOf('.')
  if (c > d) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const yes = (s: string) => /^(yes|y|true|1|ja|j|x)$/i.test(s.trim())

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
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const HEADS: [keyof ImportedShift | 'skip', RegExp][] = [
  ['date', /^(date|datum|day|tag)$/],
  ['employer', /^(employer|arbeitgeber|job|company|firma)$/],
  ['start', /^(start|beginn|begin|from|von)$/],
  ['end', /^(end|ende|to|bis)$/],
  ['breakMin', /^(break( \(min\))?|pause( \(min\))?|break minutes)$/],
  ['paidBreak', /^(paid break|bezahlte pause)$/],
  ['hours', /^(paid hours|hours|stunden|arbeitsstunden)$/],
  ['wage', /^(hourly wage|wage|rate|stundenlohn|lohn)$/],
  ['pay', /^(gross pay|pay|brutto|verdienst)$/],
]

function fromCsv(text: string): { rows: (ImportedShift | null)[] } {
  const first = text.split(/\r?\n/, 1)[0]
  const count = (c: string) => first.split(c).length - 1
  const sep = [';', '\t', ','].reduce((a, b) => (count(b) > count(a) ? b : a), ',')
  const all = splitCsv(text, sep)
  if (!all.length) return { rows: [] }
  const cols = all[0].map((h) => {
    const k = h.trim().toLowerCase()
    return HEADS.find(([, re]) => re.test(k))?.[0] || 'skip'
  })
  if (!cols.includes('date')) return { rows: Array.from({ length: Math.max(1, all.length - 1) }, () => null) }
  const at = (r: string[], k: string) => { const i = cols.indexOf(k as never); return i >= 0 ? (r[i] ?? '') : '' }
  return {
    rows: all.slice(1).map((r) => {
      const date = normDate(at(r, 'date')), start = normTime(at(r, 'start')), end = normTime(at(r, 'end'))
      const breakMin = normNum(at(r, 'breakMin')), wage = normNum(at(r, 'wage')), hours = normNum(at(r, 'hours'))
      const pay = at(r, 'pay').trim() ? normNum(at(r, 'pay')) : null
      if (!date || start == null || end == null || breakMin == null || wage == null || hours == null || (at(r, 'pay').trim() && pay == null)) return null
      const timed = !!start && !!end
      if (!timed && !(hours > 0)) return null
      return { id: null, date, employer: at(r, 'employer').trim(), start: timed ? start : '', end: timed ? end : '',
               breakMin: Math.round(breakMin), paidBreak: yes(at(r, 'paidBreak')), wage, hours: timed ? null : hours, pay }
    }),
  }
}

function fromJson(v: unknown): { rows: (ImportedShift | null)[] } {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { shifts?: unknown }).shifts) ? (v as { shifts: unknown[] }).shifts : null
  if (!list) return { rows: [null] }
  return {
    rows: list.map((x) => {
      if (!x || typeof x !== 'object') return null
      const o = x as Record<string, unknown>
      const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
      const num = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : typeof o[k] === 'string' ? normNum(o[k] as string) : o[k] == null ? 0 : null)
      const date = normDate(str('date')), start = normTime(str('start')), end = normTime(str('end'))
      const breakMin = num('breakMin'), wage = num('wage'), hours = num('hours'), pay = o.pay == null ? null : num('pay')
      if (!date || start == null || end == null || breakMin == null || wage == null || hours == null || (o.pay != null && pay == null)) return null
      const timed = !!start && !!end
      if (!timed && !(hours > 0)) return null
      return { id: str('id') || null, date, employer: str('employer').trim(), start: timed ? start : '', end: timed ? end : '',
               breakMin: Math.round(breakMin), paidBreak: o.paidBreak === true || (typeof o.paidBreak === 'string' && yes(o.paidBreak)), wage,
               hours: timed ? null : hours, pay }
    }),
  }
}

const keyOf = (s: Have) => [s.date, (s.employer || '').trim().toLowerCase(), s.start || '', s.end || '', s.start && s.end ? '' : String(s.hours ?? '')].join('|')

export function importShifts(text: string, have: Have[]): ImportResult {
  const t = text.replace(/^﻿/, '').trim()
  let parsed: { rows: (ImportedShift | null)[] }
  if (t.startsWith('{') || t.startsWith('[')) {
    try { parsed = fromJson(JSON.parse(t)) } catch { parsed = { rows: [null] } }
  } else parsed = fromCsv(t)
  const ids = new Set(have.map((s) => s.id).filter(Boolean) as string[])
  const keys = new Set(have.map(keyOf))
  const out: ImportedShift[] = []
  let skipped = 0, bad = 0
  for (const r of parsed.rows) {
    if (!r) { bad++; continue }
    if ((r.id && ids.has(r.id)) || keys.has(keyOf(r))) { skipped++; continue }
    if (out.length >= MAX) { bad++; continue }
    if (r.id) ids.add(r.id)
    keys.add(keyOf(r))
    out.push(r)
  }
  return { shifts: out, skipped, bad }
}
