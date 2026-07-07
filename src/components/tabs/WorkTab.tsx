import { useState, useMemo, Fragment } from 'react'
import { Clock, Trash2, Calendar, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { Theme, Shift } from '../../lib/types'
import type { WorkStats } from '../../lib/derive'
import { deriveShift } from '../../lib/shift'
import { tod, fixDe } from '../../lib/format'
import { haptic } from '../../lib/haptic'
import { WORK, GOLD } from '../../lib/theme'
import { groupShifts, monthMatrix, workedMap, WD1, MO3, type Gran } from '../../lib/workAgg'
import { Ring } from '../ui'

type Hist = Gran | 'cal'
const PERIODS: [Gran, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']]

export default function WorkTab({ T, workStats, shifts, sShifts, fH, fHome, showToast, onLogShift, onEditShift }: {
  T: Theme; workStats: WorkStats; shifts: Shift[]; sShifts: (s: Shift[]) => void
  fH: (v: number) => string; fHome: (v: number) => string | null; hostCur: string
  showToast: (m: string) => void; onLogShift: (date: string | null) => void; onEditShift: (s: Shift) => void
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
  const delShift = (id: string) => { sShifts(shifts.filter((s) => s.id !== id)); haptic(10); showToast('Shift removed') }
  const stepMonth = (dir: number) => { let m = cal.m + dir, y = cal.y; if (m < 0) { m = 11; y-- } if (m > 11) { m = 0; y++ } setCal({ y, m }); setSelDay(null) }

  return (
    <>
      {/* earnings hero */}
      <div style={{ borderRadius: 22, padding: '18px 18px 16px', marginBottom: 12, background: `linear-gradient(135deg,${WORK},${GOLD})`, color: '#06120c', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 }}>{heroLbl}</div>
          <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,.14)', borderRadius: 99, padding: 2 }}>
            {([['month', 'M'], ['year', 'Y'], ['all', '∞']] as const).map(([k, l]) => <button key={k} onClick={() => { haptic(6); setSpan(k) }} style={{ border: 'none', background: span === k ? 'rgba(255,255,255,.85)' : 'transparent', color: '#06120c', borderRadius: 99, width: 26, height: 22, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{l}</button>)}
          </div>
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{fH(heroVal)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.8 }}>{fHome(heroVal) ? `≈ ${fHome(heroVal)}` : ''}</div>
          <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.65 }}>gross · before tax</div>
        </div>
      </div>

      {/* two stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, background: T.card, borderRadius: 16, padding: '13px 14px' }}><div style={{ fontSize: 11, color: T.txt2, fontWeight: 600 }}>This year</div><div style={{ fontSize: 19, fontWeight: 800, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fH(ws.earnYear)}</div></div>
        <div style={{ flex: 1, background: T.card, borderRadius: 16, padding: '13px 14px' }}><div style={{ fontSize: 11, color: T.txt2, fontWeight: 600 }}>Average rate</div><div style={{ fontSize: 19, fontWeight: 800, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{ws.avgRate > 0 ? `${fH(ws.avgRate)}/h` : '—'}</div></div>
      </div>

      {/* compliance pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, background: T.card, borderRadius: 16, padding: '12px 15px', marginBottom: 14 }}>
        <Ring pct={ws.daysUsed / ws.budget} size={44} stroke={5} color={toneC} track={T.border}><span style={{ fontSize: 12, fontWeight: 800 }}>{ws.daysUsed}</span></Ring>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{ws.daysUsed}/120 work-days · <span style={{ color: T.txt2, fontWeight: 500 }}>{fixDe(120 - ws.daysUsed)} left</span></div>
          <div style={{ fontSize: 11, marginTop: 2, color: ws.weekH > 20 ? T.red : ws.weekH >= 16 ? T.amber : T.txt2 }}>This week {fixDe(ws.weekH)}h / 20h term cap</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: toneC, background: T.accSoft, padding: '3px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: 0.5 }}>{ws.tone === 'red' ? 'over' : ws.tone === 'amber' ? 'close' : 'safe'}</span>
      </div>

      {/* history: breakdown + calendar */}
      <span className="h-lbl" style={{ color: T.txt3 }}>History</span>
      <div style={{ background: T.card, borderRadius: 20, padding: '12px 15px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: hist === 'cal' ? 12 : 4 }}>
          <div style={{ display: 'flex', gap: 2, background: T.inp, borderRadius: 99, padding: 2, flex: 1 }}>
            {PERIODS.map(([k, l]) => <button key={k} onClick={() => { haptic(6); setHist(k); setSelDay(null) }} style={{ flex: 1, border: 'none', background: hist === k ? T.acc : 'transparent', color: hist === k ? '#fff' : T.txt2, borderRadius: 99, padding: '7px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{l}</button>)}
          </div>
          <button onClick={() => { haptic(6); setHist('cal') }} style={{ flexShrink: 0, width: 38, height: 34, borderRadius: 10, border: `1px solid ${hist === 'cal' ? T.acc : T.border}`, background: hist === 'cal' ? T.accSoft : 'transparent', color: hist === 'cal' ? T.acc : T.txt2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Calendar size={18} /></button>
        </div>

        {hist !== 'cal' ? (
          rows.length === 0 ? (
            <div style={{ padding: '14px 2px', color: T.txt3, fontSize: 14 }}>No shifts logged yet.</div>
          ) : (
            <div>
              {rows.map((r, i) => {
                const showHeader = !!r.header && (i === 0 || rows[i - 1].header !== r.header)
                return (
                  <Fragment key={r.key}>
                    {showHeader && <div style={{ fontSize: 11, fontWeight: 700, color: T.txt3, letterSpacing: 0.5, margin: '12px 2px 2px' }}>{r.header}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: !showHeader && i > 0 ? `1px solid ${T.border}` : 'none' }}>
                      <span style={{ fontWeight: 600, fontSize: 14, minWidth: 62 }}>{r.label}</span>
                      <span style={{ fontSize: 12, color: T.txt3, flex: 1 }}>{r.sub}</span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fixDe(r.hours, 2)}h</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: WORK, fontVariantNumeric: 'tabular-nums' }}>{fH(r.pay)}</div>
                      </div>
                    </div>
                  </Fragment>
                )
              })}
            </div>
          )
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <button onClick={() => stepMonth(-1)} className="h-press" style={{ background: T.inp, border: 'none', borderRadius: 9, width: 32, height: 32, color: T.txt2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ChevronLeft size={18} /></button>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{MO3[cal.m]} {cal.y}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => { setCal({ y: +now.slice(0, 4), m: +now.slice(5, 7) - 1 }); setSelDay(null) }} className="h-press" style={{ background: 'none', border: 'none', color: T.acc, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Today</button>
                <button onClick={() => stepMonth(1)} className="h-press" style={{ background: T.inp, border: 'none', borderRadius: 9, width: 32, height: 32, color: T.txt2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ChevronRight size={18} /></button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 2 }}>
              {WD1.map((w, i) => <div key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: i >= 5 ? T.txt3 : T.txt2, padding: '2px 0' }}>{w}</div>)}
            </div>
            {weeks.map((wk, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
                {wk.map((date, di) => {
                  if (!date) return <div key={di} style={{ height: 40 }} />
                  const info = worked.get(date)
                  const isToday = date === now
                  const sel = date === selDay
                  const weekend = di >= 5
                  const dnum = +date.slice(8, 10)
                  return (
                    <button key={di} onClick={() => { haptic(6); setSelDay(sel ? null : date) }} style={{ height: 40, border: sel ? `1px solid ${T.acc}` : isToday ? `1px solid ${T.border}` : '1px solid transparent', background: sel ? T.accSoft : 'transparent', borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer' }}>
                      <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 500, color: isToday ? T.acc : weekend ? T.txt3 : T.txt }}>{dnum}</span>
                      <span style={{ width: 5, height: 5, borderRadius: 99, background: info ? WORK : 'transparent' }} />
                    </button>
                  )
                })}
              </div>
            ))}
            {selDay && (() => {
              const dayShifts = shifts.filter((s) => s.date === selDay).sort((a, b) => (a.start || '').localeCompare(b.start || ''))
              const pretty = new Date(selDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
              return (
                <div style={{ marginTop: 12, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.txt2, marginBottom: 8 }}>{pretty}</div>
                  {dayShifts.length === 0 ? (
                    <div style={{ fontSize: 13, color: T.txt3, marginBottom: 10 }}>No shift logged on this day.</div>
                  ) : (
                    dayShifts.map((s) => {
                      const d = deriveShift(s)
                      return (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0' }}>
                          <div style={{ width: 32, height: 32, borderRadius: 10, background: T.accSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Clock size={16} color={WORK} /></div>
                          <div onClick={() => onEditShift(s)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{s.employer || 'Shift'}</div>
                            <div style={{ fontSize: 11, color: T.txt2 }}>{s.start ? `${s.start}–${s.end} · ` : ''}{fixDe(d.paidHours, 2)}h</div>
                          </div>
                          {d.pay > 0 && <div style={{ fontWeight: 700, fontSize: 14, color: WORK, fontVariantNumeric: 'tabular-nums' }}>{fH(d.pay)}</div>}
                          <button onClick={() => delShift(s.id)} style={{ background: 'none', border: 'none', color: T.txt3, cursor: 'pointer', display: 'flex', padding: 4 }}><Trash2 size={15} /></button>
                        </div>
                      )
                    })
                  )}
                  <button onClick={() => onLogShift(selDay)} className="h-press" style={{ width: '100%', background: T.accSoft, color: WORK, border: 'none', borderRadius: 12, padding: '11px', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4 }}><Plus size={16} />{dayShifts.length ? 'Log another shift' : 'Log shift on this day'}</button>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* by employer */}
      {ws.byEmployer.length > 0 && (
        <>
          <span className="h-lbl" style={{ color: T.txt3 }}>This month by employer</span>
          <div style={{ background: T.card, borderRadius: 20, padding: '6px 15px 10px', marginBottom: 14 }}>
            {ws.byEmployer.map((e, i) => (
              <div key={e.name} style={{ padding: '9px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}><span style={{ fontWeight: 600 }}>{e.name}</span><span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fH(e.pay)}</span></div>
                <div style={{ height: 6, background: T.inp, borderRadius: 99, overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 99, width: `${ws.earnMonth > 0 ? Math.max((e.pay / ws.earnMonth) * 100, 3) : 0}%`, background: `linear-gradient(90deg,${WORK},${GOLD})` }} /></div>
                <div style={{ fontSize: 10, color: T.txt3, marginTop: 3 }}>{fixDe(e.hours)}h · Ø {fH(e.wage)}/h</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* recent shifts */}
      <span className="h-lbl" style={{ color: T.txt3 }}>Recent shifts</span>
      <div style={{ background: T.card, borderRadius: 20, overflow: 'hidden', marginBottom: 14 }}>
        {recent.length === 0 ? (
          <div style={{ padding: '16px', color: T.txt3, fontSize: 14 }}>No shifts logged yet.</div>
        ) : (
          recent.map((s, i) => {
            const d = deriveShift(s)
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 15px', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                <div style={{ width: 36, height: 36, borderRadius: 11, background: T.accSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Clock size={18} color={WORK} /></div>
                <div onClick={() => onEditShift(s)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>{s.employer || 'Shift'}{d.overnight && <span style={{ fontSize: 9, fontWeight: 700, background: T.inp, color: T.txt2, padding: '1px 6px', borderRadius: 6 }}>overnight</span>}</div>
                  <div style={{ fontSize: 11, color: T.txt2 }}>{s.date}{s.start ? ` · ${s.start}–${s.end}` : ''} · {fixDe(d.paidHours)}h</div>
                </div>
                <div style={{ textAlign: 'right' }}>{d.pay > 0 ? <div style={{ fontWeight: 700, fontSize: 14, color: WORK, fontVariantNumeric: 'tabular-nums' }}>{fH(d.pay)}</div> : <div style={{ fontSize: 11, color: T.txt3 }}>no wage</div>}</div>
                <button onClick={() => delShift(s.id)} style={{ background: 'none', border: 'none', color: T.txt3, cursor: 'pointer', display: 'flex', padding: 4 }}><Trash2 size={14} /></button>
              </div>
            )
          })
        )}
      </div>

      <button onClick={() => onLogShift(null)} className="h-press" style={{ width: '100%', background: WORK, color: '#06120c', border: 'none', borderRadius: 16, padding: '15px', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>+ Log a work shift</button>
      <div style={{ fontSize: 11, color: T.txt3, textAlign: 'center', marginTop: 12, lineHeight: 1.55 }}>Guidance only, not legal advice. Roughly 120 full days (or 240 half-days under 4h) per year; Werkstudent ~20h/week in term. Earnings are gross — take-home is lower after tax & social. Confirm your exact limit with your international office.</div>
    </>
  )
}
