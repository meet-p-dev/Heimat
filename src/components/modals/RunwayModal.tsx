import { useState, useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import type { Theme, Runway } from '../../lib/types'
import { tod, numVal } from '../../lib/format'
import { Sheet, Field, Btn, Stepper } from '../ui'

export default function RunwayModal({ open, onClose, T, runway, sRunway, hostCur, showToast }: {
  open: boolean; onClose: () => void; T: Theme; runway: Runway | null
  sRunway: (r: Runway) => void; hostCur: string; showToast: (m: string) => void
}) {
  const [total, setTotal] = useState('')
  const [start, setStart] = useState(tod())
  const [monthly, setMonthly] = useState('')
  const [target, setTarget] = useState(12)
  useEffect(() => {
    if (open && runway) { setTotal(String(runway.total || '').replace('.', ',')); setStart(runway.start || tod()); setMonthly(runway.monthly ? String(runway.monthly).replace('.', ',') : ''); setTarget(runway.targetMonths || 12) }
    else if (open) { setTotal(''); setStart(tod()); setMonthly(''); setTarget(12) }
  }, [open])
  const t = numVal(total)
  const save = () => { if (!t) return; sRunway({ total: t, start, monthly: numVal(monthly), targetMonths: target }); showToast('Runway saved'); onClose() }
  return (
    <Sheet open={open} onClose={onClose} title="Funds runway" T={T} footer={<Btn full disabled={!t} onClick={save}>Save runway</Btn>}>
      {hostCur === 'EUR' && (
        <button type="button" className="h-well" onClick={() => { setTotal('11904'); setMonthly('992'); setTarget(12) }} style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', marginBottom: 16, cursor: 'pointer', color: T.txt, textAlign: 'left' }}>
          <Sparkles size={18} color={T.acc} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, lineHeight: 1.45 }}><b>German blocked account?</b> Tap to fill in the standard €11,904 over 12 months (€992 a month).</span>
        </button>
      )}
      <Field T={T} label={`Total funds available (${hostCur})`} htmlFor="rw-total"><input id="rw-total" className="fld fld-big" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="11.904" /></Field>
      <Field T={T} label="Counting from" htmlFor="rw-start"><input id="rw-start" className="fld" value={start} onChange={(e) => setStart(e.target.value)} type="date" /></Field>
      <div className="h-well" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', marginBottom: 16 }}>
        <span style={{ fontWeight: 600 }}>Must last</span>
        <Stepper label="months" value={target} onChange={setTarget} min={1} max={60} format={(n) => `${n} mo`} />
      </div>
      <Field T={T} label={`Planned monthly minimum (${hostCur}, optional)`} htmlFor="rw-mo" hint="Used when you've spent less than this so far, so the runway isn't too optimistic early on." style={{ marginBottom: 4 }}>
        <input id="rw-mo" className="fld" value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" placeholder="e.g. 992" />
      </Field>
    </Sheet>
  )
}
