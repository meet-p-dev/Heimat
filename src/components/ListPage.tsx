import { useState } from 'react'
import { X, ChevronLeft, ChevronRight, Check, Plus, Trash2, Settings2 } from 'lucide-react'
import type { Theme, ListItem, Cat } from '../lib/types'
import { catOf } from '../lib/data'
import { iconOf } from '../icons'
import { haptic } from '../lib/haptic'

export default function ListPage({ T, onClose, items, nameOf, addItem, setItemBought, deleteItem, clearBoughtItems, expenseFromBought, cats, openCategories }: {
  T: Theme; onClose: () => void; items: ListItem[]; nameOf: (u: string) => string
  addItem: (title: string, category: string) => void
  setItemBought: (id: string, bought: boolean) => void; deleteItem: (id: string) => void
  clearBoughtItems: () => void; expenseFromBought: () => void
  cats: Cat[]; openCategories: () => void
}) {
  const [newItem, setNewItem] = useState('')
  const [newCat, setNewCat] = useState('groceries')
  const [showBought, setShowBought] = useState(false)
  const open = items.filter((i) => !i.bought)
  const bought = items.filter((i) => i.bought)
  const submit = () => { if (!newItem.trim()) return; addItem(newItem, newCat); setNewItem('') }

  // zIndex sits above the bottom nav (90) but below sheets (300), so the category sheet opens on top of this page
  return (
    <div className="h-page" style={{ position: 'fixed', inset: 0, zIndex: 200, background: T.bg, color: T.txt, display: 'flex', flexDirection: 'column', animation: 'hFade .22s ease' }}>
      {/* header */}
      <div style={{ flexShrink: 0, paddingTop: 'env(safe-area-inset-top)', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 12px 12px 6px' }}>
          <button onClick={onClose} className="h-press" style={{ background: 'none', border: 'none', color: T.txt, cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 8 }}><ChevronLeft size={24} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: -0.3 }}>Shopping list</div>
            <div style={{ fontSize: 12, color: T.txt2, marginTop: 1 }}>{open.length ? `${open.length} to buy` : 'nothing to buy'}{bought.length ? ` · ${bought.length} bought` : ''}</div>
          </div>
        </div>
      </div>

      {/* add row — pinned under the header so it's always reachable */}
      <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: `1px solid ${T.border}`, background: T.card }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="Milk, toilet paper, call landlord…" style={{ flex: 1, minWidth: 0, background: T.inp, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 13px', color: T.txt, fontSize: 15, outline: 'none' }} />
          <button onClick={submit} disabled={!newItem.trim()} className="h-press" style={{ flexShrink: 0, width: 46, background: newItem.trim() ? T.acc : T.inp, color: newItem.trim() ? '#fff' : T.txt3, border: 'none', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: newItem.trim() ? 'pointer' : 'default' }}><Plus size={20} /></button>
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 9, paddingBottom: 2 }}>
          {cats.map((x) => {
            const XI = iconOf(x)
            const on = newCat === x.id
            const tint = x.color || T.acc
            return <button key={x.id} onClick={() => { haptic(6); setNewCat(x.id) }} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, background: on ? tint : T.inp, color: on ? '#fff' : T.txt2, border: `1px solid ${on ? tint : T.border}`, borderRadius: 99, padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}><XI size={12} /> {x.label}</button>
          })}
          <button onClick={() => { haptic(6); openCategories() }} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', color: T.acc, border: `1px dashed ${T.border}`, borderRadius: 99, padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><Settings2 size={12} /> Categories</button>
        </div>
      </div>

      {/* scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '10px 16px calc(env(safe-area-inset-bottom) + 28px)' }}>
          {open.length === 0 && bought.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: T.txt3 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.txt2, marginBottom: 6 }}>Nothing on the list</div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>Add what the flat needs. Whoever goes out can tick things off, and everyone sees it instantly.</div>
            </div>
          ) : (
            <>
              {open.length > 0 && (
                <>
                  <span className="h-lbl" style={{ color: T.txt3, marginTop: 8 }}>To buy · {open.length}</span>
                  <div style={{ background: T.card, borderRadius: 18, overflow: 'hidden' }}>
                    {open.map((it, i) => {
                      const c = catOf(cats, it.category)
                      const II = iconOf(c)
                      return (
                        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                          <button onClick={() => setItemBought(it.id, true)} className="h-press" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 99, border: `2px solid ${T.border}`, background: 'none', cursor: 'pointer', padding: 0 }} aria-label={`Mark ${it.title} as bought`} />
                          <div style={{ width: 32, height: 32, borderRadius: 10, background: T.inp, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.color || T.txt2, flexShrink: 0 }}><II size={16} /></div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 15 }}>{it.title}</div>
                            <div style={{ fontSize: 11, color: T.txt2 }}>{c.label} · added by {nameOf(it.added_by)}</div>
                          </div>
                          <button onClick={() => deleteItem(it.id)} style={{ background: 'none', border: 'none', color: T.txt3, cursor: 'pointer', display: 'flex', padding: 5 }}><X size={16} /></button>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {bought.length > 0 && (
                <>
                  <span className="h-lbl" style={{ color: T.txt3 }}>Bought · {bought.length}</span>
                  <div style={{ background: T.card, borderRadius: 18, overflow: 'hidden' }}>
                    <button onClick={() => { haptic(6); setShowBought(!showBought) }} style={{ width: '100%', background: 'none', border: 'none', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', color: T.txt2 }}>
                      <Check size={16} color={T.green} />
                      <span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: 600 }}>{showBought ? 'Hide' : 'Show'} bought items</span>
                      <ChevronRight size={16} color={T.txt3} style={{ transform: showBought ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                    </button>
                    {showBought && bought.map((it) => (
                      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px', borderTop: `1px solid ${T.border}` }}>
                        <button onClick={() => setItemBought(it.id, false)} className="h-press" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 99, border: 'none', background: T.green, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} aria-label={`Put ${it.title} back on the list`}><Check size={15} color="#fff" /></button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 15, color: T.txt2, textDecoration: 'line-through' }}>{it.title}</div>
                          <div style={{ fontSize: 11, color: T.txt3 }}>bought by {it.bought_by ? nameOf(it.bought_by) : '—'}</div>
                        </div>
                        <button onClick={() => deleteItem(it.id)} style={{ background: 'none', border: 'none', color: T.txt3, cursor: 'pointer', display: 'flex', padding: 5 }}><X size={16} /></button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, padding: '12px 14px', borderTop: `1px solid ${T.border}` }}>
                      <button onClick={expenseFromBought} className="h-press" style={{ flex: 1, background: T.acc, color: '#fff', border: 'none', borderRadius: 12, padding: '11px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Add as expense</button>
                      <button onClick={clearBoughtItems} className="h-press" style={{ flexShrink: 0, background: 'none', color: T.txt2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '11px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}><Trash2 size={14} /> Clear</button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
