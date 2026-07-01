import { useMemo, useState, useId } from 'react'
import type { Theme } from '../../lib/types'
import { WORK, GOLD } from '../../lib/theme'

export default function LineArea({ data, labels, height = 132, format = (n) => String(n), T }: {
  data: number[]; labels: string[]; height?: number; format?: (n: number) => string; T: Theme
}) {
  const W = 320, pad = 12, base = height - 12
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const pts = useMemo(() => {
    if (!data.length) return [] as [number, number][]
    const mn = Math.min(...data), mx = Math.max(...data)
    const span = mx - mn || 1
    const dx = data.length > 1 ? (W - pad * 2) / (data.length - 1) : 0
    return data.map((v, i) => [pad + dx * i, base - ((v - mn) / span) * (base - 16)] as [number, number])
  }, [data, height])
  if (!pts.length) return null
  const lineD = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L')
  const areaD = `${lineD} L${pts[pts.length - 1][0].toFixed(1)},${base} L${pts[0][0].toFixed(1)},${base} Z`
  const hi = hover == null ? pts.length - 1 : hover
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`a${gid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={WORK} stopOpacity="0.34" /><stop offset="1" stopColor={WORK} stopOpacity="0" /></linearGradient>
          <linearGradient id={`s${gid}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={WORK} /><stop offset="1" stopColor={GOLD} /></linearGradient>
        </defs>
        <path d={areaD} fill={`url(#a${gid})`} />
        <path key={lineD} d={lineD} fill="none" stroke={`url(#s${gid})`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-draw" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === hi ? 4.5 : 3} fill={i === hi ? GOLD : T.bg} stroke={WORK} strokeWidth="2"
            style={{ cursor: 'pointer' }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hi != null && (
        <div style={{ position: 'absolute', left: `${(pts[hi][0] / W) * 100}%`, top: `${(pts[hi][1] / height) * 100}%`, transform: 'translate(-50%,-135%)', background: T.bg, border: `1px solid ${WORK}`, color: T.txt, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{format(data[hi])}</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: T.txt3, fontWeight: 600 }}>{labels.map((l, i) => <span key={i}>{l}</span>)}</div>
    </div>
  )
}
