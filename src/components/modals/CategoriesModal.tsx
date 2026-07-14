import { useState, useEffect } from 'react'
import { Lock, Trash2, Check } from 'lucide-react'
import type { Theme, FlatCategory } from '../../lib/types'
import { CATS, slug } from '../../lib/data'
import { CAT_ICON, ICON_CHOICES, COLOR_CHOICES } from '../../icons'
import { catColor } from '../../lib/theme'
import { Sheet, Field, inpStyle } from '../ui'
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

  return (
    <Sheet open={open} onClose={onClose} title="Categories" T={T}>
      <div style={{ fontSize: 12, color: T.txt2, marginBottom: 14, marginTop: -4 }}>Shared with your flat — used for both list items and expenses.</div>

      <Field label="New category" T={T}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="e.g. Shopping" style={inpStyle(T)} />
        {taken && <div style={{ fontSize: 12, color: T.amber, marginTop: 6 }}>“{label.trim()}” already exists.</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
          {Object.keys(ICON_CHOICES).map((k) => {
            const KI = ICON_CHOICES[k]
            const on = icon === k
            return <button key={k} onClick={() => { haptic(5); setIcon(k) }} style={{ width: 38, height: 38, borderRadius: 11, background: on ? color : T.inp, color: on ? '#fff' : T.txt2, border: `1px solid ${on ? color : T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} aria-label={k}><KI size={17} /></button>
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {COLOR_CHOICES.map((c) => (
            <button key={c} onClick={() => { haptic(5); setColor(c) }} style={{ width: 28, height: 28, borderRadius: 99, background: c, border: color === c ? `2px solid ${T.txt}` : '2px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} aria-label={c}>{color === c && <Check size={14} color="#fff" />}</button>
          ))}
        </div>
        <button onClick={submit} disabled={!valid} className="h-press" style={{ width: '100%', marginTop: 12, background: valid ? T.acc : T.border, color: '#fff', border: 'none', borderRadius: 14, padding: '13px', fontWeight: 700, fontSize: 15, cursor: valid ? 'pointer' : 'default' }}>Add category</button>
      </Field>

      {custom.length > 0 && (
        <Field label={`Your categories (${custom.length})`} T={T}>
          {custom.map((c) => {
            const CI = ICON_CHOICES[c.icon] || ICON_CHOICES.tag
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 13px', background: T.inp, borderRadius: 12, marginBottom: 7, border: `1px solid ${T.border}` }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}><CI size={16} /></div>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{c.label}</span>
                <button onClick={() => deleteCategory(c)} style={{ background: 'none', border: 'none', color: T.txt3, cursor: 'pointer', display: 'flex', padding: 5 }} aria-label={`Delete ${c.label}`}><Trash2 size={16} /></button>
              </div>
            )
          })}
        </Field>
      )}

      <Field label="Built-in" T={T}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {CATS.map((c) => {
            const CI = CAT_ICON[c.id]
            return (
              <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.inp, color: T.txt2, border: `1px solid ${T.border}`, borderRadius: 99, padding: '7px 11px', fontSize: 13, fontWeight: 600 }}>
                <CI size={13} color={catColor(c.id)} /> {c.label} <Lock size={11} color={T.txt3} />
              </span>
            )
          })}
        </div>
      </Field>
    </Sheet>
  )
}
