import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Plus, UserPlus, ShoppingCart, LineChart, Copy, LogOut, Receipt, ArrowRightLeft, KeyRound } from 'lucide-react'
import type { Theme, Flat, Member, Expense, ListItem, Cat, ModalId } from '../../lib/types'
import { hasLeft, isPending } from '../../lib/types'
import { haptic } from '../../lib/haptic'
import type { SettleSuggestion } from '../../lib/derive'
import { pairwiseFor, toMajor } from '../../lib/ledger'
import type { Ledger } from '../../lib/ledger'
import { monthLabel } from '../../lib/format'
import { copyText } from '../../lib/native'
import { Card, Btn, Chip, Avatar, SectionLabel, Group, Item, EmptyState, TINT } from '../ui'
import ExpenseRow from '../ExpenseRow'

export default function FlatTab({ T, flat, members, ledger, uid, fH, nameOf, setModal, leaveFlat, expenses, onOpenExpense, openSettle, items, openList, cats, myFlats, flatId, switchFlat, startAddExpense, openAnalytics, showToast }: {
  T: Theme; flat: Flat; members: Member[]; ledger: Ledger; uid: string | null
  fH: (v: number) => string; nameOf: (u: string) => string; setModal: (m: ModalId) => void
  leaveFlat: () => void; expenses: Expense[]; onOpenExpense: (e: Expense) => void; openSettle: (init: SettleSuggestion | null) => void
  items: ListItem[]; openList: () => void; cats: Cat[]
  myFlats: Flat[]; flatId: string | null; switchFlat: (id: string) => void; startAddExpense: () => void; openAnalytics: () => void
  showToast: (m: string) => void
}) {
  /* Who owes whom, as it actually stands — not the shortest way to square up.
     Those are different numbers: simplifying moves a debt onto whoever makes
     the fewest payments, so it would say you owe Kevin when you owe Kartik.
     The suggestion belongs in Settle up, where it is offered as one; these
     lines are the pairwise figures, the same as the iOS app shows.
     Everyone still carrying a balance gets a row — including someone who has
     left, and anyone with money on the books but no member row at all. */
  const rows = useMemo(() => {
    const net = (u: string) => ledger.netMinor.get(u) || 0
    const listed = members.filter((m) => !hasLeft(m) || net(m.user_id) !== 0)
    const known = new Set(members.map((m) => m.user_id))
    const strays = [...ledger.netMinor.keys()].filter((u) => !known.has(u) && net(u) !== 0).sort()
    return [
      ...listed.map((m) => ({ id: m.user_id, name: m.display_name, left: hasLeft(m), pending: isPending(m) })),
      ...strays.map((u) => ({ id: u, name: '', left: true, pending: false })),
    ].map((r) => {
      const pairs = [...pairwiseFor(ledger.owes, r.id)].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1))
      return { ...r, net: net(r.id), owes: pairs.filter(([, v]) => v < 0), gets: pairs.filter(([, v]) => v > 0) }
    })
  }, [ledger, members])
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
        {rows.map((r) => (
          <div key={r.id} className="h-item" style={{ '--inset': '69px', alignItems: 'flex-start' } as CSSProperties}>
            <Avatar name={r.name || nameOf(r.id)} seed={r.id} size={40} />
            <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15.5 }}>
                {r.name || nameOf(r.id)}{r.id === uid ? ' (you)' : ''}
                {(r.left || r.pending) && <span className="h-pill" style={{ marginLeft: 7, fontSize: 10.5, padding: '2px 7px', background: 'color-mix(in srgb, var(--txt3) 18%, transparent)', color: T.txt2 }}>{r.left ? 'left' : 'invited'}</span>}
              </div>
              {r.owes.length === 0 && r.gets.length === 0 && <div style={{ fontSize: 12.5, color: T.txt3, marginTop: 2 }}>settled up</div>}
              {r.owes.map(([other, v]) => <div key={`o${other}`} style={{ fontSize: 12.5, color: T.txt2, marginTop: 2 }}>owes <b style={{ color: T.red }}>{fH(toMajor(-v))}</b> to {nameOf(other)}</div>)}
              {r.gets.map(([other, v]) => <div key={`g${other}`} style={{ fontSize: 12.5, color: T.txt2, marginTop: 2 }}>gets <b style={{ color: T.green }}>{fH(toMajor(v))}</b> from {nameOf(other)}</div>)}
            </div>
            <div style={{ fontWeight: 750, fontSize: 15, fontVariantNumeric: 'tabular-nums', color: r.net > 0 ? T.green : r.net < 0 ? T.red : T.txt3, paddingTop: 1 }}>
              {r.net > 0 ? `+${fH(toMajor(r.net))}` : r.net < 0 ? `−${fH(toMajor(-r.net))}` : '—'}
            </div>
          </div>
        ))}
      </div>
      {ledger.excluded.length > 0 && (
        <div style={{ fontSize: 12.5, color: T.amber, margin: '-4px 4px 12px', lineHeight: 1.5 }}>
          {ledger.excluded.length === 1 ? '1 expense is' : `${ledger.excluded.length} expenses are`} in another currency than {ledger.currency} and {ledger.excluded.length === 1 ? 'is' : 'are'} not in these balances.
        </div>
      )}
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
