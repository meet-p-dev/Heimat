import { useState } from 'react'
import { Wallet, Pencil, ArrowUpDown, Globe, MapPin, ArrowRightLeft } from 'lucide-react'
import type { Theme, Runway, ModalId } from '../../lib/types'
import type { RunwayCalc } from '../../lib/derive'
import { Ring, Card, Btn, Group, Item, EmptyState, SectionLabel, IconBtn, TINT } from '../ui'
import { fixDe, money, numVal, relDay } from '../../lib/format'
import { haptic } from '../../lib/haptic'

export default function MoneyTab({ T, runway, runwayCalc, fH, fHome, hostCur, homeCur, rate, rateAt, setModal, inFlat, openSettings }: {
  T: Theme; runway: Runway | null; runwayCalc: RunwayCalc | null
  fH: (v: number) => string; fHome: (v: number) => string | null
  hostCur: string; homeCur: string; rate: number; rateAt?: string
  setModal: (m: ModalId) => void; inFlat: boolean; openSettings: () => void
}) {
  const [amt, setAmt] = useState('')
  const [flip, setFlip] = useState(false)
  const target = (runway && runway.targetMonths) || 12
  const lastsUntil = runwayCalc ? new Date(Date.now() + runwayCalc.monthsLeft * 30.44 * 86400000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''
  const onTrack = runwayCalc ? runwayCalc.elapsed + runwayCalc.monthsLeft >= target : true
  const short = runwayCalc ? Math.max(target - (runwayCalc.elapsed + runwayCalc.monthsLeft), 0) : 0
  const diff = homeCur !== hostCur
  const v = numVal(amt)
  const [from, to] = flip ? [homeCur, hostCur] : [hostCur, homeCur]
  const converted = rate > 0 ? (flip ? v / rate : v * rate) : 0

  return (
    <>
      {runwayCalc ? (
        <Card T={T} grad style={{ borderRadius: 28, padding: '22px 18px 18px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Ring pct={runwayCalc.monthsLeft / target} size={136} stroke={12} color={runwayCalc.monthsLeft < 2 ? T.red : T.acc} track={T.border}>
              <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>{fixDe(runwayCalc.monthsLeft)}</span>
              <span style={{ fontSize: 12, color: T.txt2, marginTop: 2 }}>months left</span>
            </Ring>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8, marginTop: 16, fontVariantNumeric: 'tabular-nums' }}>{fH(runwayCalc.left)}</div>
          {fHome(runwayCalc.left) && <div style={{ fontSize: 14, color: T.txt2, marginTop: 2 }}>≈ {fHome(runwayCalc.left)}</div>}
          <div style={{ marginTop: 12 }}>
            <span className="h-pill" style={{ background: onTrack ? T.accSoft : 'color-mix(in srgb, var(--amber) 16%, transparent)', color: onTrack ? T.acc : T.amber, fontSize: 12.5, padding: '5px 12px' }}>
              {onTrack ? `On track for your ${target}-month goal` : `${fixDe(short)} months short of your ${target}-month goal`}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 18, textAlign: 'left' }}>
            {[['Monthly spend', fH(runwayCalc.burn)], ['Used so far', fH(runwayCalc.spentSince)], ['Lasts until', lastsUntil]].map(([k, val]) => (
              <div key={k} className="h-well" style={{ padding: '10px 11px', borderRadius: 16 }}>
                <div style={{ fontSize: 11.5, color: T.txt3, fontWeight: 600 }}>{k}</div>
                <div style={{ fontSize: 14, fontWeight: 750, marginTop: 3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{val}</div>
              </div>
            ))}
          </div>
          {!inFlat && <div style={{ fontSize: 12.5, color: T.txt3, marginTop: 12, lineHeight: 1.5 }}>Spending comes from your share of flat expenses — join a flat to track it.</div>}
          <div style={{ marginTop: 16 }}><Btn size="sm" kind="secondary" icon={Pencil} onClick={() => setModal('runway')}>Edit runway</Btn></div>
        </Card>
      ) : (
        <Card T={T} grad style={{ borderRadius: 28, padding: '18px 18px 20px' }}>
          <EmptyState T={T} icon={Wallet} title="How long will your money last?" body="Enter your blocked account (Sperrkonto) or yearly budget and watch your runway as you spend.">
            <Btn full onClick={() => setModal('runway')}>Set up runway</Btn>
          </EmptyState>
        </Card>
      )}

      {diff && (
        <>
          <SectionLabel T={T}>Quick convert</SectionLabel>
          <Card T={T} style={{ borderRadius: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input className="fld fld-big" aria-label={`Amount in ${from}`} value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="0" style={{ paddingRight: 64 }} />
                <span style={{ position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: T.txt3 }}>{from}</span>
              </div>
              <IconBtn label="Swap currencies" onClick={() => { haptic(8); setFlip(!flip) }}><ArrowUpDown size={19} /></IconBtn>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12, padding: '0 4px' }}>
              <span style={{ fontSize: 13, color: T.txt3 }}>≈ in {to}</span>
              <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>{money(converted, to)}</span>
            </div>
          </Card>
        </>
      )}

      <div style={{ height: 22 }} />
      <Group T={T} title="Your currencies" footer="Your runway stays on this device only. Amounts in your home currency use a reference rate.">
        <Item T={T} icon={Globe} tint={TINT.teal} label="Home currency" value={homeCur} onClick={openSettings} chevron={false} />
        <Item T={T} icon={MapPin} tint={TINT.indigo} label="Local currency" value={hostCur} onClick={openSettings} chevron={false} />
        {diff && <Item T={T} icon={ArrowRightLeft} tint={TINT.gray} label={`1 ${hostCur}`} sub={rateAt ? `Updated ${relDay(rateAt).toLowerCase()}` : 'Set by hand'} value={`${fixDe(rate, 2)} ${homeCur}`} onClick={openSettings} />}
      </Group>
    </>
  )
}
