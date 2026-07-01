import React from 'react'
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
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: T.card, borderRadius: '22px 22px 0 0', paddingBottom: 'calc(env(safe-area-inset-bottom) + 14px)', maxHeight: 'calc(100vh - env(safe-area-inset-top) - 32px)', display: 'flex', flexDirection: 'column', animation: 'hSheet .3s cubic-bezier(.22,1,.36,1)' }}>
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
