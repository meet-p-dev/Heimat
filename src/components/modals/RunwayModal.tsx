import { useState, useEffect } from 'react'
import type { Theme, Runway } from '../../lib/types'
import { tod, numVal } from '../../lib/format'
import { Sheet, Field, inpStyle } from '../ui'

export default function RunwayModal({ open, onClose, T, runway, sRunway, hostCur, showToast }: {
  open: boolean; onClose: () => void; T: Theme; runway: Runway | null
  sRunway: (r: Runway) => void; hostCur: string; showToast: (m: string) => void
}) {
  const [total, setTotal] = useState('')
  const [start, setStart] = useState(tod())
  const [monthly, setMonthly] = useState('')
  const [target, setTarget] = useState('12')
  useEffect(() => {
    if (open && runway) { setTotal(String(runway.total || '')); setStart(runway.start || tod()); setMonthly(String(runway.monthly || '')); setTarget(String(runway.targetMonths || 12)) }
    else if (open) { setTotal(''); setStart(tod()); setMonthly(''); setTarget('12') }
  }, [open])
  return (
    <Sheet open={open} onClose={onClose} title="Funds runway" T={T}>
      <Field label={`Total funds available (${hostCur})`} T={T}><input value={total} onChange={(e) => setTotal(e.target.value)} type="text" inputMode="decimal" placeholder="e.g. 11904" style={{ ...inpStyle(T), fontSize: 20, fontWeight: 700 }} /></Field>
      <Field label="Counting from" T={T}><input value={start} onChange={(e) => setStart(e.target.value)} type="date" style={inpStyle(T)} /></Field>
      <Field label="Must last (months)" T={T}><input value={target} onChange={(e) => setTarget(e.target.value)} type="number" inputMode="numeric" style={inpStyle(T)} /></Field>
      <Field label={`Planned monthly minimum (${hostCur}, optional)`} T={T}><input value={monthly} onChange={(e) => setMonthly(e.target.value)} type="text" inputMode="decimal" placeholder="e.g. 992" style={inpStyle(T)} /></Field>
      <button onClick={() => { const t = numVal(total); if (!t) return; sRunway({ total: t, start, monthly: numVal(monthly), targetMonths: parseInt(target) || 12 }); showToast('Runway saved'); onClose() }} className="h-press" style={{ width: '100%', background: T.acc, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginBottom: 8 }}>Save runway</button>
      <div style={{ fontSize: 12, color: T.txt3, textAlign: 'center', lineHeight: 1.5 }}>For a German blocked account this is usually ~€11,904 that must last 12 months (~€992/mo).</div>
    </Sheet>
  )
}
