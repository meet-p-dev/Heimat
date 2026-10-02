import { useState, useMemo } from 'react'
import { Landmark, ChevronRight } from 'lucide-react'
import type { Theme, Profile, Shift } from '../lib/types'
import type { TaxProfile, JobKind } from '../lib/tax/estimate.ts'
import { monthDeductions } from '../lib/tax/estimate.ts'
import { deriveShift } from '../lib/shift'
import { tod } from '../lib/format'
import { haptic } from '../lib/haptic'
import { Card, Sheet, Field, Btn, Toggle, Stepper, SegmentedControl, Group, Item } from './ui'

/* This month's pay after what the employer withholds (src/lib/tax/estimate.ts) — Germany,
   2026. The same figures on iOS (TaxViews.swift runs the same code). */

export const KINDS: [JobKind, string, string][] = [
  ['werkstudent', 'Working student', 'Enrolled, up to 20 h a week in term: pension only'],
  ['minijob', 'Minijob', 'Up to 603 € a month: nothing comes off'],
  ['regular', 'Regular job', 'Full contributions (Midijob rules apply by themselves)'],
  ['shortterm', 'Short-term job', 'Up to 3 months / 70 days a year: no contributions'],
]
const DEFAULT_TAX: TaxProfile = { taxClass: 1, church: false, churchRate: 0.09, kvz: 2.9, children: 0, over23: true, sachsen: false, minijobPensionOptOut: true }

/* each employer this month: what it paid, its kind, and which one is the main job */
export function monthJobs(shifts: Shift[], profile: Profile) {
  const month = tod().slice(0, 7)
  const by = new Map<string, number>()
  for (const s of shifts) if (s.date.slice(0, 7) === month) by.set(s.employer || 'Job', (by.get(s.employer || 'Job') || 0) + (deriveShift(s).pay || 0))
  const jobs = profile.jobs || {}
  const student = (profile.doing || ['study']).includes('study')
  const names = [...by.keys()].sort((a, b) => (by.get(b) || 0) - (by.get(a) || 0))
  const main = names.find((n) => jobs[n]?.main) || names[0]
  return names.map((n) => ({ employer: n, gross: Math.round((by.get(n) || 0) * 100) / 100, kind: (jobs[n]?.kind || (student ? 'werkstudent' : 'regular')) as JobKind, main: n === main }))
}

export function TaxCard({ T, shifts, profile, sProfile, fH }: {
  T: Theme; shifts: Shift[]; profile: Profile; sProfile: (p: Profile) => void; fH: (v: number) => string
}) {
  const [open, setOpen] = useState(false)
  const jobs = useMemo(() => monthJobs(shifts, profile), [shifts, profile])
  const m = useMemo(() => (profile.tax ? monthDeductions(jobs, profile.tax as TaxProfile) : null), [jobs, profile.tax])
  return (
    <>
      <Card T={T} onClick={() => { haptic(8); setOpen(true) }} ariaLabel="This month after deductions" style={{ padding: '14px 16px', borderRadius: 22, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 13 }}>
        <span className="h-item-ic" style={{ background: '#6366f1' }}><Landmark size={17} /></span>
        {m && m.gross > 0 ? (
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 12.5, color: T.txt2, fontWeight: 600 }}>This month after deductions · estimate</span>
            <span style={{ display: 'block', fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>≈ {fH(m.net)}</span>
            <span style={{ display: 'block', fontSize: 12.5, color: T.txt3 }}>of {fH(m.gross)} · tax {fH(m.tax + m.soli + m.churchTax)} · social {fH(m.social)}</span>
          </span>
        ) : (
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{profile.tax ? 'No shifts this month yet' : 'What comes off your pay?'}</span>
            <span style={{ display: 'block', fontSize: 12.5, color: T.txt2 }}>{profile.tax ? 'Log a shift to see this month after tax' : 'Add your tax details once — about a minute'}</span>
          </span>
        )}
        <ChevronRight size={18} color={T.txt3} />
      </Card>
      <TaxSheet T={T} open={open} onClose={() => setOpen(false)} jobs={jobs} profile={profile} sProfile={sProfile} fH={fH} />
    </>
  )
}

function TaxSheet({ T, open, onClose, jobs, profile, sProfile, fH }: {
  T: Theme; open: boolean; onClose: () => void; jobs: ReturnType<typeof monthJobs>; profile: Profile; sProfile: (p: Profile) => void; fH: (v: number) => string
}) {
  const tax = (profile.tax as TaxProfile | undefined) || DEFAULT_TAX
  const set = (patch: Partial<TaxProfile>) => sProfile({ ...profile, tax: { ...tax, ...patch } })
  const setJob = (name: string, patch: { kind?: JobKind; main?: boolean }) => {
    const all = { ...(profile.jobs || {}) }
    if (patch.main) for (const k of Object.keys(all)) all[k] = { ...all[k], main: false }
    const cur = jobs.find((j) => j.employer === name)
    const was = all[name] || { kind: cur?.kind || 'werkstudent', main: cur?.main || false }
    all[name] = { ...was, ...patch }
    sProfile({ ...profile, tax: profile.tax || DEFAULT_TAX, jobs: all })
  }
  const m = profile.tax ? monthDeductions(jobs, tax) : null
  return (
    <Sheet open={open} onClose={onClose} title="Tax & contributions" T={T}>
      {m && m.jobs.length > 0 && (
        <Group T={T} title="This month, estimated" footer="An employer works out each month as if you earned that much all year, so a busy month has more taken off than the year will owe — a tax return gives it back. Germany, 2026 rules.">
          {m.jobs.map((j) => (
            <Item key={j.employer} T={T} label={`${j.employer} · class ${['', 'I', 'II', 'III', 'IV', 'V', 'VI'][j.taxClass]}`}
              sub={`Tax ${fH(j.tax)}${j.soli ? ` · soli ${fH(j.soli)}` : ''}${j.churchTax ? ` · church ${fH(j.churchTax)}` : ''} · health ${fH(j.health + j.care)} · pension ${fH(j.pension)}${j.unemployment ? ` · unempl. ${fH(j.unemployment)}` : ''}${j.notes.length ? ` — ${j.notes.join('; ')}` : ''}`}
              value={`${fH(j.net)} of ${fH(j.gross)}`} />
          ))}
        </Group>
      )}
      {jobs.length > 0 && (
        <Group T={T} title="Your jobs" footer="Your main job uses your tax class; any other job is taxed in class VI.">
          {jobs.map((j) => (
            <div key={j.employer} className="h-item" style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ flex: 1, fontWeight: 650 }}>{j.employer}</span>
                <Btn size="sm" kind={j.main ? 'tinted' : 'ghost'} onClick={() => setJob(j.employer, { main: true })}>{j.main ? 'Main job' : 'Make main'}</Btn>
              </div>
              <select className="fld" value={j.kind} onChange={(e) => setJob(j.employer, { kind: e.target.value as JobKind })}>
                {KINDS.map(([k, l, s]) => <option key={k} value={k}>{l} — {s}</option>)}
              </select>
            </div>
          ))}
        </Group>
      )}
      <Group T={T} title="About you" footer="On your payslip or in your tax ID letter. Children: under 25, for care insurance and the child allowance.">
        <div className="h-item" style={{ display: 'block' }}>
          <div style={{ marginBottom: 8, fontSize: 15 }}>Tax class</div>
          <SegmentedControl T={T} label="Tax class" options={[['1', 'I'], ['2', 'II'], ['3', 'III'], ['4', 'IV'], ['5', 'V'], ['6', 'VI']]} value={String(tax.taxClass)} onChange={(v) => set({ taxClass: Number(v) as TaxProfile['taxClass'] })} />
        </div>
        <Item T={T} label="Church member" sub="Church tax 9 % (8 % in Bavaria and Baden-Württemberg)" right={<Toggle label="Church member" on={tax.church} onChange={(v) => set({ church: v })} />} />
        {tax.church && <Item T={T} label="I live in Bavaria or Baden-Württemberg" right={<Toggle label="Bavaria or Baden-Württemberg" on={tax.churchRate === 0.08} onChange={(v) => set({ churchRate: v ? 0.08 : 0.09 })} />} />}
        <div className="h-item"><span style={{ flex: 1 }}>Children under 25</span><Stepper label="children" value={tax.children} onChange={(v) => set({ children: v })} min={0} max={9} /></div>
        <Item T={T} label="23 or older" right={<Toggle label="23 or older" on={tax.over23} onChange={(v) => set({ over23: v })} />} />
        <Item T={T} label="I work in Saxony" right={<Toggle label="Saxony" on={tax.sachsen} onChange={(v) => set({ sachsen: v })} />} />
        <Item T={T} label="Minijob: freed from the pension contribution" sub="Most people ask for this; otherwise 3,6 % comes off" right={<Toggle label="Freed from pension contribution" on={tax.minijobPensionOptOut} onChange={(v) => set({ minijobPensionOptOut: v })} />} />
      </Group>
      <Field T={T} label="Health fund's extra contribution (%)" htmlFor="tx-kvz" hint="Zusatzbeitrag — 2,9 % on average in 2026; your health fund's site says yours.">
        <input id="tx-kvz" className="fld" inputMode="decimal" defaultValue={String(tax.kvz).replace('.', ',')}
          onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')); if (Number.isFinite(v) && v >= 0 && v < 10) set({ kvz: v }) }} />
      </Field>
      {!profile.tax && <Btn full onClick={() => { sProfile({ ...profile, tax: DEFAULT_TAX }); haptic(12) }}>Use these details</Btn>}
    </Sheet>
  )
}
