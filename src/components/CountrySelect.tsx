import type { Country } from '../lib/types'
import { Flag } from './ui'

/* a native select (the phone's own picker) with the chosen flag inside it */
export default function CountrySelect({ value, onChange, options, label, id }: {
  value: string; onChange: (v: string) => void; options: Country[]; label: string; id?: string
}) {
  const cur = options.find((c) => c.n === value) || options[0]
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex' }}><Flag iso={cur.iso} size={20} /></span>
      <select id={id} className="fld" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ paddingLeft: 52 }}>
        {options.map((c) => <option key={c.n} value={c.n}>{c.n} · {c.c}</option>)}
      </select>
    </div>
  )
}
