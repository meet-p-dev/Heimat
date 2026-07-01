import type { Theme } from '../../lib/types'

export interface BarItem { label: string; value: number; color: string; sub?: string }

export default function Bars({ items, format, T }: { items: BarItem[]; format: (n: number) => string; T: Theme }) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div>
      {items.map((it, idx) => (
        <div key={idx} style={{ margin: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 600 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: it.color }} />{it.label}</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{format(it.value)}</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: T.inp, overflow: 'hidden' }}>
            <div className="h-grow" style={{ height: '100%', borderRadius: 99, width: `${Math.max((it.value / max) * 100, 2)}%`, background: it.color, transformOrigin: 'left' }} />
          </div>
          {it.sub && <div style={{ fontSize: 10, color: T.txt3, marginTop: 3 }}>{it.sub}</div>}
        </div>
      ))}
    </div>
  )
}
