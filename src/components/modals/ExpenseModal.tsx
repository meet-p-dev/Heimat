import { useState, useEffect, useMemo } from 'react'
import { Settings2, Trash2, Users, ChevronRight } from 'lucide-react'
import type { Theme, Member, Expense, Cat, SplitType, SplitData } from '../../lib/types'
import { hasLeft } from '../../lib/types'
import { iconOf } from '../../icons'
import { money, amountVal, tod, relDay } from '../../lib/format'
import { computeShares, minorToInput, toMinor, cmp } from '../../lib/ledger'
import { personName, pairCircle } from '../../lib/places'
import type { PersonPick } from '../../lib/places'
import { Sheet, Field, Btn, Chip, Avatar, SegmentedControl } from '../ui'
import { SplitEditor, PayersEditor, emptySplit, buildSpec, splitData, payersOf, fromExpense } from '../SplitEditor'
import type { SplitState } from '../SplitEditor'
import { WithPicker } from '../Friends'
import { learn, suggestCategory } from '../../lib/suggest'
import type { FriendsCtx } from '../Friends'

/* what the form hands back: engine v2's columns, always all of them — that is how
   the server tells this app from the ones before split types (docs/money-engine.md) */
export interface ExpenseSave {
  id: string; place: string; editing: boolean
  description: string; amount: number; currency: string; paid_by: string; split_among: string[]
  split_type: SplitType; split: SplitData | null; payers: Record<string, number> | null; category: string; spent_on: string
}
export interface ExpensePrefill { desc?: string; category?: string; people?: PersonPick[] | null }

/* an id for a new expense, made before it is saved so the split shown is the split saved */
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16) })).toLowerCase()

export default function ExpenseModal({ open, onClose, c, start, editing, prefill, hostCur, homeCur, rate, cats, openCategories, onDelete, save, resolve }: {
  open: boolean; onClose: () => void; c: FriendsCtx
  /* the group to start in when adding, when nothing else says */
  start: string | null
  editing: Expense | null; prefill: ExpensePrefill | null
  hostCur: string; homeCur: string; rate: number
  cats: Cat[]; openCategories: () => void; onDelete?: () => void
  save: (x: ExpenseSave) => void
  /* people → the circle that holds an expense with them (found or made by the server) */
  resolve: (picks: PersonPick[]) => Promise<string | null>
}) {
  const { T, uid } = c
  const [desc, setDesc] = useState('')
  const [amt, setAmt] = useState('')
  const [payer, setPayer] = useState(uid || '')
  const [split, setSplit] = useState<SplitState>(emptySplit([]))
  const [cat, setCat] = useState('groceries')
  // once you pick a category yourself, typing stops suggesting one
  const [catTouched, setCatTouched] = useState(false)
  // what you filed things under before, newest first (src/lib/suggest.ts)
  const learned = useMemo(() => learn(c.expenses.filter((e) => e.created_by === uid || e.paid_by === uid)
    .map((e) => ({ description: e.description || '', category: e.category || '' }))), [c.expenses, uid])
  const typed = (d: string) => {
    setDesc(d)
    if (catTouched) return
    const s = suggestCategory(d, learned, (id) => cats.some((x) => x.id === id))
    if (s) setCat(s)
  }
  const [date, setDate] = useState(tod())
  const [draftId, setDraftId] = useState(newId)
  const [target, setTarget] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [resolving, setResolving] = useState(false)
  const circle = c.circles.some((x) => x.id === target)

  // who can be on it: the place's people now — and anyone already on an expense being
  // edited, so editing it cannot quietly drop someone who has left since
  const people: Member[] = useMemo(() => c.members.filter((m) => m.flat_id === target && (!hasLeft(m)
    || (!!editing && (editing.split_among?.includes(m.user_id) || editing.paid_by === m.user_id || !!editing.payers?.[m.user_id])))), [c.members, target, editing])
  const ids = people.map((m) => m.user_id)
  const nm = (u: string) => (u === uid ? 'You' : personName(c.members, u))

  const choose = async (choice: { group: string } | { people: PersonPick[] }) => {
    setChoosing(false)
    if ('group' in choice) { setTarget(choice.group); return }
    const picks = choice.people
    const known = picks.length === 1 && picks[0].userId ? pairCircle(c.circles, c.members, uid, picks[0].userId) : null
    if (known) { setTarget(known); return }
    setResolving(true)
    const id = await resolve(picks)
    setResolving(false)
    if (id) setTarget(id)
  }

  useEffect(() => {
    if (!open) return
    if (editing) {
      setDesc(editing.description || ''); setAmt(minorToInput(toMinor(editing.amount, editing.currency), editing.currency)); setPayer(editing.paid_by)
      setSplit(fromExpense(editing)); setCat(editing.category || 'other'); setDate(editing.spent_on || tod()); setTarget(editing.flat_id); setCatTouched(true)
    } else {
      setDesc(prefill?.desc || ''); setAmt(''); setPayer(uid || ''); setCat(prefill?.category || 'groceries'); setDate(tod()); setDraftId(newId())
      setCatTouched(!!prefill?.category)
      const picks = prefill?.people
      if (picks) { setTarget(''); if (picks.length) choose({ people: picks }); else setChoosing(true) }
      else setTarget(start || c.groups[0]?.id || '')
    }
  }, [open])
  // new people: an even split between all of them, paid by you (an edit keeps its payer while they are on it)
  useEffect(() => {
    if (!open || !target) return
    if (editing && editing.flat_id === target) return
    setSplit(emptySplit(c.members.filter((m) => m.flat_id === target && !hasLeft(m)).map((m) => m.user_id)))
    setPayer((p) => (c.members.some((m) => m.flat_id === target && m.user_id === p) ? p : uid || ''))
  }, [target])

  const cur = editing?.currency || hostCur
  const v = amountVal(amt, cur)
  const total = toMinor(v, cur)
  const seed = editing ? editing.id : draftId
  const built = buildSpec(split, cur)
  const result = computeShares(total, built.spec, seed)
  const paid = payersOf(split, cur)
  const paidOK = split.severalPaid ? !!paid && Object.keys(paid).length > 0 && Object.values(paid).reduce((a, b) => a + b, 0) === total : !!payer
  const valid = v > 0 && result.ok && !built.unreadable && paidOK && !!target && !resolving && /^\d{4}-\d{2}-\d{2}$/.test(date)

  const withLabel = !target ? 'Choose' : circle ? people.filter((m) => m.user_id !== uid).map((m) => personName(c.members, m.user_id)).join(', ') || 'Choose'
    : c.groups.find((g) => g.id === target)?.name || ''

  const submit = () => {
    if (!valid || !result.ok) return
    // several payers only when it really was several; paid_by is whoever put down most
    const payers = split.severalPaid && paid && Object.keys(paid).length > 1 ? paid : null
    const paidBy = payers ? Object.entries(payers).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0][0] : split.severalPaid && paid ? Object.keys(paid)[0] : payer
    // equal and adjusted splits are worked out from who is ticked; the rest from their figures
    const among = split.mode === 'equal' || split.mode === 'adjust' ? [...split.among].sort(cmp) : [...result.shares.keys()].sort(cmp)
    save({
      id: editing ? editing.id : draftId, place: target, editing: !!editing,
      description: desc.trim(), amount: v, currency: cur, paid_by: paidBy, split_among: among,
      split_type: split.mode, split: splitData(split, built.spec), payers, category: cat, spent_on: date,
    })
    onClose()
  }

  const peopleRows = people.map((m) => ({ id: m.user_id, name: m.display_name }))
  return (
    <>
      <Sheet open={open && !choosing} onClose={onClose} title={editing ? 'Edit expense' : 'New expense'} T={T}
        footer={<>
          <Btn full disabled={!valid} onClick={submit}>{editing ? 'Save changes' : v > 0 ? `Add ${money(v, cur)}` : 'Add expense'}</Btn>
          {editing && onDelete && <Btn full kind="danger" size="md" icon={Trash2} onClick={onDelete} style={{ marginTop: 4 }}>Delete expense</Btn>}
        </>}>
        <Field T={T} label="With you and" hint={editing && !circle ? "A group's expense stays in its group." : undefined}>
          <button type="button" className="h-well" disabled={(!!editing && !circle) || resolving} onClick={() => setChoosing(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 14px', cursor: 'pointer', color: target ? T.txt : T.acc, textAlign: 'left', font: 'inherit' }}>
            <Users size={18} color={T.acc} />
            <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resolving ? 'One moment…' : withLabel}</span>
            {!(editing && !circle) && <ChevronRight size={17} color={T.txt3} />}
          </button>
        </Field>
        <Field T={T} label="How much?" htmlFor="ex-amt" error={amt.trim() && v <= 0 ? 'Enter an amount like 12,50' : undefined} hint={cur === hostCur && homeCur !== hostCur && v > 0 ? `≈ ${money(v * rate, homeCur)} in your home currency` : undefined}>
          <div style={{ position: 'relative' }}>
            <input id="ex-amt" className="fld fld-big" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="0,00" style={{ paddingRight: 64 }} />
            <span style={{ position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: T.txt3 }}>{cur}</span>
          </div>
        </Field>
        <Field T={T} label="What for?" htmlFor="ex-desc"><input id="ex-desc" className="fld" value={desc} onChange={(e) => typed(e.target.value)} placeholder="e.g. Rewe groceries" /></Field>
        <Field T={T} label="Category">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {cats.map((x) => <Chip key={x.id} T={T} on={cat === x.id} tint={x.color} icon={iconOf(x)} onClick={() => { setCat(x.id); setCatTouched(true) }}>{x.label}</Chip>)}
            <Chip T={T} dashed icon={Settings2} onClick={openCategories}>Edit</Chip>
          </div>
        </Field>
        {people.length > 0 && <>
          <Field T={T} label="Paid by">
            <SegmentedControl T={T} label="Paid by" options={[['one', 'One person'], ['several', 'Several people']]} value={split.severalPaid ? 'several' : 'one'}
              onChange={(v) => setSplit({ ...split, severalPaid: v === 'several', paid: v === 'several' && !Object.keys(split.paid).length && payer ? { [payer]: amt } : split.paid })} />
            {!split.severalPaid && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                {people.map((m) => (
                  <Chip key={m.user_id} T={T} on={payer === m.user_id} onClick={() => setPayer(m.user_id)} style={{ paddingLeft: 5 }}>
                    <Avatar name={m.display_name} seed={m.user_id} size={24} /> {nm(m.user_id)}
                  </Chip>
                ))}
              </div>
            )}
          </Field>
          {split.severalPaid && <PayersEditor T={T} s={split} set={setSplit} people={peopleRows} total={total} cur={cur} name={nm} />}
          <SplitEditor T={T} s={split} set={setSplit} people={peopleRows} total={total} cur={cur} seed={seed} result={result} unreadable={built.unreadable}
            name={nm} setTotal={(minor) => setAmt(minorToInput(minor, cur))} />
        </>}
        <Field T={T} label="Date" htmlFor="ex-date" hint={date && date !== tod() ? relDay(date) : undefined} style={{ marginBottom: 4 }}>
          <input id="ex-date" className="fld" value={date} onChange={(e) => setDate(e.target.value)} type="date" />
        </Field>
        {ids.length === 0 && target && <div style={{ fontSize: 13, color: T.txt3 }}>Loading the people…</div>}
      </Sheet>
      <WithPicker c={c} open={open && choosing} onClose={() => { setChoosing(false); if (!target) onClose() }}
        group={circle ? null : target || null}
        people={circle ? people.filter((m) => m.user_id !== uid).map((m) => ({ userId: m.user_id, name: personName(c.members, m.user_id) })) : []}
        groupsAllowed={!editing} done={choose} />
    </>
  )
}
