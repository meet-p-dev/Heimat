import { useState, useEffect, useMemo } from 'react'
import { Trash2, Plus, Moon } from 'lucide-react'
import type { Theme, Shift } from '../../lib/types'
import { tod, numVal, fixDe, money } from '../../lib/format'
import { toMin } from '../../lib/shift'
import { haptic } from '../../lib/haptic'
import { WORK } from '../../lib/theme'
import { Sheet, Field, Btn, Chip, Toggle } from '../ui'

export default function ShiftModal({ open, onClose, T, shifts, sShifts, showToast, hostCur, initialDate, editing }: {
  open: boolean; onClose: () => void; T: Theme; shifts: Shift[]; sShifts: (s: Shift[]) => void
  showToast: (m: string) => void; hostCur: string; initialDate?: string | null; editing?: Shift | null
}) {
  const employers = useMemo(() => [...new Set(shifts.map((s) => s.employer).filter(Boolean))], [shifts, open])
  const wageFor = (name: string) => { const last = shifts.find((s) => s.employer === name && s.wage); return last ? String(last.wage).replace('.', ',') : '' }
  const [date, setDate] = useState(tod())
  const [emp, setEmp] = useState('')
  const [newEmp, setNewEmp] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [brk, setBrk] = useState('0')
  const [paidBreak, setPaidBreak] = useState(false)
  const [wage, setWage] = useState('')
  useEffect(() => {
    if (!open) return
    if (editing) {
      setDate(editing.date); setEmp(editing.employer || ''); setNewEmp(!editing.employer)
      setStart(editing.start || ''); setEnd(editing.end || ''); setBrk(String(editing.breakMin ?? 0))
      setPaidBreak(!!editing.paidBreak); setWage(editing.wage ? String(editing.wage).replace('.', ',') : '')
    } else {
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
    const w = numVal(wage)
    return { paidHours: ph, pay: ph * w, overnight: toMin(end) <= toMin(start) && start !== end, valid: ph > 0 }
  }, [start, end, brk, paidBreak, wage])
  const save = () => {
    if (!d.valid) return
    const employer = emp.trim()
    const row: Shift = { id: editing ? editing.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date, employer, start, end, breakMin: parseFloat(brk) || 0, paidBreak, wage: numVal(wage), hours: d.paidHours, pay: d.pay }
    if (editing) sShifts(shifts.map((s) => (s.id === editing.id ? row : s)))
    else sShifts([row, ...shifts])
    haptic(12); showToast(editing ? 'Shift updated' : 'Shift logged'); onClose()
  }
  const del = () => {
    if (!editing || !confirm('Delete this shift?')) return
    sShifts(shifts.filter((s) => s.id !== editing.id)); haptic(10); showToast('Shift deleted'); onClose()
  }
  const workBtn = { background: WORK, color: '#06120c', boxShadow: `0 10px 24px -12px ${WORK}, inset 0 1px 0 rgba(255,255,255,.45)` }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit shift' : 'Log a shift'} T={T}
      footer={<>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 4px 10px' }}>
          <span style={{ fontSize: 14, color: T.txt2 }}>{fixDe(d.paidHours, 2)} h paid</span>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: WORK, fontVariantNumeric: 'tabular-nums' }}>{money(d.pay, hostCur)} <span style={{ fontSize: 11, fontWeight: 600, color: T.txt3 }}>gross</span></span>
        </div>
        <Btn full disabled={!d.valid} onClick={save} style={d.valid ? workBtn : undefined}>{d.valid ? (editing ? 'Save changes' : 'Log shift') : 'Enter start and end time'}</Btn>
        {editing && <Btn full kind="danger" size="md" icon={Trash2} onClick={del} style={{ marginTop: 4 }}>Delete shift</Btn>}
      </>}>
      <Field T={T} label="Date" htmlFor="sh-date"><input id="sh-date" className="fld" value={date} onChange={(e) => setDate(e.target.value)} type="date" /></Field>
      <Field T={T} label="Employer">
        {!newEmp && employers.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {employers.map((n) => <Chip key={n} T={T} on={emp === n} onClick={() => { setEmp(n); setWage(wageFor(n)) }}>{n}</Chip>)}
            <Chip T={T} dashed icon={Plus} onClick={() => { setNewEmp(true); setEmp(''); setWage('') }}>New</Chip>
          </div>
        ) : (
          <input className="fld" aria-label="Employer" value={emp} onChange={(e) => setEmp(e.target.value)} placeholder="e.g. Café job" />
        )}
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field T={T} label="Start" htmlFor="sh-start" style={{ flex: 1 }}><input id="sh-start" className="fld" value={start} onChange={(e) => setStart(e.target.value)} type="time" /></Field>
        <Field T={T} label="End" htmlFor="sh-end" style={{ flex: 1 }}><input id="sh-end" className="fld" value={end} onChange={(e) => setEnd(e.target.value)} type="time" /></Field>
      </div>
      {d.overnight && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: T.amber, marginTop: -8, marginBottom: 14, fontWeight: 600 }}><Moon size={14} /> Overnight — ends the next day</div>}
      <Field T={T} label="Break">
        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          {['0', '15', '30', '45', '60'].map((b) => <Chip key={b} T={T} on={brk === b} onClick={() => setBrk(b)} style={{ flex: 1, justifyContent: 'center', padding: '8px 0' }}>{b === '0' ? 'None' : `${b}m`}</Chip>)}
        </div>
        <div className="h-well" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginTop: 10 }}>
          <span style={{ flex: 1, fontSize: 14.5 }}>Other length</span>
          <input className="fld" aria-label="Break minutes" value={brk} onChange={(e) => setBrk(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={{ width: 80, minHeight: 38, padding: '7px 10px', textAlign: 'right' }} />
          <span style={{ fontSize: 14, color: T.txt3 }}>min</span>
        </div>
        <div className="h-well" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', marginTop: 8 }}>
          <span style={{ fontSize: 14.5 }}>Break is paid</span>
          <Toggle label="Break is paid" on={paidBreak} onChange={setPaidBreak} />
        </div>
      </Field>
      <Field T={T} label={`Wage per hour (${hostCur})`} htmlFor="sh-wage" style={{ marginBottom: 4 }}><input id="sh-wage" className="fld" value={wage} onChange={(e) => setWage(e.target.value)} inputMode="decimal" placeholder="e.g. 13,50" style={{ fontSize: 18, fontWeight: 700 }} /></Field>
    </Sheet>
  )
}
