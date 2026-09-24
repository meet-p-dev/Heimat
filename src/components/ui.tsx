import React, { useState, useEffect, useRef } from 'react'
import { X, Globe, ChevronRight, ChevronLeft, Eye, EyeOff, Minus, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Theme } from '../lib/types'
import { haptic } from '../lib/haptic'

type CSS = React.CSSProperties

/* solid tints for icon tiles, iOS-settings style */
export const TINT = {
  green: '#16a974', blue: '#3b82f6', indigo: '#6366f1', purple: '#a855f7', pink: '#ec4899',
  red: '#ef4444', orange: '#f59e0b', teal: '#14b8a6', gray: '#7c8a85', yellow: '#eab308',
}

export function Field({ label, T, children, hint, error, htmlFor, style }: {
  label?: React.ReactNode; T: Theme; children: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; htmlFor?: string; style?: CSS
}) {
  const lblStyle: CSS = { display: 'block', fontSize: 13, fontWeight: 600, color: T.txt2, margin: '0 4px 7px' }
  return (
    <div style={{ marginBottom: 16, ...style }}>
      {label != null && (htmlFor ? <label htmlFor={htmlFor} style={lblStyle}>{label}</label> : <div style={lblStyle}>{label}</div>)}
      {children}
      {error
        ? <div role="alert" style={{ fontSize: 12.5, color: T.red, margin: '7px 4px 0', lineHeight: 1.45 }}>{error}</div>
        : hint ? <div style={{ fontSize: 12.5, color: T.txt3, margin: '7px 4px 0', lineHeight: 1.45 }}>{hint}</div> : null}
    </div>
  )
}

export function Row({ T, k, v, last }: { T: Theme; k: React.ReactNode; v: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: last ? 'none' : `1px solid ${T.border}` }}>
      <span style={{ color: T.txt2, fontSize: 14 }}>{k}</span>
      <span style={{ fontWeight: 600, fontSize: 14, textAlign: 'right' }}>{v}</span>
    </div>
  )
}

export function Ring({ pct, size = 74, stroke = 8, color, track, children }: { pct: number; size?: number; stroke?: number; color: string; track: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.min(Math.max(pct || 0, 0), 1))
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.22,1,.36,1)', filter: `drop-shadow(0 0 6px ${color}66)` }} />
      </svg>
      {children != null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.05 }}>{children}</div>
      )}
    </div>
  )
}

export function Flag({ iso, size = 18, style }: { iso?: string; size?: number; style?: CSS }) {
  if (!iso) return <Globe size={size} style={{ verticalAlign: 'middle', ...style }} />
  return <span className={`fi fi-${iso}`} style={{ fontSize: size, width: size * 1.34, borderRadius: 3, display: 'inline-block', verticalAlign: 'middle', ...style }} />
}

/* ---- glass surfaces ---- */

export function Card({ T, children, style, onClick, grad, strong, ariaLabel }: {
  T: Theme; children: React.ReactNode; style?: CSS; onClick?: () => void; grad?: boolean; strong?: boolean; ariaLabel?: string
}) {
  const tint: CSS | null = grad ? { background: `linear-gradient(165deg,var(--g-sheen),transparent 45%),linear-gradient(140deg,${T.accSoft},transparent 70%),var(--g-bg)` } : null
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      className={`glass${strong ? ' glass-strong' : ''}${onClick ? ' h-press' : ''}`}
      style={{ borderRadius: 24, padding: 16, color: T.txt, ...(onClick ? { cursor: 'pointer' } : null), ...tint, ...style }}
    >
      {children}
    </div>
  )
}

export function SectionLabel({ T, children, right }: { T: Theme; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 6px 10px' }}>
      <span style={{ fontSize: 13, fontWeight: 650, color: T.txt3 }}>{children}</span>
      {right}
    </div>
  )
}

export function SegmentedControl<V extends string>({ options, value, onChange, T, label }: { options: [V, string][]; value: V; onChange: (v: V) => void; T: Theme; label?: string }) {
  const idx = Math.max(0, options.findIndex(([k]) => k === value))
  return (
    <div className="h-seg" role="group" aria-label={label} style={{ color: T.txt }}>
      <div className="h-seg-thumb" style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={k === value} onClick={() => { if (k !== value) { haptic(6); onChange(k) } }}>{l}</button>
      ))}
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
    <Card T={T} grad={grad} style={{ borderRadius: 26, padding: '18px 18px 16px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.txt2 }}>{label}</div>
      <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1.4, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {(delta || sub) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5, fontSize: 13, color: T.txt2 }}>
          {delta && <span className="h-pill" style={{ background: T.accSoft, color: dc }}>{delta}</span>}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </Card>
  )
}

/* ---- controls ---- */

export function Btn({ kind = 'primary', size = 'lg', full, busy, disabled, onClick, icon: Icon, children, style, type = 'button', ariaLabel }: {
  kind?: 'primary' | 'secondary' | 'tinted' | 'ghost' | 'danger'; size?: 'lg' | 'md' | 'sm'; full?: boolean; busy?: boolean; disabled?: boolean
  onClick?: () => void; icon?: LucideIcon; children?: React.ReactNode; style?: CSS; type?: 'button' | 'submit'; ariaLabel?: string
}) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onClick}
      className={`btn btn-${size} btn-${kind}${kind === 'secondary' ? ' glass' : ''}${full ? ' btn-full' : ''}`}
      style={style}
    >
      {busy ? <span className="h-spin" /> : <>{Icon && <Icon size={size === 'sm' ? 15 : 18} strokeWidth={2.3} />}{children}</>}
    </button>
  )
}

export function IconBtn({ label, onClick, children, size = 42, disabled, style, plain }: {
  label: string; onClick?: () => void; children: React.ReactNode; size?: number; disabled?: boolean; style?: CSS; plain?: boolean
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={`h-icbtn${plain ? '' : ' glass'}`} style={{ width: size, height: size, background: plain ? 'none' : undefined, ...style }}>
      {children}
    </button>
  )
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="h-toggle" onClick={() => { haptic(8); onChange(!on) }} />
}

export function Stepper({ value, onChange, min, max, step = 1, format, label }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string; label: string
}) {
  const set = (v: number) => { haptic(6); onChange(Math.min(max, Math.max(min, v))) }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <IconBtn label={`Decrease ${label}`} size={32} disabled={value <= min} onClick={() => set(value - step)}><Minus size={15} strokeWidth={2.6} /></IconBtn>
      <span aria-live="polite" style={{ minWidth: 46, textAlign: 'center', fontWeight: 750, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{format ? format(value) : value}</span>
      <IconBtn label={`Increase ${label}`} size={32} disabled={value >= max} onClick={() => set(value + step)}><Plus size={15} strokeWidth={2.6} /></IconBtn>
    </div>
  )
}

export function Chip({ T, on, tint, onClick, icon: Icon, children, dashed, style, ariaLabel }: {
  T: Theme; on?: boolean; tint?: string; onClick?: () => void; icon?: LucideIcon; children?: React.ReactNode; dashed?: boolean; style?: CSS; ariaLabel?: string
}) {
  const onStyle: CSS | undefined = on
    ? { background: tint || T.acc, color: tint ? '#fff' : T.onAcc, borderColor: 'transparent', boxShadow: `0 6px 16px -8px ${tint || T.acc}` }
    : dashed ? { background: 'none', borderStyle: 'dashed', color: T.acc } : undefined
  return (
    <button type="button" className="chip" aria-pressed={on} aria-label={ariaLabel} onClick={() => { haptic(5); onClick?.() }} style={{ ...onStyle, ...style }}>
      {Icon && <Icon size={14} strokeWidth={2.2} />}{children}
    </button>
  )
}

export function CheckCircle({ on }: { on: boolean }) {
  return (
    <span className="h-check" data-on={on} aria-hidden="true">
      {on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
    </span>
  )
}

export function PasswordInput({ id, value, onChange, autoComplete, placeholder }: {
  id?: string; value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input id={id} className="fld" value={value} onChange={(e) => onChange(e.target.value)} type={show ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder} autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ paddingRight: 52 }} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', width: 42, height: 42, border: 'none', background: 'none', color: 'var(--txt3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 99 }}>
        {show ? <EyeOff size={19} /> : <Eye size={19} />}
      </button>
    </div>
  )
}

/* ---- people ---- */

export const AVATAR_COLORS = ['#16a974', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#14b8a6', '#64748b']
export const avatarColor = (seed: string) => {
  let h = 0
  for (const ch of seed || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
export const initials = (name?: string) => {
  const p = (name || '?').trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] || '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}

export function Avatar({ name, color, seed, size = 40 }: { name?: string; color?: string; seed?: string; size?: number }) {
  const c = color || avatarColor(seed || name || '?')
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 99, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 750, fontSize: size * 0.38, letterSpacing: -0.3, background: `radial-gradient(120% 90% at 30% 12%,rgba(255,255,255,.4),rgba(255,255,255,0) 55%),${c}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35),0 4px 12px -4px rgba(0,0,0,.35)' }}>
      {initials(name)}
    </span>
  )
}

/* ---- layout ---- */

export function Sheet({ open, onClose, title, T, children, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; T: Theme; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="h-layer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="h-scrim" onClick={onClose} />
      <div className="h-sheet glass glass-strong">
        <div style={{ width: 38, height: 5, background: T.border, borderRadius: 99, margin: '9px auto 0', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px 8px 22px', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0, fontWeight: 750, fontSize: 20, letterSpacing: -0.4 }}>{title}</div>
          <IconBtn label="Close" onClick={onClose} size={36}><X size={18} /></IconBtn>
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 20px 18px' }}>{children}</div>
        {footer && <div style={{ padding: '10px 20px 16px', flexShrink: 0, borderTop: `1px solid ${T.border}` }}>{footer}</div>}
      </div>
    </div>
  )
}

export function Page({ T, title, onBack, right, top, children, z = 200, close }: {
  T: Theme; title: React.ReactNode; onBack: () => void; right?: React.ReactNode; top?: React.ReactNode; children: React.ReactNode; z?: number; close?: boolean
}) {
  return (
    <div className="h-page h-aurora" style={{ zIndex: z, color: T.txt }}>
      <div className="h-pagehdr">
        <IconBtn label={close ? 'Close' : 'Back'} onClick={onBack}>{close ? <X size={20} /> : <ChevronLeft size={23} />}</IconBtn>
        <div className="h-pagehdr-t">{title}</div>
        <div style={{ minWidth: 42, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
      </div>
      {top}
      <div className="h-pagebody"><div className="h-pagebody-in">{children}</div></div>
    </div>
  )
}

export function Group({ T, title, footer, children, style }: { T: Theme; title?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; style?: CSS }) {
  return (
    <section style={{ marginBottom: 24, ...style }}>
      {title && <h2 style={{ fontSize: 13, fontWeight: 650, color: T.txt3, margin: '0 16px 8px' }}>{title}</h2>}
      <div className="glass" style={{ borderRadius: 24, overflow: 'hidden' }}>{children}</div>
      {footer && <div style={{ fontSize: 12.5, color: T.txt3, margin: '8px 16px 0', lineHeight: 1.5 }}>{footer}</div>}
    </section>
  )
}

export function Item({ T, icon: Icon, tint, label, sub, value, right, chevron, onClick, danger, disabled, lead }: {
  T: Theme; icon?: LucideIcon; tint?: string; label: React.ReactNode; sub?: React.ReactNode; value?: React.ReactNode; right?: React.ReactNode
  chevron?: boolean; onClick?: () => void; danger?: boolean; disabled?: boolean; lead?: React.ReactNode
}) {
  const inner = (
    <>
      {lead}
      {Icon && <span className="h-item-ic" style={{ background: tint || T.acc }}><Icon size={17} strokeWidth={2.2} /></span>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 16, fontWeight: 500, color: danger ? T.red : T.txt }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 12.5, color: T.txt3, marginTop: 2, lineHeight: 1.4 }}>{sub}</span>}
      </span>
      {value != null && <span style={{ fontSize: 15, color: T.txt2, textAlign: 'right', flexShrink: 1, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>}
      {right}
      {(chevron ?? !!onClick) && <ChevronRight size={18} color={T.txt3} style={{ flexShrink: 0 }} />}
    </>
  )
  const st = { '--inset': Icon || lead ? '61px' : '16px', opacity: disabled ? 0.5 : 1 } as CSS
  return onClick
    ? <button type="button" className="h-item" style={st} onClick={onClick} disabled={disabled}>{inner}</button>
    : <div className="h-item" style={st}>{inner}</div>
}

export function EmptyState({ T, icon: Icon, title, body, children }: { T: Theme; icon?: LucideIcon; title: React.ReactNode; body?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '22px 12px 8px' }}>
      {Icon && <div className="glass" style={{ width: 64, height: 64, borderRadius: 22, margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.acc }}><Icon size={28} strokeWidth={1.8} /></div>}
      <div style={{ fontWeight: 750, fontSize: 19, letterSpacing: -0.3 }}>{title}</div>
      {body && <div style={{ fontSize: 14, color: T.txt2, marginTop: 6, lineHeight: 1.55, maxWidth: 340, marginLeft: 'auto', marginRight: 'auto' }}>{body}</div>}
      {children && <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>}
    </div>
  )
}

/* an error line that reads as one */
export function Alert({ T, children, tone = 'red' }: { T: Theme; children: React.ReactNode; tone?: 'red' | 'amber' | 'green' }) {
  const c = tone === 'red' ? T.red : tone === 'amber' ? T.amber : T.green
  return (
    <div role={tone === 'green' ? 'status' : 'alert'} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: `color-mix(in srgb, ${c} 13%, transparent)`, color: c, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)`, borderRadius: 16, padding: '11px 14px', fontSize: 13.5, fontWeight: 550, lineHeight: 1.5, marginBottom: 14 }}>
      {children}
    </div>
  )
}
