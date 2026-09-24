import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Plus, UserPlus, ShoppingCart, LineChart, Copy, LogOut, Receipt, ArrowRightLeft, KeyRound } from 'lucide-react'
import type { Theme, Flat, Member, Expense, ListItem, Cat, ModalId } from '../../lib/types'
import { haptic } from '../../lib/haptic'
import { settleSuggestions } from '../../lib/derive'
import type { SettleSuggestion } from '../../lib/derive'
import { monthLabel } from '../../lib/format'
import { copyText } from '../../lib/native'
import { Card, Btn, Chip, Avatar, SectionLabel, Group, Item, EmptyState, TINT } from '../ui'
import ExpenseRow from '../ExpenseRow'

export default function FlatTab({ T, flat, members, balances, uid, fH, nameOf, setModal, leaveFlat, expenses, onOpenExpense, openSettle, items, openList, cats, myFlats, flatId, switchFlat, startAddExpense, openAnalytics, showToast }: {
  T: Theme; flat: Flat; members: Member[]; balances: Record<string, number>; uid: string | null
  fH: (v: number) => string; nameOf: (u: string) => string; setModal: (m: ModalId) => void
  leaveFlat: () => void; expenses: Expense[]; onOpenExpense: (e: Expense) => void; openSettle: (init: SettleSuggestion | null) => void
  items: ListItem[]; openList: () => void; cats: Cat[]
  myFlats: Flat[]; flatId: string | null; switchFlat: (id: string) => void; startAddExpense: () => void; openAnalytics: () => void
  showToast: (m: string) => void
}) {
  const suggestions = settleSuggestions(balances)
  const open = items.filter((i) => !i.bought).length
  // expenses arrive newest first, so each month is one contiguous run
  const months = useMemo(() => {
    const out: { key: string; label: string; total: number; list: Expense[] }[] = []
    expenses.forEach((e) => {
      const k = e.spent_on.slice(0, 7)
      let g = out[out.length - 1]
      if (!g || g.key !== k) { g = { key: k, label: monthLabel(e.spent_on), total: 0, list: [] }; out.push(g) }
      g.list.push(e)
      g.total += e.amount
    })
    return out
  }, [expenses])
  const copyCode = async () => { if (await copyText(flat.join_code)) { haptic(10); showToast('Flat code copied') } }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -16px 14px', padding: '2px 16px' }}>
        {myFlats.length > 1 && myFlats.map((f) => <Chip key={f.id} T={T} on={f.id === flatId} onClick={() => switchFlat(f.id)}>{f.name}</Chip>)}
        <Chip T={T} dashed icon={Plus} onClick={() => setModal('create')}>New flat</Chip>
        <Chip T={T} dashed icon={KeyRound} onClick={() => setModal('join')}>Join with code</Chip>
      </div>

      <Card T={T} grad style={{ padding: 18, borderRadius: 28, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{flat.name}</div>
            <button type="button" onClick={copyCode} className="h-pill" aria-label={`Copy flat code ${flat.join_code}`} style={{ background: T.accSoft, color: T.acc, border: 'none', marginTop: 7, cursor: 'pointer', letterSpacing: 0.6 }}><Copy size={12} /> {flat.join_code}</button>
          </div>
          <Btn size="sm" icon={UserPlus} onClick={() => setModal('invite')}>Invite</Btn>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 16 }}>
          {members.slice(0, 6).map((m, i) => <span key={m.user_id} style={{ marginLeft: i ? -9 : 0, borderRadius: 99, boxShadow: '0 0 0 2.5px var(--bg)', display: 'flex' }}><Avatar name={m.display_name} seed={m.user_id} size={30} /></span>)}
          <span style={{ marginLeft: 10, fontSize: 13.5, color: T.txt2 }}>{members.length} {members.length === 1 ? 'person — invite your flatmates' : 'flatmates'}</span>
        </div>
      </Card>

      <SectionLabel T={T}>Balances</SectionLabel>
      <div className="glass" style={{ borderRadius: 24, overflow: 'hidden', marginBottom: 12 }}>
        {members.map((m) => {
          const net = balances[m.user_id] || 0
          const owes = suggestions.filter((s) => s.from === m.user_id)
          const gets = suggestions.filter((s) => s.to === m.user_id)
          return (
            <div key={m.user_id} className="h-item" style={{ '--inset': '69px', alignItems: 'flex-start' } as CSSProperties}>
              <Avatar name={m.display_name} seed={m.user_id} size={40} />
              <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15.5 }}>{m.display_name}{m.user_id === uid ? ' (you)' : ''}</div>
                {owes.length === 0 && gets.length === 0 && <div style={{ fontSize: 12.5, color: T.txt3, marginTop: 2 }}>settled up</div>}
                {owes.map((s) => <div key={`o${s.to}`} style={{ fontSize: 12.5, color: T.txt2, marginTop: 2 }}>owes <b style={{ color: T.red }}>{fH(s.amount)}</b> to {nameOf(s.to)}</div>)}
                {gets.map((s) => <div key={`g${s.from}`} style={{ fontSize: 12.5, color: T.txt2, marginTop: 2 }}>gets <b style={{ color: T.green }}>{fH(s.amount)}</b> from {nameOf(s.from)}</div>)}
              </div>
              <div style={{ fontWeight: 750, fontSize: 15, fontVariantNumeric: 'tabular-nums', color: net > 0.5 ? T.green : net < -0.5 ? T.red : T.txt3, paddingTop: 1 }}>
                {net > 0.5 ? `+${fH(net)}` : net < -0.5 ? `−${fH(-net)}` : '—'}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
        <Btn size="md" kind="secondary" icon={ArrowRightLeft} onClick={() => openSettle(null)} style={{ flex: 1 }}>Settle up</Btn>
        <Btn size="md" icon={Plus} onClick={startAddExpense} style={{ flex: 1 }}>Add expense</Btn>
      </div>

      <Group T={T}>
        <Item T={T} icon={ShoppingCart} tint={TINT.pink} label="Shopping list" sub={open ? `${open} to buy` : 'Nothing to buy'} onClick={() => { haptic(8); openList() }} />
        <Item T={T} icon={LineChart} tint={TINT.blue} label="Analytics" sub="Spend trend, categories and who paid" onClick={openAnalytics} />
      </Group>

      {months.length === 0 ? (
        <Card T={T} style={{ borderRadius: 26, marginBottom: 22 }}>
          <EmptyState T={T} icon={Receipt} title="No shared expenses yet" body="Add rent, groceries or the internet bill — Heimat splits it and keeps score for everyone.">
            <Btn icon={Plus} onClick={startAddExpense}>Add the first expense</Btn>
          </EmptyState>
        </Card>
      ) : months.map((g) => (
        <section key={g.key}>
          <SectionLabel T={T} right={<span style={{ fontSize: 13, color: T.txt3, fontVariantNumeric: 'tabular-nums' }}>{fH(g.total)}</span>}>{g.label}</SectionLabel>
          <div className="glass" style={{ borderRadius: 24, overflow: 'hidden' }}>
            {g.list.map((e) => <ExpenseRow key={e.id} {...{ T, e, cats, uid, nameOf, fH }} onClick={() => onOpenExpense(e)} />)}
          </div>
        </section>
      ))}

      <div style={{ marginTop: 26 }}><Btn full kind="danger" size="md" icon={LogOut} onClick={leaveFlat}>Leave “{flat.name}”</Btn></div>
    </>
  )
}
