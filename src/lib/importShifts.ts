/* Bringing shifts in: Splitlife's own "Export my data" (JSON) or "Export shifts" (CSV), a
   timesheet from a spreadsheet or a time tracker (Clockify, Toggl, Harvest… — comma, semicolon
   or tab, English or German headings, 2026-10-02, 02.10.2026 or 10/02/2026, 12,50 or 12.50,
   "Clock in" columns holding a date and a time, durations as 7.5 or 7:30), or a calendar file
   (.ics) from a rostering app (Planday, Deputy, When I Work, Shiftbase… — each event a shift,
   its title the job). Shifts already on this device are left alone (same id, or same day,
   employer and times), so importing twice adds nothing. A file that says no hourly wage gives
   shifts with wage 0; the app asks for each job's wage before adding them.
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
/* "2026-10-02", "2026/10/02", "02.10.2026", "02/10/2026" (day first, as in Germany, unless the
   file writes the month first: "10/02/2026") */
export function normDate(s: string, monthFirst = false): string | null {
  const t = s.trim()
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t)
  if (m) return validDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t)
  if (m) return monthFirst ? validDate(+m[3], +m[1], +m[2]) : validDate(+m[3], +m[2], +m[1])
  return null
}
/* does the file write the month first? when some date can't be day-first — or, with no date
   saying either way, when its times are written the American way ("5:30 PM") */
function monthFirstIn(cells: string[], american = false): boolean {
  let dayFirst = false, monthFirst = false
  for (const c of cells) {
    const m = /^(\d{1,2})[./](\d{1,2})[./]\d{4}/.exec(c.trim())
    if (!m) continue
    if (+m[1] > 12) dayFirst = true
    if (+m[2] > 12) monthFirst = true
  }
  return !dayFirst && (monthFirst || american)
}
/* "9:00", "09:00", "9.00", "9", "09:00:00", "9:00 PM" → "09:00" / "21:00"; "" stays ""; anything else is null */
export function normTime(s: string): string | null {
  const t = s.trim()
  if (!t) return ''
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*([ap])?\.?(?:m\.?)?$/i.exec(t)
  if (!m) return null
  let h = +m[1]
  const min = +(m[2] || 0)
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)
  }
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
/* a cell holding a date and a time ("2026-10-02 09:00:00", "02.10.2026 9:00", "10/02/2026 9:00 AM") */
function dateTime(s: string): { date: string; time: string } | null {
  const m = /^(\S+)[ T](\d{1,2}[:.]\d{2}.*)$/.exec(s.trim())
  return m ? { date: m[1], time: m[2] } : null
}
/* hours as 7.5, "7,5", "7:30" or "07:30:00" → 7.5 (to the minute); "" → 0; junk → null */
export function normHours(s: string): number | null {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s.trim())
  if (m) return Math.round((+m[1] + +m[2] / 60 + +(m[3] || 0) / 3600) * 100) / 100
  return normNum(s)
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

const HEADS: [keyof ImportedShift | 'skip' | 'breakHours', RegExp][] = [
  ['date', /^(date|datum|day|tag|start date|startdatum|work date|shift date)$/],
  ['employer', /^(employer|arbeitgeber|job|company|firma|project|projekt|client|kunde|workplace|arbeitsort|location|position)$/],
  ['start', /^(start|beginn|begin|from|von|start time|startzeit|clock in|clock-in|check in|check-in|time in|in|arbeitsbeginn|shift start)$/],
  ['end', /^(end|ende|to|bis|end time|endzeit|clock out|clock-out|check out|check-out|time out|out|arbeitsende|shift end)$/],
  ['breakMin', /^(break( \(min\))?|pause( \(min\))?|break minutes|break \(minutes\)|pause \(minuten\))$/],
  ['breakHours', /^(break hours|pausenstunden|break \(h\))$/],
  ['paidBreak', /^(paid break|bezahlte pause)$/],
  ['hours', /^(paid hours|hours|stunden|arbeitsstunden|duration|dauer|duration \(h\)|duration \(decimal\)|hours worked|worked hours|total hours|time \(h\)|time \(decimal\))$/],
  ['wage', /^(hourly wage|wage|rate|hourly rate|pay rate|stundenlohn|lohn|stundensatz|billable rate( \([^)]*\))?)$/],
  ['pay', /^(gross pay|pay|brutto|verdienst|earnings|billable amount( \([^)]*\))?)$/],
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
  if (!cols.includes('date') && !cols.includes('start')) return { rows: Array.from({ length: Math.max(1, all.length - 1) }, () => null) }
  // the first column of that kind with something in it (Toggl's "Client" is often empty, its "Project" not)
  const at = (r: string[], k: string) => {
    let first = -1
    for (let i = 0; i < cols.length; i++) if (cols[i] === k) { if (first < 0) first = i; if ((r[i] ?? '').trim()) return r[i] }
    return first >= 0 ? (r[first] ?? '') : ''
  }
  // a date column, or the date in a "Clock in" cell that holds a date and a time
  const dayOf = (r: string[]) => dateTime(at(r, 'date'))?.date || at(r, 'date') || dateTime(at(r, 'start'))?.date || ''
  const american = all.slice(1).some((r) => /\d\s*[ap]\.?m\.?$/i.test(at(r, 'start').trim()) || /\d\s*[ap]\.?m\.?$/i.test(at(r, 'end').trim()))
  const mf = monthFirstIn(all.slice(1).map(dayOf), american)
  return {
    rows: all.slice(1).map((r) => {
      const sdt = dateTime(at(r, 'start')), edt = dateTime(at(r, 'end'))
      const date = normDate(dayOf(r), mf), start = normTime(sdt ? sdt.time : at(r, 'start')), end = normTime(edt ? edt.time : at(r, 'end'))
      const bh = at(r, 'breakMin').trim() ? null : normHours(at(r, 'breakHours'))
      const breakMin = bh != null ? bh * 60 : normNum(at(r, 'breakMin')), wage = normNum(at(r, 'wage')), hours = normHours(at(r, 'hours'))
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

/* a calendar file: every timed event a shift on the day it starts, its title the job. Times
   in UTC ("…Z") are shown in `tz`; times with a TZID or none are taken as written (the
   rostering apps write the place's own time). All-day events aren't shifts; cancelled ones
   are left out. */
const icsText = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
function wall(v: string, tz: string): { date: string; time: string; ms: number } | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v.trim())
  if (!m) return null
  let [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]]
  if (m[7]) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(Date.UTC(y, mo - 1, d, h, mi)))
    const get = (t: string) => +(parts.find((p) => p.type === t)?.value || 0);
    [y, mo, d, h, mi] = [get('year'), get('month'), get('day'), get('hour') % 24, get('minute')]
  }
  const date = validDate(y, mo, d)
  if (!date || h > 23 || mi > 59) return null
  return { date, time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, ms: Date.UTC(y, mo - 1, d, h, mi) }
}
function fromIcs(text: string, tz: string): { rows: (ImportedShift | null)[] } {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const rows: (ImportedShift | null)[] = []
  let ev: Record<string, { params: string; value: string }> | null = null
  for (const line of lines) {
    const l = line.trim()
    if (/^BEGIN:VEVENT$/i.test(l)) { ev = {}; continue }
    if (/^END:VEVENT$/i.test(l)) {
      if (ev && !/^CANCELLED$/i.test(ev.STATUS?.value || '')) {
        const s = ev.DTSTART ? wall(ev.DTSTART.value, tz) : null
        let e = ev.DTEND ? wall(ev.DTEND.value, tz) : null
        const dur = /^PT?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(ev.DURATION?.value || '')
        if (s && !e && dur && ev.DURATION?.value) {
          const end = new Date(s.ms + ((+(dur[1] || 0) * 24 + +(dur[2] || 0)) * 60 + +(dur[3] || 0)) * 60000)
          const ymd = `${end.getUTCFullYear()}${String(end.getUTCMonth() + 1).padStart(2, '0')}${String(end.getUTCDate()).padStart(2, '0')}`
          e = wall(`${ymd}T${String(end.getUTCHours()).padStart(2, '0')}${String(end.getUTCMinutes()).padStart(2, '0')}00`, tz)
        }
        const minutes = s && e ? (e.ms - s.ms) / 60000 : 0
        rows.push(s && e && minutes > 0 && minutes <= 24 * 60
          ? { id: null, date: s.date, employer: icsText(ev.SUMMARY?.value || ''), start: s.time, end: e.time, breakMin: 0, paidBreak: false, wage: 0, hours: null, pay: null }
          : null)
      }
      ev = null
      continue
    }
    if (!ev) continue
    const m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(l)
    if (m && !(m[1].toUpperCase() in ev)) ev[m[1].toUpperCase()] = { params: m[2].toUpperCase(), value: m[3] }
  }
  return { rows: rows.length ? rows : [null] }
}

const keyOf = (s: Have) => [s.date, (s.employer || '').trim().toLowerCase(), s.start || '', s.end || '', s.start && s.end ? '' : String(s.hours ?? '')].join('|')

const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin' } catch { return 'Europe/Berlin' } }

export function importShifts(text: string, have: Have[], tz = localZone()): ImportResult {
  const t = text.replace(/^﻿/, '').trim()
  let parsed: { rows: (ImportedShift | null)[] }
  if (/^BEGIN:VCALENDAR/i.test(t)) parsed = fromIcs(t, tz)
  else if (t.startsWith('{') || t.startsWith('[')) {
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
