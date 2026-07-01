import { useState, useEffect, useMemo } from 'react'
import type { Theme, Shift } from '../../lib/types'
import { tod } from '../../lib/format'
import { toMin } from '../../lib/shift'
import { haptic } from '../../lib/haptic'
import { WORK } from '../../lib/theme'
import { Sheet, Field, inpStyle } from '../ui'

export default function ShiftModal({ open, onClose, T, shifts, sShifts, showToast, hostCur, initialDate }: {
  open: boolean; onClose: () => void; T: Theme; shifts: Shift[]; sShifts: (s: Shift[]) => void
  showToast: (m: string) => void; hostCur: string; initialDate?: string | null
}) {
  const employers = useMemo(() => [...new Set(shifts.map((s) => s.employer).filter(Boolean))], [shifts, open])
  const wageFor = (name: string) => { const last = shifts.find((s) => s.employer === name && s.wage); return last ? String(last.wage) : '' }
  const [date, setDate] = useState(tod())
  const [emp, setEmp] = useState('')
  const [newEmp, setNewEmp] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [brk, setBrk] = useState('0')
  const [paidBreak, setPaidBreak] = useState(false)
  const [wage, setWage] = useState('')
  useEffect(() => {
    if (open) {
      setDate(initialDate || tod()); setEmp(employers[0] || ''); setNewEmp(employers.length === 0)
      setStart(''); setEnd(''); setBrk('0'); setPaidBreak(false); setWage(employers[0] ? wageFor(employers[0]) : '')
    }
  }, [open])
  const d = useMemo(() => {
    if (!start || !end) return { paidHours: 0, pay: 0, overnight: false, valid: false }
    const gross = (toMin(end) - toMin(start) + 1440) % 1440
    const bm = parseFloat(brk) || 0
    const worked = Math.max(0, gross - bm)
    const paidMin = paidBreak ? gross : worked
    const ph = paidMin / 60
    const w = parseFloat(wage) || 0
    return { paidHours: ph, pay: ph * w, overnight: toMin(end) <= toMin(start) && start !== end, valid: ph > 0 }
  }, [start, end, brk, paidBreak, wage])
  const fy = (v: number) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: hostCur }).format(v || 0) } catch { return String(v) } }
  const save = () => {
    if (!d.valid) return
    const employer = emp.trim()
    sShifts([{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date, employer, start, end, breakMin: parseFloat(brk) || 0, paidBreak, wage: parseFloat(wage) || 0, hours: d.paidHours, pay: d.pay }, ...shifts])
    haptic(12); showToast('Shift logged'); onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Log work shift" T={T}>
      <Field label="Date" T={T}><input value={date} onChange={(e) => setDate(e.target.value)} type="date" style={inpStyle(T)} /></Field>
      <Field label="Employer" T={T}>
        {!newEmp && employers.length > 0 ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={emp} onChange={(e) => { setEmp(e.target.value); setWage(wageFor(e.target.value)) }} style={inpStyle(T)}>{employers.map((n) => <option key={n} value={n}>{n}</option>)}</select>
            <button onClick={() => { setNewEmp(true); setEmp('') }} className="h-press" style={{ flexShrink: 0, background: T.card, color: T.acc, border: `1px solid ${T.border}`, borderRadius: 12, padding: '0 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ New</button>
          </div>
        ) : (
          <input value={emp} onChange={(e) => setEmp(e.target.value)} placeholder="e.g. Café job" style={inpStyle(T)} />
        )}
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Start" T={T}><input value={start} onChange={(e) => setStart(e.target.value)} type="time" style={inpStyle(T)} /></Field>
        <Field label="End" T={T}><input value={end} onChange={(e) => setEnd(e.target.value)} type="time" style={inpStyle(T)} /></Field>
      </div>
      {d.overnight && <div style={{ fontSize: 11, color: T.amber, marginTop: -8, marginBottom: 12, fontWeight: 600 }}>+1 day · overnight shift</div>}
      <Field label="Break (minutes)" T={T}>
        <input value={brk} onChange={(e) => setBrk(e.target.value)} type="number" inputMode="numeric" style={inpStyle(T)} />
        <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>{['0', '30', '45', '60'].map((b) => <button key={b} onClick={() => setBrk(b)} style={{ flex: 1, background: brk === b ? T.acc : T.inp, color: brk === b ? '#fff' : T.txt2, border: `1px solid ${brk === b ? T.acc : T.border}`, borderRadius: 10, padding: '7px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{b}m</button>)}</div>
        <div onClick={() => setPaidBreak(!paidBreak)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, cursor: 'pointer' }}><span style={{ fontSize: 13, color: T.txt2 }}>Break is paid</span><div style={{ width: 42, height: 25, borderRadius: 99, background: paidBreak ? T.acc : T.border, position: 'relative' }}><div style={{ position: 'absolute', top: 2, left: paidBreak ? 19 : 2, width: 21, height: 21, borderRadius: 99, background: '#fff', transition: 'left .2s' }} /></div></div>
      </Field>
      <Field label={`Wage per hour (${hostCur})`} T={T}><input value={wage} onChange={(e) => setWage(e.target.value)} type="number" inputMode="decimal" placeholder="e.g. 13.50" style={{ ...inpStyle(T), fontSize: 18, fontWeight: 700 }} /></Field>
      <div style={{ background: T.accSoft, borderRadius: 14, padding: '12px 15px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: T.txt2, fontWeight: 600 }}>Paid: <span style={{ color: T.txt, fontWeight: 800 }}>{d.paidHours.toFixed(2)} h</span></span>
        <span style={{ fontSize: 17, fontWeight: 800, color: WORK }}>{fy(d.pay)} <span style={{ fontSize: 10, fontWeight: 600, color: T.txt3 }}>gross</span></span>
      </div>
      <button onClick={save} disabled={!d.valid} className="h-press" style={{ width: '100%', background: d.valid ? WORK : T.border, color: '#06120c', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 800, fontSize: 16, cursor: d.valid ? 'pointer' : 'default' }}>{d.valid ? 'Log shift' : 'Enter start & end time'}</button>
    </Sheet>
  )
}
