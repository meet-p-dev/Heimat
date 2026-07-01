import { Wallet } from 'lucide-react'
import type { Theme, Runway, Profile, ModalId } from '../../lib/types'
import type { RunwayCalc } from '../../lib/derive'
import { Ring, Row } from '../ui'

export default function MoneyTab({ T, runway, runwayCalc, fH, fHome, hostCur, homeCur, rate, profile, setModal, inFlat }: {
  T: Theme; runway: Runway | null; runwayCalc: RunwayCalc | null
  fH: (v: number) => string; fHome: (v: number) => string | null
  hostCur: string; homeCur: string; rate: number; profile: Profile
  setModal: (m: ModalId) => void; inFlat: boolean
}) {
  return (
    <>
      <span className="h-lbl" style={{ color: T.txt3 }}>Funds runway</span>
      {runwayCalc ? (
        <div style={{ background: T.card, borderRadius: 20, padding: '18px 16px', marginBottom: 14, textAlign: 'center' }}>
          <Ring pct={runwayCalc.monthsLeft / ((runway && runway.targetMonths) || 12)} size={120} stroke={11} color={runwayCalc.monthsLeft < 2 ? T.red : T.acc} track={T.border}><span style={{ fontSize: 30, fontWeight: 800 }}>{runwayCalc.monthsLeft.toFixed(1)}</span><span style={{ fontSize: 11, color: T.txt2 }}>months left</span></Ring>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 14 }}>{fH(runwayCalc.left)}</div>
          {fHome(runwayCalc.left) && <div style={{ fontSize: 13, color: T.txt2 }}>≈ {fHome(runwayCalc.left)}</div>}
          <div style={{ fontSize: 12, color: T.txt3, marginTop: 8 }}>Spending ≈ {fH(runwayCalc.burn)}/mo · {fH(runwayCalc.spentSince)} used{inFlat ? '' : ' (add a flat to track spend)'}</div>
          <button onClick={() => setModal('runway')} className="h-press" style={{ marginTop: 14, background: T.cardH, color: T.txt, border: 'none', borderRadius: 12, padding: '10px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Edit runway</button>
        </div>
      ) : (
        <div style={{ background: T.card, borderRadius: 20, padding: '20px 16px', marginBottom: 14, textAlign: 'center' }}>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}><Wallet size={32} color={T.acc} strokeWidth={1.6} /></div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>How long will your money last?</div>
          <div style={{ fontSize: 13, color: T.txt2, marginBottom: 14, lineHeight: 1.5 }}>Enter your blocked account (Sperrkonto) or yearly budget and watch your live runway as you spend.</div>
          <button onClick={() => setModal('runway')} className="h-press" style={{ background: T.acc, color: '#fff', border: 'none', borderRadius: 14, padding: '12px 22px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Set up runway</button>
        </div>
      )}
      <span className="h-lbl" style={{ color: T.txt3 }}>Your currencies</span>
      <div style={{ background: T.card, borderRadius: 20, padding: '4px 16px', marginBottom: 14 }}>
        <Row T={T} k="Home currency" v={homeCur} /><Row T={T} k="Local currency" v={hostCur} />
        <Row T={T} k={`1 ${hostCur} =`} v={homeCur === hostCur ? '—' : `${rate} ${homeCur}`} last />
      </div>
      <div style={{ fontSize: 12, color: T.txt3, textAlign: 'center', lineHeight: 1.5 }}>Your runway stays on this device only. Change currency & rate in the Me tab.</div>
    </>
  )
}
