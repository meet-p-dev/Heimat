import { useState, useMemo, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { Clock, Calendar, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { Theme, Shift } from '../../lib/types'
import type { WorkStats } from '../../lib/derive'
import { deriveShift } from '../../lib/shift'
import { tod, fixDe, relDay } from '../../lib/format'
import { haptic } from '../../lib/haptic'
import { WORK, GOLD } from '../../lib/theme'
import { groupShifts, monthMatrix, workedMap, WD1, MO3, type Gran } from '../../lib/workAgg'
import { Ring, Card, SegmentedControl, SectionLabel, IconBtn } from '../ui'

type Hist = Gran | 'cal'
const PERIODS: [Gran, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']]

export default function WorkTab({ T, workStats, shifts, fH, fHome, onLogShift, onEditShift, openSettings }: {
  T: Theme; workStats: WorkStats; shifts: Shift[]
  fH: (v: number) => string; fHome: (v: number) => string | null
  onLogShift: (date: string | null) => void; onEditShift: (s: Shift) => void; openSettings: () => void
}) {
  const ws = workStats
  const [span, setSpan] = useState<'month' | 'year' | 'all'>('month')
  const [hist, setHist] = useState<Hist>('month')
  const now = tod()
  const [cal, setCal] = useState<{ y: number; m: number }>({ y: +now.slice(0, 4), m: +now.slice(5, 7) - 1 })
  const [selDay, setSelDay] = useState<string | null>(null)

  const heroVal = span === 'month' ? ws.earnMonth : span === 'year' ? ws.earnYear : ws.earnAll
  const heroLbl = span === 'month' ? 'Earned this month' : span === 'year' ? 'Earned this year' : 'Earned all-time'
  const toneC = ws.tone === 'red' ? T.red : ws.tone === 'amber' ? T.amber : WORK
  const recent = useMemo(() => [...shifts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12), [shifts])
  const rows = useMemo(() => (hist === 'cal' ? [] : groupShifts(shifts, hist)), [shifts, hist])
  const worked = useMemo(() => workedMap(shifts), [shifts])
  const weeks = useMemo(() => monthMatrix(cal.y, cal.m), [cal])
  const stepMonth = (dir: number) => { let m = cal.m + dir, y = cal.y; if (m < 0) { m = 11; y-- } if (m > 11) { m = 0; y++ } setCal({ y, m }); setSelDay(null) }
  const left = Math.max(ws.budget - ws.daysUsed, 0)

  return (
    <>
      {/* earnings hero */}
      <div style={{ borderRadius: 28, padding: '20px 18px 18px', marginBottom: 12, background: `radial-gradient(120% 90% at 0% 0%,rgba(255,255,255,.35),transparent 55%),linear-gradient(135deg,${WORK},${GOLD})`, color: '#06120c', boxShadow: `0 18px 40px -18px ${WORK}, inset 0 1px 0 rgba(255,255,255,.5)` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, opacity: 0.75 }}>{heroLbl}</div>
          <div role="group" aria-label="Period" style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,.14)', borderRadius: 99, padding: 3 }}>
            {([['month', 'M', 'This month'], ['year', 'Y', 'This year'], ['all', '∞', 'All time']] as const).map(([k, l, a]) => <button key={k} type="button" aria-label={a} aria-pressed={span === k} onClick={() => { haptic(6); setSpan(k) }} style={{ border: 'none', background: span === k ? 'rgba(255,255,255,.88)' : 'transparent', color: '#06120c', borderRadius: 99, width: 30, height: 26, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', transition: 'background .2s' }}>{l}</button>)}
          </div>
        </div>
        <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: -1.4, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{fH(heroVal)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 2 }}>
          <div style={{ fontSize: 13.5, fontWeight: 650, opacity: 0.8 }}>{fHome(heroVal) ? `≈ ${fHome(heroVal)}` : ''}</div>
          <div style={{ fontSize: 12, fontWeight: 650, opacity: 0.65 }}>gross · before tax</div>
        </div>
      </div>

      <button type="button" onClick={() => onLogShift(null)} className="btn btn-lg btn-full" style={{ background: `linear-gradient(180deg,rgba(255,255,255,.3),rgba(255,255,255,0) 55%),${WORK}`, color: '#06120c', marginBottom: 12, boxShadow: `0 10px 24px -12px ${WORK}, inset 0 1px 0 rgba(255,255,255,.45)` }}><Plus size={19} strokeWidth={2.6} /> Log a work shift</button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card T={T} style={{ padding: '13px 14px', borderRadius: 22 }}><div style={{ fontSize: 12.5, color: T.txt2, fontWeight: 600 }}>This year</div><div style={{ fontSize: 20, fontWeight: 800, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fH(ws.earnYear)}</div></Card>
        <Card T={T} style={{ padding: '13px 14px', borderRadius: 22 }}><div style={{ fontSize: 12.5, color: T.txt2, fontWeight: 600 }}>Average rate</div><div style={{ fontSize: 20, fontWeight: 800, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{ws.avgRate > 0 ? `${fH(ws.avgRate)}/h` : '—'}</div></Card>
      </div>

      {/* compliance */}
      <Card T={T} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 22 }}>
        <Ring pct={ws.daysUsed / ws.budget} size={52} stroke={6} color={toneC} track={T.border}><span style={{ fontSize: 13, fontWeight: 800 }}>{fixDe(ws.daysUsed, ws.daysUsed % 1 ? 1 : 0)}</span></Ring>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>{fixDe(ws.daysUsed, ws.daysUsed % 1 ? 1 : 0)} of {ws.budget} work days <span style={{ color: T.txt2, fontWeight: 500 }}>· {fixDe(left, left % 1 ? 1 : 0)} left</span></div>
          <div style={{ fontSize: 12.5, marginTop: 3, color: ws.weekH > ws.weekCap ? T.red : ws.weekH >= ws.weekCap * 0.8 ? T.amber : T.txt2 }}>This week {fixDe(ws.weekH)} h of {ws.weekCap} h in term</div>
        </div>
        <span className="h-pill" style={{ background: `color-mix(in srgb, ${toneC} 16%, transparent)`, color: toneC, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>{ws.tone === 'red' ? 'over' : ws.tone === 'amber' ? 'close' : 'safe'}</span>
      </Card>

      {/* history */}
      <SectionLabel T={T}>History</SectionLabel>
      <Card T={T} style={{ padding: '12px 14px', borderRadius: 24 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <div style={{ flex: 1, opacity: hist === 'cal' ? 0.55 : 1 }}><SegmentedControl T={T} label="Group by" options={PERIODS} value={hist === 'cal' ? 'month' : hist} onChange={(k) => { setHist(k); setSelDay(null) }} /></div>
          <IconBtn label="Calendar" onClick={() => { haptic(6); setHist(hist === 'cal' ? 'month' : 'cal') }} style={hist === 'cal' ? { color: T.acc, boxShadow: `0 0 0 2px ${T.acc}` } : undefined}><Calendar size={18} /></IconBtn>
        </div>

        {hist !== 'cal' ? (
          rows.length === 0 ? (
            <div style={{ padding: '14px 2px 6px', color: T.txt2, fontSize: 14 }}>No shifts logged yet.</div>
          ) : (
            <div>
              {rows.map((r, i) => {
                const showHeader = !!r.header && (i === 0 || rows[i - 1].header !== r.header)
                return (
                  <Fragment key={r.key}>
                    {showHeader && <div style={{ fontSize: 12, fontWeight: 700, color: T.txt3, margin: '12px 2px 2px' }}>{r.header}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px', borderTop: !showHeader && i > 0 ? `1px solid ${T.border}` : 'none' }}>
                      <span style={{ fontWeight: 650, fontSize: 14.5, minWidth: 66 }}>{r.label}</span>
                      <span style={{ fontSize: 12.5, color: T.txt3, flex: 1 }}>{r.sub} {r.sub === 1 ? 'shift' : 'shifts'}</span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{fixDe(r.hours, 2)} h</div>
                        <div style={{ fontSize: 12.5, fontWeight: 750, color: WORK, fontVariantNumeric: 'tabular-nums' }}>{fH(r.pay)}</div>
                      </div>
                    </div>
                  </Fragment>
                )
              })}
            </div>
          )
        ) : (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <IconBtn label="Previous month" size={34} onClick={() => stepMonth(-1)}><ChevronLeft size={18} /></IconBtn>
              <div style={{ fontWeight: 750, fontSize: 15.5 }}>{MO3[cal.m]} {cal.y}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" onClick={() => { setCal({ y: +now.slice(0, 4), m: +now.slice(5, 7) - 1 }); setSelDay(null) }} className="h-link" style={{ fontSize: 13.5 }}>Today</button>
                <IconBtn label="Next month" size={34} onClick={() => stepMonth(1)}><ChevronRight size={18} /></IconBtn>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 2 }}>
              {WD1.map((w, i) => <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: i >= 5 ? T.txt3 : T.txt2, padding: '2px 0' }}>{w}</div>)}
            </div>
            {weeks.map((wk, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
                {wk.map((date, di) => {
                  if (!date) return <div key={di} style={{ height: 42 }} />
                  const info = worked.get(date)
                  const isToday = date === now
                  const sel = date === selDay
                  return (
                    <button key={di} type="button" aria-label={date} aria-pressed={sel} onClick={() => { haptic(6); setSelDay(sel ? null : date) }} style={{ height: 42, border: 'none', background: sel ? T.acc : isToday ? T.accSoft : 'transparent', borderRadius: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', transition: 'background .2s' }}>
                      <span style={{ fontSize: 13.5, fontWeight: isToday || sel ? 800 : 500, color: sel ? T.onAcc : isToday ? T.acc : di >= 5 ? T.txt3 : T.txt }}>{+date.slice(8, 10)}</span>
                      <span style={{ width: 5, height: 5, borderRadius: 99, background: info ? (sel ? T.onAcc : WORK) : 'transparent' }} />
                    </button>
                  )
                })}
              </div>
            ))}
            {selDay && (() => {
              const dayShifts = shifts.filter((s) => s.date === selDay).sort((a, b) => (a.start || '').localeCompare(b.start || ''))
              const pretty = new Date(selDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
              return (
                <div style={{ marginTop: 12, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.txt2, marginBottom: 6 }}>{pretty}</div>
                  {dayShifts.length === 0
                    ? <div style={{ fontSize: 13.5, color: T.txt3, marginBottom: 10 }}>No shift logged on this day.</div>
                    : dayShifts.map((s) => {
                        const d = deriveShift(s)
                        return (
                          <button key={s.id} type="button" onClick={() => onEditShift(s)} className="h-item" style={{ padding: '9px 2px', minHeight: 0 }}>
                            <span className="h-item-ic" style={{ background: WORK }}><Clock size={16} /></span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontWeight: 600, fontSize: 14.5 }}>{s.employer || 'Shift'}</span>
                              <span style={{ display: 'block', fontSize: 12, color: T.txt3 }}>{s.start ? `${s.start}–${s.end} · ` : ''}{fixDe(d.paidHours, 2)} h</span>
                            </span>
                            {d.pay > 0 && <span style={{ fontWeight: 750, fontSize: 14.5, color: WORK, fontVariantNumeric: 'tabular-nums' }}>{fH(d.pay)}</span>}
                          </button>
                        )
                      })}
                  <button type="button" onClick={() => onLogShift(selDay)} className="btn btn-md btn-full btn-tinted" style={{ marginTop: 6 }}><Plus size={16} />{dayShifts.length ? 'Log another shift' : 'Log a shift on this day'}</button>
                </div>
              )
            })()}
          </div>
        )}
      </Card>

      {ws.byEmployer.length > 0 && (
        <>
          <SectionLabel T={T}>This month by employer</SectionLabel>
          <Card T={T} style={{ padding: '6px 16px 12px', borderRadius: 24 }}>
            {ws.byEmployer.map((e, i) => (
              <div key={e.name} style={{ padding: '10px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}><span style={{ fontWeight: 650 }}>{e.name}</span><span style={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{fH(e.pay)}</span></div>
                <div style={{ height: 7, background: T.inp, borderRadius: 99, overflow: 'hidden' }}><div className="h-grow" style={{ height: '100%', borderRadius: 99, transformOrigin: 'left', width: `${ws.earnMonth > 0 ? Math.max((e.pay / ws.earnMonth) * 100, 3) : 0}%`, background: `linear-gradient(90deg,${WORK},${GOLD})` }} /></div>
                <div style={{ fontSize: 11.5, color: T.txt3, marginTop: 4 }}>{fixDe(e.hours)} h · Ø {fH(e.wage)}/h</div>
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionLabel T={T}>Recent shifts</SectionLabel>
      <div className="glass" style={{ borderRadius: 24, overflow: 'hidden' }}>
        {recent.length === 0 ? (
          <div style={{ padding: 18, color: T.txt2, fontSize: 14, lineHeight: 1.5 }}>No shifts logged yet. Log your first one and Heimat keeps count of your hours and pay.</div>
        ) : recent.map((s) => {
          const d = deriveShift(s)
          return (
            <button key={s.id} type="button" className="h-item" onClick={() => onEditShift(s)} style={{ '--inset': '61px' } as CSSProperties}>
              <span className="h-item-ic" style={{ background: WORK }}><Clock size={17} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 15 }}>{s.employer || 'Shift'}{d.overnight && <span className="h-pill" style={{ background: T.inp, color: T.txt2, fontSize: 10, padding: '2px 7px' }}>overnight</span>}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: T.txt3, marginTop: 2 }}>{relDay(s.date)}{s.start ? ` · ${s.start}–${s.end}` : ''} · {fixDe(d.paidHours)} h</span>
              </span>
              {d.pay > 0 ? <span style={{ fontWeight: 750, fontSize: 15, color: WORK, fontVariantNumeric: 'tabular-nums' }}>{fH(d.pay)}</span> : <span style={{ fontSize: 12, color: T.txt3 }}>no wage</span>}
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: 12, color: T.txt3, textAlign: 'center', margin: '16px 8px 0', lineHeight: 1.55 }}>
        Guidance only, not legal advice. Your limits: {ws.budget} full days a year (a shift under 4 h counts as half) and {ws.weekCap} h a week in term. Earnings are gross.{' '}
        <button type="button" className="h-link" style={{ fontSize: 12 }} onClick={openSettings}>Change limits</button>
      </div>
    </>
  )
}
