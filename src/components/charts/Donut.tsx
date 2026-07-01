import type { ReactNode } from 'react'
import type { Theme } from '../../lib/types'

export interface Seg { value: number; color: string }

export default function Donut({ segments, size = 120, stroke = 14, center, T }: {
  segments: Seg[]; size?: number; stroke?: number; center?: ReactNode; T: Theme
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const totalV = segments.reduce((s, x) => s + x.value, 0) || 1
  let acc = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.inp} strokeWidth={stroke} />
        {segments.map((seg, i) => {
          const len = (seg.value / totalV) * c
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} strokeLinecap="butt"
              style={{ transition: 'stroke-dasharray .8s cubic-bezier(.22,1,.36,1)' }} />
          )
          acc += len
          return el
        })}
      </svg>
      {center != null && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>{center}</div>}
    </div>
  )
}
