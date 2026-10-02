/* What will come off this month's pay, per job, in Germany (2026) — an estimate of what
   the employer withholds, not the year's final tax.

   Tax, solidarity surcharge and church tax come from lohnsteuer2026.gen.ts: the Finance
   Ministry's own plan, generated from its pseudo-code and checked to the cent against its
   calculator (tests/lohnsteuer.test.ts). Social contributions follow SGB IV/V/VI/XI with
   the 2026 figures below; how each kind of job is entered follows the Ministry's letter of
   14 August 2025 on the Vorsorgepauschale (students who pay no health contribution from
   the job: PKV = 1; the Midijob's reduced base counts for contributions, not for tax).

   An employer works each month as if it were the whole year at that pay, so a month with
   many shifts has more withheld than the year will owe — the tax return gives it back.
   The iPhone runs this same file (bundled by scripts/bundle-tax.sh into JavaScriptCore). */

import { lohnsteuer2026, BigDecimal } from './lohnsteuer2026.gen.ts'

/* the 2026 figures: rates per employee (half), monthly ceilings, the Midijob band */
export const Y2026 = {
  kv: 0.073, pv: 0.018, pvSachsen: 0.023, pvChildless: 0.006, pvPerChild: 0.0025,
  rv: 0.093, av: 0.013, rvMinijob: 0.036,
  bbgKvPv: 5812.5, bbgRvAv: 8450,
  miniMax: 603, midiMax: 2000,
}

export type JobKind =
  | 'minijob'        // up to 603 € a month; the employer pays a flat 2 % tax
  | 'werkstudent'    // enrolled student, up to 20 h a week in term: pension contribution only
  | 'shortterm'      // kurzfristige Beschäftigung (≤ 3 months / 70 days a year): no contributions
  | 'regular'        // everything else, the Midijob band included (it applies by itself)

export interface TaxProfile {
  taxClass: 1 | 2 | 3 | 4 | 5 | 6
  church: boolean
  churchRate: 0.08 | 0.09          // 8 % in Bavaria and Baden-Württemberg, 9 % elsewhere
  kvz: number                      // the health fund's extra contribution, % (2,9 on average)
  children: number                 // children under 25 (care insurance) — also the tax child allowance
  over23: boolean                  // the childless surcharge starts at 23
  sachsen: boolean
  minijobPensionOptOut: boolean    // most Minijobbers ask to be freed from the 3,6 %
}

export interface JobMonth { employer: string; gross: number; kind: JobKind; main: boolean }

export interface Deductions {
  employer: string; gross: number; kind: JobKind; taxClass: number
  tax: number; soli: number; churchTax: number
  health: number; care: number; pension: number; unemployment: number
  net: number
  notes: string[]
}

const cents = (x: number) => Math.round(x * 100)
const euro = (c: number) => c / 100
// a contribution: the base times the rate, to the cent (commercial rounding)
const part = (base: number, rate: number) => euro(Math.round(base * rate * 100 + Number.EPSILON))

export function deductions(job: JobMonth, p: TaxProfile): Deductions {
  const g = Math.max(0, job.gross)
  const taxClass = job.main ? p.taxClass : 6
  const notes: string[] = []
  const r: Deductions = { employer: job.employer, gross: g, kind: job.kind, taxClass, tax: 0, soli: 0, churchTax: 0, health: 0, care: 0, pension: 0, unemployment: 0, net: g, notes }
  if (g === 0) return r

  // ── social contributions ──
  const kind = job.kind === 'minijob' && g > Y2026.miniMax ? 'regular' : job.kind
  if (job.kind === 'minijob' && g > Y2026.miniMax) notes.push(`Over ${Y2026.miniMax} € this month, so it counts as a normal job`)
  const midi = g > Y2026.miniMax && g <= Y2026.midiMax
  // the Midijob's reduced base for the employee's share (§ 20 Abs. 2a SGB IV)
  const midiBase = midi ? (Y2026.midiMax / (Y2026.midiMax - Y2026.miniMax)) * (g - Y2026.miniMax) : g
  if (kind === 'minijob') {
    if (!p.minijobPensionOptOut) r.pension = part(g, Y2026.rvMinijob)
  } else if (kind === 'werkstudent') {
    r.pension = part(Math.min(midi ? midiBase : g, Y2026.bbgRvAv), Y2026.rv)
  } else if (kind === 'regular') {
    const kvBase = Math.min(midi ? midiBase : g, Y2026.bbgKvPv)
    const rvBase = Math.min(midi ? midiBase : g, Y2026.bbgRvAv)
    const pvRate = (p.sachsen ? Y2026.pvSachsen : Y2026.pv)
      + (p.children === 0 && p.over23 ? Y2026.pvChildless : 0)
      - (p.children >= 2 ? Y2026.pvPerChild * Math.min(p.children - 1, 4) : 0)
    r.health = part(kvBase, Y2026.kv + p.kvz / 200)
    r.care = part(kvBase, pvRate)
    r.pension = part(rvBase, Y2026.rv)
    r.unemployment = part(rvBase, Y2026.av)
    if (midi) notes.push('Midijob: contributions on a reduced base')
  }

  // ── tax: the Ministry's plan, one month (LZZ 2) ──
  if (kind === 'minijob') {
    notes.push('Minijob: the employer pays a flat 2 % tax, nothing comes off your pay')
  } else {
    const noHealthFromJob = kind === 'werkstudent' || kind === 'shortterm'
    const out = lohnsteuer2026({
      LZZ: 2, RE4: cents(g), STKL: taxClass,
      KVZ: String(p.kvz), PKV: noHealthFromJob ? 1 : 0,
      PVZ: p.children === 0 && p.over23 && !noHealthFromJob ? 1 : 0,
      PVA: String(p.children >= 2 && !noHealthFromJob ? Math.min(p.children - 1, 4) : 0),
      PVS: p.sachsen ? 1 : 0,
      KRV: kind === 'shortterm' ? 1 : 0,
      ALV: kind === 'regular' ? 0 : 1,
      R: p.church ? 1 : 0,
      ZKF: String(taxClass <= 4 ? p.children : 0),
    })
    r.tax = euro(Number(out.LSTLZZ.toString()))
    r.soli = euro(Number(out.SOLZLZZ.toString()))
    // church tax: the rate on its own base (BK, in cent), whole cents down
    r.churchTax = p.church ? euro(Number(out.BK.multiply(BigDecimal.valueOf(p.churchRate)).setScale(0, BigDecimal.ROUND_DOWN).toString())) : 0
    if (taxClass === 6) notes.push('A second job is taxed in class VI')
  }
  r.net = euro(cents(g) - cents(r.tax) - cents(r.soli) - cents(r.churchTax) - cents(r.health) - cents(r.care) - cents(r.pension) - cents(r.unemployment))
  return r
}

/* every job this month, and the sum */
export function monthDeductions(jobs: JobMonth[], p: TaxProfile) {
  const each = jobs.filter((j) => j.gross > 0).map((j) => deductions(j, p))
  const sum = (k: keyof Deductions) => euro(each.reduce((a, d) => a + cents(d[k] as number), 0))
  return {
    jobs: each,
    gross: sum('gross'), tax: sum('tax'), soli: sum('soli'), churchTax: sum('churchTax'),
    social: euro(['health', 'care', 'pension', 'unemployment'].reduce((a, k) => a + each.reduce((b, d) => b + cents(d[k as keyof Deductions] as number), 0), 0)),
    net: sum('net'),
  }
}
