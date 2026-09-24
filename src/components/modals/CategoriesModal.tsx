import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { Lock, Trash2, Check } from 'lucide-react'
import type { Theme, FlatCategory } from '../../lib/types'
import { CATS, slug } from '../../lib/data'
import { CAT_ICON, ICON_CHOICES, COLOR_CHOICES } from '../../icons'
import { catColor } from '../../lib/theme'
import { Sheet, Field, Btn } from '../ui'
import { haptic } from '../../lib/haptic'

export default function CategoriesModal({ open, onClose, T, custom, addCategory, deleteCategory }: {
  open: boolean; onClose: () => void; T: Theme; custom: FlatCategory[]
  addCategory: (label: string, icon: string, color: string) => void
  deleteCategory: (c: FlatCategory) => void
}) {
  const [label, setLabel] = useState('')
  const [icon, setIcon] = useState('tag')
  const [color, setColor] = useState(COLOR_CHOICES[0])
  useEffect(() => { if (open) { setLabel(''); setIcon('tag'); setColor(COLOR_CHOICES[0]) } }, [open])

  const key = slug(label)
  const taken = !!key && (CATS.some((c) => c.id === key) || custom.some((c) => c.key === key))
  const valid = key.length > 0 && !taken
  const submit = () => { if (!valid) return; addCategory(label.trim(), icon, color); setLabel('') }
  const Preview = ICON_CHOICES[icon] || ICON_CHOICES.tag

  return (
    <Sheet open={open} onClose={onClose} title="Categories" T={T}>
      <div style={{ fontSize: 13.5, color: T.txt2, marginBottom: 16, marginTop: -4 }}>Shared with your flat — used for both list items and expenses.</div>

      <Field T={T} label="New category" htmlFor="cat-name" error={taken ? `“${label.trim()}” already exists.` : undefined}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="h-item-ic" style={{ width: 50, height: 50, borderRadius: 15, background: color }}><Preview size={22} /></span>
          <input id="cat-name" className="fld" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="e.g. Shopping" />
        </div>
      </Field>
      <div className="h-well" style={{ padding: 12, marginBottom: 12 }}>
        <div role="radiogroup" aria-label="Icon" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(40px,1fr))', gap: 7 }}>
          {Object.keys(ICON_CHOICES).map((k) => {
            const KI = ICON_CHOICES[k]
            const on = icon === k
            return <button key={k} type="button" role="radio" aria-checked={on} aria-label={k} onClick={() => { haptic(5); setIcon(k) }} style={{ height: 40, borderRadius: 12, background: on ? color : 'transparent', color: on ? '#fff' : T.txt2, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background .2s' }}><KI size={18} /></button>
          })}
        </div>
        <div role="radiogroup" aria-label="Colour" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {COLOR_CHOICES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} onClick={() => { haptic(5); setColor(c) }} style={{ width: 28, height: 28, borderRadius: 99, background: c, border: 'none', boxShadow: color === c ? `0 0 0 2px var(--bg), 0 0 0 4px ${c}` : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} aria-label={c}>{color === c && <Check size={14} color="#fff" strokeWidth={3} />}</button>
          ))}
        </div>
      </div>
      <Btn full size="md" disabled={!valid} onClick={submit}>Add category</Btn>

      {custom.length > 0 && (
        <Field T={T} label={`Your flat's categories · ${custom.length}`} style={{ marginTop: 20 }}>
          <div className="h-well">
            {custom.map((c) => {
              const CI = ICON_CHOICES[c.icon] || ICON_CHOICES.tag
              return (
                <div key={c.id} className="h-item" style={{ '--inset': '61px' } as CSSProperties}>
                  <span className="h-item-ic" style={{ background: c.color }}><CI size={16} /></span>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{c.label}</span>
                  <button type="button" onClick={() => deleteCategory(c)} className="h-icbtn" style={{ width: 36, height: 36, background: 'none', color: T.txt3 }} aria-label={`Delete ${c.label}`}><Trash2 size={17} /></button>
                </div>
              )
            })}
          </div>
        </Field>
      )}

      <Field T={T} label="Built in" style={{ marginTop: custom.length ? 0 : 20, marginBottom: 4 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {CATS.map((c) => {
            const CI = CAT_ICON[c.id]
            return <span key={c.id} className="chip" style={{ cursor: 'default' }}><CI size={13} color={catColor(c.id)} /> {c.label} <Lock size={11} color={T.txt3} /></span>
          })}
        </div>
      </Field>
    </Sheet>
  )
}
