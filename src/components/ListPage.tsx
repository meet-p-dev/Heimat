import { useState } from 'react'
import { X, ChevronRight, Check, Plus, Trash2, Settings2, ShoppingCart, Receipt } from 'lucide-react'
import type { Theme, ListItem, Cat } from '../lib/types'
import { catOf } from '../lib/data'
import { iconOf } from '../icons'
import { colorOf } from '../lib/theme'
import { haptic } from '../lib/haptic'
import { Page, Chip, Btn, EmptyState, SectionLabel, CheckCircle } from './ui'

export default function ListPage({ T, onClose, items, nameOf, addItem, setItemBought, deleteItem, clearBoughtItems, expenseFromBought, cats, openCategories }: {
  T: Theme; onClose: () => void; items: ListItem[]; nameOf: (u: string) => string
  addItem: (title: string, category: string) => void
  setItemBought: (id: string, bought: boolean) => void; deleteItem: (id: string) => void
  clearBoughtItems: () => void; expenseFromBought: () => void
  cats: Cat[]; openCategories: () => void
}) {
  const [newItem, setNewItem] = useState('')
  const [newCat, setNewCat] = useState('groceries')
  const [showBought, setShowBought] = useState(true)
  const open = items.filter((i) => !i.bought)
  const bought = items.filter((i) => i.bought)
  const submit = () => { if (!newItem.trim()) return; addItem(newItem, newCat); setNewItem('') }

  // the add row is pinned under the header so it's always one tap away
  const top = (
    <div style={{ flexShrink: 0, padding: '4px 16px 10px', maxWidth: 560, width: '100%', margin: '0 auto' }}>
      <div className="glass" style={{ borderRadius: 24, padding: 12 }}>
        <form onSubmit={(e) => { e.preventDefault(); submit() }} style={{ display: 'flex', gap: 8 }}>
          <input className="fld" aria-label="New item" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Milk, toilet paper, call landlord…" style={{ flex: 1, minWidth: 0 }} />
          <button type="submit" aria-label="Add to list" disabled={!newItem.trim()} className="btn btn-primary" style={{ width: 50, minHeight: 50, padding: 0, borderRadius: 16 }}><Plus size={22} strokeWidth={2.6} /></button>
        </form>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 10, paddingBottom: 2 }}>
          {cats.map((x) => <Chip key={x.id} T={T} on={newCat === x.id} tint={x.color} icon={iconOf(x)} onClick={() => setNewCat(x.id)} style={{ padding: '6px 11px', fontSize: 12.5 }}>{x.label}</Chip>)}
          <Chip T={T} dashed icon={Settings2} onClick={openCategories} style={{ padding: '6px 11px', fontSize: 12.5 }}>Categories</Chip>
        </div>
      </div>
    </div>
  )

  return (
    <Page T={T} title="Shopping list" onBack={onClose} top={top}>
      {open.length === 0 && bought.length === 0 ? (
        <EmptyState T={T} icon={ShoppingCart} title="Nothing on the list" body="Add what the flat needs. Whoever goes shopping ticks things off, and everyone sees it instantly." />
      ) : (
        <>
          <SectionLabel T={T}>{open.length ? `To buy · ${open.length}` : 'All done — nothing left to buy'}</SectionLabel>
          {open.length > 0 && (
            <div className="glass" style={{ borderRadius: 24, overflow: 'hidden' }}>
              {open.map((it) => {
                const c = catOf(cats, it.category)
                const II = iconOf(c)
                return (
                  <div key={it.id} className="h-item" style={{ '--inset': '56px' } as React.CSSProperties}>
                    <button type="button" onClick={() => { haptic(10); setItemBought(it.id, true) }} aria-label={`Mark ${it.title} as bought`} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}><CheckCircle on={false} /></button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15.5 }}>{it.title}</div>
                      <div style={{ fontSize: 12, color: T.txt3, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}><II size={12} color={colorOf(c)} /> {c.label} · added by {nameOf(it.added_by)}</div>
                    </div>
                    <button type="button" onClick={() => deleteItem(it.id)} aria-label={`Remove ${it.title}`} className="h-icbtn" style={{ width: 34, height: 34, background: 'none', color: T.txt3 }}><X size={17} /></button>
                  </div>
                )
              })}
            </div>
          )}

          {bought.length > 0 && (
            <>
              <SectionLabel T={T} right={<button type="button" className="h-link" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 3 }} onClick={() => setShowBought(!showBought)}>{showBought ? 'Hide' : 'Show'} <ChevronRight size={14} style={{ transform: showBought ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} /></button>}>Bought · {bought.length}</SectionLabel>
              <div className="glass" style={{ borderRadius: 24, overflow: 'hidden' }}>
                {showBought && bought.map((it) => (
                  <div key={it.id} className="h-item" style={{ '--inset': '56px' } as React.CSSProperties}>
                    <button type="button" onClick={() => { haptic(8); setItemBought(it.id, false) }} aria-label={`Put ${it.title} back on the list`} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}><CheckCircle on /></button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 15.5, color: T.txt3, textDecoration: 'line-through' }}>{it.title}</div>
                      <div style={{ fontSize: 12, color: T.txt3, marginTop: 2 }}>bought by {it.bought_by ? nameOf(it.bought_by) : '—'}</div>
                    </div>
                    <button type="button" onClick={() => deleteItem(it.id)} aria-label={`Remove ${it.title}`} className="h-icbtn" style={{ width: 34, height: 34, background: 'none', color: T.txt3 }}><X size={17} /></button>
                  </div>
                ))}
                <div className="h-item" style={{ gap: 8 }}>
                  <Btn size="md" icon={Receipt} onClick={expenseFromBought} style={{ flex: 1 }}>Add as expense</Btn>
                  <Btn size="md" kind="ghost" icon={Trash2} onClick={clearBoughtItems}>Clear</Btn>
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: T.txt3, margin: '8px 16px 0', lineHeight: 1.5, display: 'flex', gap: 6 }}><Check size={14} style={{ flexShrink: 0, marginTop: 2 }} /> “Add as expense” turns what was bought into one shared bill and clears it from the list.</div>
            </>
          )}
        </>
      )}
    </Page>
  )
}
