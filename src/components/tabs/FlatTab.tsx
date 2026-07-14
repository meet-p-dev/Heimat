import { useState } from 'react'
import { X, LineChart, ChevronRight, Check, Plus, Trash2 } from 'lucide-react'
import type { Theme, Flat, Member, Expense, ListItem, ModalId } from '../../lib/types'
import { cat, CATS } from '../../lib/data'
import { CAT_ICON } from '../../icons'
import { haptic } from '../../lib/haptic'
import { settleSuggestions } from '../../lib/derive'
import type { SettleSuggestion } from '../../lib/derive'

export default function FlatTab({ T, flat, members, balances, uid, fH, nameOf, setModal, leaveFlat, expenses, deleteExpense, onEditExpense, onViewExpense, openSettle, items, addItem, setItemBought, deleteItem, clearBoughtItems, expenseFromBought, myFlats, flatId, switchFlat, startAddExpense, openAnalytics }: {
  T: Theme; flat: Flat; members: Member[]; balances: Record<string, number>; uid: string | null
  fH: (v: number) => string; nameOf: (u: string) => string; setModal: (m: ModalId) => void
  leaveFlat: () => void; expenses: Expense[]; deleteExpense: (id: string) => void; onEditExpense: (e: Expense) => void
  onViewExpense: (e: Expense) => void; openSettle: (init: SettleSuggestion | null) => void
  items: ListItem[]; addItem: (title: string, category: string) => void
  setItemBought: (id: string, bought: boolean) => void; deleteItem: (id: string) => void
  clearBoughtItems: () => void; expenseFromBought: () => void
  myFlats: Flat[]; flatId: string | null; switchFlat: (id: string) => void; startAddExpense: () => void; openAnalytics: () => void
}) {
  const suggestions = settleSuggestions(balances)
  const [newItem, setNewItem] = useState('')
  const [newCat, setNewCat] = useState('groceries')
  const [showBought, setShowBought] = useState(false)
  const open = items.filter((i) => !i.bought)
  const bought = items.filter((i) => i.bought)
  const submitItem = () => { if (!newItem.trim()) return; addItem(newItem, newCat); setNewItem('') }
  return (
    <>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 12, paddingBottom: 2 }}>
        {(myFlats || []).map((f) => <button key={f.id} onClick={() => { haptic(8); switchFlat(f.id) }} className="h-press" style={{ flexShrink: 0, padding: '8px 14px', borderRadius: 99, border: 'none', background: f.id === flatId ? T.acc : T.card, color: f.id === flatId ? '#fff' : T.txt2, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{f.name}</button>)}
        <button onClick={() => setModal('create')} className="h-press" style={{ flexShrink: 0, padding: '8px 13px', borderRadius: 99, border: `1px solid ${T.border}`, background: 'none', color: T.acc, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ New</button>
        <button onClick={() => setModal('join')} className="h-press" style={{ flexShrink: 0, padding: '8px 13px', borderRadius: 99, border: `1px solid ${T.border}`, background: 'none', color: T.acc, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Join</button>
      </div>
      <div style={{ background: T.card, borderRadius: 20, padding: '16px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><div style={{ fontWeight: 800, fontSize: 18 }}>{flat.name}</div><div style={{ fontSize: 12, color: T.txt2, marginTop: 2 }}>Code <span style={{ fontWeight: 700, color: T.acc, letterSpacing: 1 }}>{flat.join_code}</span></div></div>
        <button onClick={() => setModal('invite')} className="h-press" style={{ background: T.acc, color: '#fff', border: 'none', borderRadius: 12, padding: '10px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Invite</button>
      </div>
      <span className="h-lbl" style={{ color: T.txt3 }}>Flatmates · {members.length}</span>
      <div style={{ background: T.card, borderRadius: 20, overflow: 'hidden', marginBottom: 14 }}>
        {members.map((m, i) => {
          const net = balances[m.user_id] || 0
          const owes = suggestions.filter((s) => s.from === m.user_id)
          const gets = suggestions.filter((s) => s.to === m.user_id)
          const settled = owes.length === 0 && gets.length === 0
          return (
            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
              <div style={{ width: 38, height: 38, borderRadius: 99, background: T.acc, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, flexShrink: 0 }}>{(m.display_name || '?')[0].toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{m.display_name}{m.user_id === uid ? ' (you)' : ''}</div>
                {settled ? (
                  <div style={{ fontSize: 12, color: T.txt2, marginTop: 1 }}>settled up</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3 }}>
                    {owes.map((s) => (
                      <div key={`o${s.to}`} style={{ fontSize: 12, color: T.red }}>
                        owes <b style={{ fontWeight: 700 }}>{fH(s.amount)}</b> to {nameOf(s.to)}
                      </div>
                    ))}
                    {gets.map((s) => (
                      <div key={`g${s.from}`} style={{ fontSize: 12, color: T.green }}>
                        gets <b style={{ fontWeight: 700 }}>{fH(s.amount)}</b> back from {nameOf(s.from)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <button onClick={() => openSettle(null)} className="h-press" style={{ flex: 1, background: T.card, color: T.acc, border: `1px solid ${T.border}`, borderRadius: 14, padding: '13px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Settle up</button>
        <button onClick={startAddExpense} className="h-press" style={{ flex: 1, background: T.acc, color: '#fff', border: 'none', borderRadius: 14, padding: '13px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>+ Add expense</button>
      </div>

      {/* shared shopping / to-do list */}
      <span className="h-lbl" style={{ color: T.txt3 }}>Shopping list{open.length ? ` · ${open.length}` : ''}</span>
      <div style={{ background: T.card, borderRadius: 20, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '12px 15px', borderBottom: open.length || bought.length ? `1px solid ${T.border}` : 'none' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitItem() }} placeholder="Milk, toilet paper, call landlord…" style={{ flex: 1, minWidth: 0, background: T.inp, border: `1px solid ${T.border}`, borderRadius: 12, padding: '11px 13px', color: T.txt, fontSize: 14, outline: 'none' }} />
            <button onClick={submitItem} disabled={!newItem.trim()} className="h-press" style={{ flexShrink: 0, width: 44, background: newItem.trim() ? T.acc : T.inp, color: newItem.trim() ? '#fff' : T.txt3, border: 'none', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: newItem.trim() ? 'pointer' : 'default' }}><Plus size={19} /></button>
          </div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 9, paddingBottom: 2 }}>
            {CATS.map((x) => {
              const XI = CAT_ICON[x.id]
              const on = newCat === x.id
              return <button key={x.id} onClick={() => { haptic(6); setNewCat(x.id) }} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, background: on ? T.acc : T.inp, color: on ? '#fff' : T.txt2, border: `1px solid ${on ? T.acc : T.border}`, borderRadius: 99, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}><XI size={12} /> {x.label}</button>
            })}
          </div>
        </div>

        {open.length === 0 && bought.length === 0 ? (
          <div style={{ padding: '14px 15px', color: T.txt3, fontSize: 13 }}>Nothing on the list. Add what the flat needs — anyone can tick it off after buying.</div>
        ) : (
          open.map((it, i) => {
            const II = CAT_ICON[it.category] || CAT_ICON.other
            return (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 15px', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                <button onClick={() => setItemBought(it.id, true)} className="h-press" style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 99, border: `2px solid ${T.border}`, background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} aria-label={`Mark ${it.title} as bought`} />
                <div style={{ width: 30, height: 30, borderRadius: 9, background: T.inp, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.txt2, flexShrink: 0 }}><II size={15} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{it.title}</div>
                  <div style={{ fontSize: 11, color: T.txt2 }}>{cat(it.category).label} · added by {nameOf(it.added_by)}</div>
                </div>
                <button onClick={() => deleteItem(it.id)} style={{ background: 'none', border: 'none', color: T.txt3, cursor: 'pointer', display: 'flex', padding: 4 }}><X size={15} /></button>
              </div>
            )
          })
        )}

        {bought.length > 0 && (
          <div style={{ borderTop: `1px solid ${T.border}`, background: T.cardH }}>
            <button onClick={() => { haptic(6); setShowBought(!showBought) }} style={{ width: '100%', background: 'none', border: 'none', padding: '11px 15px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: T.txt2 }}>
              <Check size={15} color={T.green} />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 600 }}>Bought · {bought.length}</span>
              <ChevronRight size={16} color={T.txt3} style={{ transform: showBought ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            {showBought && (
              <>
                {bought.map((it) => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 15px', borderTop: `1px solid ${T.border}` }}>
                    <button onClick={() => setItemBought(it.id, false)} className="h-press" style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 99, border: 'none', background: T.green, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} aria-label={`Put ${it.title} back on the list`}><Check size={14} color="#fff" /></button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14, color: T.txt2, textDecoration: 'line-through' }}>{it.title}</div>
                      <div style={{ fontSize: 11, color: T.txt3 }}>bought by {it.bought_by ? nameOf(it.bought_by) : '—'}</div>
                    </div>
                    <button onClick={() => deleteItem(it.id)} style={{ background: 'none', border: 'none', color: T.txt3, cursor: 'pointer', display: 'flex', padding: 4 }}><X size={15} /></button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, padding: '11px 15px', borderTop: `1px solid ${T.border}` }}>
                  <button onClick={expenseFromBought} className="h-press" style={{ flex: 1, background: T.acc, color: '#fff', border: 'none', borderRadius: 11, padding: '10px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Add as expense</button>
                  <button onClick={clearBoughtItems} className="h-press" style={{ flexShrink: 0, background: 'none', color: T.txt2, border: `1px solid ${T.border}`, borderRadius: 11, padding: '10px 13px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}><Trash2 size={14} /> Clear</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div onClick={openAnalytics} className="h-press" style={{ display: 'flex', alignItems: 'center', gap: 13, background: `linear-gradient(135deg, ${T.accSoft}, ${T.card})`, border: `1px solid ${T.border}`, borderRadius: 18, padding: '14px 16px', marginBottom: 14, cursor: 'pointer' }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: T.card, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.acc }}><LineChart size={20} /></div>
        <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 15 }}>Analytics</div><div style={{ fontSize: 12, color: T.txt2 }}>Spend trend, categories & who paid</div></div>
        <ChevronRight size={18} color={T.txt3} />
      </div>
      <span className="h-lbl" style={{ color: T.txt3 }}>All shared expenses</span>
      <div style={{ background: T.card, borderRadius: 20, overflow: 'hidden', marginBottom: 14 }}>
        {expenses.length === 0 ? (
          <div style={{ padding: '16px', color: T.txt3, fontSize: 14 }}>Nothing yet.</div>
        ) : (
          expenses.map((e, i) => {
            const c = cat(e.category)
            const CIcon = CAT_ICON[e.category] || CAT_ICON.other
            // you can edit/delete an expense you added, or one someone else logged but you paid for
            const mine = e.created_by === uid || e.paid_by === uid
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 15px', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                <div style={{ width: 36, height: 36, borderRadius: 11, background: T.cardH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.txt2 }}><CIcon size={17} /></div>
                <div onClick={() => { haptic(6); mine ? onEditExpense(e) : onViewExpense(e) }} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{e.description || c.label}</div>
                  <div style={{ fontSize: 11, color: T.txt2 }}>{nameOf(e.paid_by)} paid · split {(e.split_among || []).length} · {e.spent_on}{mine ? ' · tap to edit' : ' · tap for details'}</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{fH(e.amount)}</div>
                {mine && <button onClick={() => deleteExpense(e.id)} style={{ background: 'none', border: 'none', color: T.txt3, cursor: 'pointer', display: 'flex', padding: 4 }}><X size={15} /></button>}
              </div>
            )
          })
        )}
      </div>
      <button onClick={leaveFlat} className="h-press" style={{ width: '100%', background: 'none', color: T.red, border: `1px solid ${T.border}`, borderRadius: 14, padding: '12px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Leave this flat</button>
    </>
  )
}
