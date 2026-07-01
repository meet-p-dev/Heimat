import React, { useState, useEffect, useRef } from 'react'
import { X, Globe } from 'lucide-react'
import type { Theme } from '../lib/types'

export const inpStyle = (T: Theme): React.CSSProperties => ({
  width: '100%', background: T.inp, color: T.txt, border: `1px solid ${T.border}`,
  borderRadius: 12, padding: '12px 14px', fontSize: 16,
})

export function Field({ label, T, children }: { label: React.ReactNode; T: Theme; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: T.txt2, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

export function Row({ T, k, v, last }: { T: Theme; k: React.ReactNode; v: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: last ? 'none' : `1px solid ${T.border}` }}>
      <span style={{ color: T.txt2, fontSize: 14 }}>{k}</span>
      <span style={{ fontWeight: 600, fontSize: 14 }}>{v}</span>
    </div>
  )
}

export function Ring({ pct, size = 74, stroke = 8, color, track, children }: { pct: number; size?: number; stroke?: number; color: string; track: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.min(Math.max(pct || 0, 0), 1))
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)' }} />
      </svg>
      {children != null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
      )}
    </div>
  )
}

export function Sheet({ open, onClose, title, T, children }: { open: boolean; onClose: () => void; title: React.ReactNode; T: Theme; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', animation: 'hFade .2s ease' }} onClick={onClose} />
      <div className="h-sheet" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: T.card, borderRadius: '22px 22px 0 0', paddingBottom: 'calc(env(safe-area-inset-bottom) + 14px)', maxHeight: 'calc(100vh - env(safe-area-inset-top) - 32px)', display: 'flex', flexDirection: 'column', animation: 'hSheet .3s cubic-bezier(.22,1,.36,1)' }}>
        <div style={{ width: 36, height: 4, background: T.border, borderRadius: 99, margin: '12px auto 2px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontWeight: 700, fontSize: 18, color: T.txt }}>{title}</span>
          <button onClick={onClose} style={{ background: T.cardH, border: 'none', borderRadius: 99, width: 32, height: 32, color: T.txt2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 20px 4px' }}>{children}</div>
      </div>
    </div>
  )
}

export function Flag({ iso, size = 18, style }: { iso?: string; size?: number; style?: React.CSSProperties }) {
  if (!iso) return <Globe size={size} style={{ verticalAlign: 'middle', ...style }} />
  return <span className={`fi fi-${iso}`} style={{ fontSize: size, width: size * 1.34, borderRadius: 3, display: 'inline-block', verticalAlign: 'middle', ...style }} />
}

/* ---- V0.6 design-system primitives ---- */

export function Card({ T, children, style, onClick, grad }: { T: Theme; children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void; grad?: boolean }) {
  return (
    <div onClick={onClick} className={onClick ? 'h-press' : undefined} style={{ background: grad ? `linear-gradient(135deg, ${T.card}, ${T.cardH})` : T.card, border: `1px solid ${T.border}`, borderRadius: 20, padding: 16, ...(onClick ? { cursor: 'pointer' } : null), ...style }}>{children}</div>
  )
}

export function SectionLabel({ T, children, right }: { T: Theme; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 2px 8px' }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: T.txt3 }}>{children}</span>
      {right}
    </div>
  )
}

export function SegmentedControl<V extends string>({ options, value, onChange, T }: { options: [V, string][]; value: V; onChange: (v: V) => void; T: Theme }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: T.inp, borderRadius: 999, padding: 3 }}>
      {options.map(([k, l]) => {
        const on = k === value
        return <button key={k} onClick={() => onChange(k)} className="h-press" style={{ flex: 1, border: 'none', background: on ? T.acc : 'transparent', color: on ? '#fff' : T.txt2, borderRadius: 999, padding: '7px 0', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', transition: 'background .2s,color .2s' }}>{l}</button>
      })}
    </div>
  )
}

export function AnimatedNumber({ value, format, duration = 650 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [disp, setDisp] = useState(value)
  const prev = useRef(value)
  useEffect(() => {
    const from = prev.current, to = value
    prev.current = value
    if (from === to) { setDisp(to); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min((t - t0) / duration, 1)
      const e = 1 - Math.pow(1 - p, 3)
      setDisp(from + (to - from) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <>{format(disp)}</>
}

export function StatHero({ T, label, value, sub, delta, deltaTone, grad }: { T: Theme; label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; delta?: string; deltaTone?: 'up' | 'down' | 'flat'; grad?: boolean }) {
  const dc = deltaTone === 'down' ? T.red : deltaTone === 'up' ? T.green : T.txt2
  return (
    <div style={{ borderRadius: 22, padding: '18px 18px 16px', background: grad ? `linear-gradient(135deg, ${T.accSoft}, ${T.card})` : T.card, border: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: T.txt2 }}>{label}</div>
      <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1.4, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {(delta || sub) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5, fontSize: 12.5, color: T.txt2 }}>
          {delta && <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 999, background: T.accSoft, color: dc }}>{delta}</span>}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  )
}
