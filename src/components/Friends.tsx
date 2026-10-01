/*
  Groups, Non-group expenses and one person's page — the web's copy of
  ios-native/Heimat/GroupsView.swift (docs/friends-screens.md).
*/
import { NextBillLine, MyBillsCard } from './Bills'
import type { BillsCtx } from './Bills'
import { ChoreCardLine } from './Chores'
import type { ChoresCtx } from './Chores'
import { useState, useMemo, useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ChevronRight, ChevronDown, Plus, UserPlus, KeyRound, Search, X, Mail, Link2, ArrowRightLeft, Bell, Users, Share2 } from 'lucide-react'
import type { Theme, Flat, Member, Expense, Cat, PageId } from '../lib/types'
import { isPending } from '../lib/types'
import type { Ledger } from '../lib/ledger'
import { toMajor, minorToInput, parseMinor } from '../lib/ledger'
import { money } from '../lib/format'
import { haptic } from '../lib/haptic'
import { webOrigin, shareText, copyText } from '../lib/native'
import { friendLines, linesWith, totals, knownPeople, personName, sharedExpenses, pairCircle } from '../lib/places'
import type { PersonPick, PlaceLine, Amount } from '../lib/places'
import { findPerson, settleParts, PAIR } from '../lib/friends'
import { Card, Btn, Avatar, SectionLabel, Page, Sheet, Field, SegmentedControl, EmptyState } from './ui'
import ExpenseRow from './ExpenseRow'

export interface FriendsCtx {
  /* bills, when that part is switched on (src/components/Bills.tsx) */
  bills: BillsCtx | null
  chores: ChoresCtx | null
  T: Theme; uid: string | null; hostCur: string; main: string
  groups: Flat[]; circles: Flat[]; members: Member[]; expenses: Expense[]; books: Map<string, Ledger>; cats: Cat[]
  openPage: (p: PageId) => void; openGroup: (id: string) => void; invite: (flatId: string) => void
  openExpense: (e: Expense) => void; addWith: (people: PersonPick[] | null) => void
  settlePerson: (id: string) => void; remindPerson: (id: string) => void
  newGroup: () => void; join: () => void; showToast: (m: string) => void
}

const fmt = (a: Amount) => money(toMajor(Math.abs(a.minor), a.currency), a.currency)

/* "you owe 4,20 €", "you're owed 12,00 €" / "owes you 12,00 €", "all settled" */
function Standing({ T, a, person }: { T: Theme; a?: Amount; person?: boolean }) {
  const minor = a?.minor || 0
  return (
    <span style={{ textAlign: 'right', flexShrink: 0 }}>
      <span style={{ display: 'block', fontSize: 11.5, color: T.txt3 }}>{minor > 0 ? (person ? 'owes you' : "you're owed") : minor < 0 ? 'you owe' : 'all settled'}</span>
      {minor !== 0 && <span style={{ display: 'block', fontSize: 15, fontWeight: 750, color: minor > 0 ? T.green : T.red, fontVariantNumeric: 'tabular-nums' }}>{fmt(a!)}</span>}
    </span>
  )
}

function Faces({ people, size = 26 }: { people: { id: string; name: string }[]; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {people.slice(0, 4).map((p, i) => <span key={p.id} style={{ marginLeft: i ? -size * 0.3 : 0, borderRadius: 99, boxShadow: '0 0 0 2px var(--bg)', display: 'flex', zIndex: 4 - i }}><Avatar name={p.name} seed={p.id} size={size} /></span>)}
    </span>
  )
}

const myBalance = (books: Map<string, Ledger>, uid: string | null, place: string): Amount => {
  const l = books.get(place)
  return { currency: l?.currency || 'EUR', minor: (uid && l?.netMinor.get(uid)) || 0 }
}

/* ------------------------------------------------------------------ the tab */

export function GroupsTab({ c }: { c: FriendsCtx }) {
  const { T } = c
  const friends = useMemo(() => friendLines(c.circles, c.members, c.books, c.uid, c.main), [c.circles, c.members, c.books, c.uid, c.main])
  const ng = totals(friends.flatMap((f) => linesWith(c.books, c.uid, f.userId, c.circles.map((x) => x.id))), c.main)[0]
  const card = (key: string, title: string, people: { id: string; name: string }[], count: string, bal: Amount | undefined, open: () => void, action: { label: string; icon: typeof Plus; on: () => void }, below?: React.ReactNode) => (
    <div key={key} style={{ position: 'relative', marginBottom: 12 }}>
      <Card T={T} onClick={() => { haptic(8); open() }} ariaLabel={`Open ${title}`} style={{ padding: 16, borderRadius: 24 }}>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 96 }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          {people.length ? <Faces people={people} /> : <Users size={16} color={T.txt3} />}
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: T.txt2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{count}</span>
          {bal !== undefined && <Standing T={T} a={bal} />}
          <ChevronRight size={18} color={T.txt3} />
        </div>
        {below}
      </Card>
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <Btn size="sm" icon={action.icon} onClick={() => { haptic(8); action.on() }}>{action.label}</Btn>
      </div>
    </div>
  )
  return (
    <>
      {c.groups.map((g) => {
        const people = c.members.filter((m) => m.flat_id === g.id && !m.left_at)
        const waiting = people.filter(isPending).length
        return card(g.id, g.name, people.map((m) => ({ id: m.user_id, name: m.display_name })),
          `${people.length} ${people.length === 1 ? 'person' : 'people'}${waiting ? ` · ${waiting} invited` : ''}`,
          myBalance(c.books, c.uid, g.id), () => c.openGroup(g.id), { label: 'Invite', icon: UserPlus, on: () => c.invite(g.id) },
          <>{c.chores && <ChoreCardLine c={c.chores} flatId={g.id} />}{c.bills && <NextBillLine b={c.bills} flatId={g.id} />}</>)
      })}
      {card('nongroup', 'Non-group expenses', friends.map((f) => ({ id: f.userId, name: f.name })),
        friends.length ? `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}` : 'Split anything with anyone',
        friends.length ? ng || { currency: c.main, minor: 0 } : undefined, () => c.openPage('nongroup'), { label: 'Add', icon: Plus, on: () => c.addWith([]) })}
      {c.bills && <MyBillsCard b={c.bills} open={() => c.openPage('mybills')} />}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <Btn size="md" kind="secondary" icon={Plus} disabled={!c.uid} onClick={c.newGroup} style={{ flex: 1 }}>New group</Btn>
        <Btn size="md" kind="secondary" icon={KeyRound} disabled={!c.uid} onClick={c.join} style={{ flex: 1 }}>Join with code</Btn>
      </div>
    </>
  )
}

/* ------------------------------------------------------- finding someone */

export function PersonSearch({ c, query, setQuery, pick, placeholder = 'Add an expense with… name or email', exclude = [], autoFocus }: {
  c: FriendsCtx; query: string; setQuery: (q: string) => void; pick: (p: PersonPick) => void; placeholder?: string; exclude?: string[]; autoFocus?: boolean
}) {
  const { T } = c
  const [looked, setLooked] = useState<{ email: string; onHeimat: boolean; name: string | null } | null>(null)
  const [looking, setLooking] = useState(false)
  const [newName, setNewName] = useState('')
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // a sheet slides in, and focus asked for while it moves is dropped — so ask once it has landed
  useEffect(() => { if (!autoFocus) return; const t = setTimeout(() => input.current?.focus(), 320); return () => clearTimeout(t) }, [])
  const q = query.trim()
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q) ? q.toLowerCase() : null
  useEffect(() => { setLooked(null); setNewName('') }, [email])
  const matches = q ? knownPeople(c.members, c.uid).filter((k) => !exclude.includes(k.userId) && (k.name.toLowerCase().includes(q.toLowerCase()) || (k.email || '').includes(q.toLowerCase()))).slice(0, 6) : []
  const row = (key: string, lead: ReactNode, title: string, sub: string | null, on: () => void, disabled?: boolean) => (
    <button key={key} type="button" className="h-item" disabled={disabled} onClick={() => { haptic(6); on() }} style={{ '--inset': '58px', minHeight: 50 } as CSSProperties}>
      {lead}
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 15 }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 12, color: T.txt3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
      </span>
    </button>
  )
  const ic = (I: typeof Mail) => <span style={{ width: 30, display: 'flex', justifyContent: 'center', color: T.acc }}><I size={19} /></span>
  return (
    <div className="glass" style={{ borderRadius: 20, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 14px' }}>
        <Search size={18} color={T.txt3} />
        <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email"
          style={{ flex: 1, border: 'none', background: 'none', outline: 'none', color: T.txt, fontSize: 16, padding: '11px 0' }} />
        {query && <button type="button" aria-label="Clear" onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: T.txt3, cursor: 'pointer', display: 'flex' }}><X size={17} /></button>}
      </div>
      {(q || focused) && (
        <div style={{ borderTop: `1px solid ${T.border}` }}>
          {matches.map((k) => row(k.userId, <Avatar name={k.name} seed={k.userId} size={30} />, k.name, k.pending ? (k.email ? `invited · ${k.email}` : 'invited') : null, () => pick({ userId: k.userId, name: k.name })))}
          {email && !matches.some((k) => k.email === email) && (looked && looked.email === email ? (
            looked.onHeimat
              ? row('found', <Avatar name={looked.name || email} seed={email} size={30} />, looked.name || email, `on Splitlife · ${email}`, () => pick({ email, name: looked.name || email }))
              : (
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ fontSize: 13, color: T.txt2, marginBottom: 8 }}>{email} isn't on Splitlife yet — they'll get an email with the expense.</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="fld" style={{ flex: 1 }} placeholder="Their name" aria-label="Their name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    <Btn size="md" onClick={() => pick({ email, name: newName.trim() || email.split('@')[0] })}>Add</Btn>
                  </div>
                </div>
              )
          ) : row('mail', ic(Mail), looking ? `Looking up ${email}…` : `Add ${email}`, null, async () => {
            setLooking(true)
            const r = await findPerson(email)
            setLooking(false)
            if (typeof r === 'string') c.showToast(r); else setLooked({ email, ...r })
          }, looking))}
          {q && !email && !matches.length && row('link', ic(Link2), `Add “${q}” and send them a link`, 'For someone without an email — share the link however you like', () => pick({ name: q }))}
        </div>
      )}
    </div>
  )
}

/* "With you and": people, or one of your groups */
export function WithPicker({ c, open, onClose, group, people: initial, groupsAllowed, done }: {
  c: FriendsCtx; open: boolean; onClose: () => void; group: string | null; people: PersonPick[]; groupsAllowed: boolean
  done: (choice: { group: string } | { people: PersonPick[] }) => void
}) {
  const { T } = c
  const [people, setPeople] = useState<PersonPick[]>(initial)
  const [query, setQuery] = useState('')
  useEffect(() => { if (open) { setPeople(initial); setQuery('') } }, [open])
  return (
    <Sheet open={open} onClose={onClose} title="With you and" T={T}
      footer={<Btn full disabled={!people.length} onClick={() => done({ people })}>Done</Btn>}>
      {people.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
          {people.map((p) => (
            <button key={p.userId || p.email || p.name} type="button" className="chip" aria-label={`Remove ${p.name}`} onClick={() => setPeople(people.filter((x) => x !== p))} style={{ background: T.accSoft, color: T.acc }}>
              <X size={13} /> {p.name}
            </button>
          ))}
        </div>
      )}
      <PersonSearch c={c} query={query} setQuery={setQuery} placeholder="Name or email" autoFocus exclude={people.map((p) => p.userId || '')}
        pick={(p) => { if (!people.some((x) => (x.userId && x.userId === p.userId) || (x.email && x.email === p.email))) setPeople([...people, p]); setQuery('') }} />
      {!people.length && !query && groupsAllowed && c.groups.length > 0 && (
        <>
          <SectionLabel T={T}>Or one of your groups</SectionLabel>
          <div className="glass" style={{ borderRadius: 20, overflow: 'hidden' }}>
            {c.groups.map((g) => (
              <button key={g.id} type="button" className="h-item" onClick={() => done({ group: g.id })} style={{ '--inset': '58px' } as CSSProperties}>
                <span style={{ width: 30, display: 'flex', justifyContent: 'center', color: T.acc }}><Users size={19} /></span>
                <span style={{ flex: 1, textAlign: 'left' }}>{g.name}</span>
                {g.id === group && <span style={{ color: T.acc, fontWeight: 700 }}>✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------ Non-group expenses */

export function NonGroupPage({ c, onBack }: { c: FriendsCtx; onBack: () => void }) {
  const { T } = c
  const [query, setQuery] = useState('')
  const [showSquare, setShowSquare] = useState(false)
  const friends = useMemo(() => friendLines(c.circles, c.members, c.books, c.uid, c.main), [c.circles, c.members, c.books, c.uid, c.main])
  const all = totals(friends.flatMap((f) => linesWith(c.books, c.uid, f.userId, c.circles.map((x) => x.id))), c.main)
  const open = friends.filter((f) => f.amounts.length), square = friends.filter((f) => !f.amounts.length)
  const row = (f: (typeof friends)[number]) => (
    <button key={f.userId} type="button" className="h-item" onClick={() => c.openPage(`person:${f.userId}`)} style={{ '--inset': '66px' } as CSSProperties}>
      <Avatar name={f.name} seed={f.userId} size={38} />
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 15.5 }}>{f.name}</span>
        {f.pending && <span style={{ display: 'block', fontSize: 12, color: T.txt3 }}>invited</span>}
      </span>
      {f.amounts.length ? (
        <span style={{ textAlign: 'right' }}>
          <Standing T={T} a={f.amounts[0]} person />
          {f.amounts.slice(1).map((a) => <span key={a.currency} style={{ display: 'block', fontSize: 11.5, color: T.txt3 }}>{a.minor > 0 ? '+' : '−'}{fmt(a)}</span>)}
        </span>
      ) : <span style={{ fontSize: 12.5, color: T.txt3 }}>settled up</span>}
    </button>
  )
  return (
    <Page T={T} title="Non-group expenses" onBack={onBack}>
      <PersonSearch c={c} query={query} setQuery={setQuery} pick={(p) => { setQuery(''); c.addWith([p]) }} />
      {!query && (friends.length === 0 ? (
        <Card T={T} style={{ borderRadius: 24 }}>
          <EmptyState T={T} icon={Users} title="Split anything with anyone" body="A dinner, a taxi, concert tickets. Search a friend by name or email above — they don't need Splitlife yet." />
        </Card>
      ) : (
        <>
          <div style={{ margin: '4px 6px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 650, color: T.txt2 }}>With friends</div>
            {all[0] ? <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1, color: all[0].minor > 0 ? T.green : T.red, fontVariantNumeric: 'tabular-nums' }}>{all[0].minor > 0 ? '+' : '−'}{fmt(all[0])}</div>
              : <div style={{ fontSize: 22, fontWeight: 800 }}>All square</div>}
            {all.slice(1).map((a) => <div key={a.currency} style={{ fontSize: 13, color: T.txt2, fontWeight: 600 }}>{a.minor > 0 ? '+' : '−'}{fmt(a)}</div>)}
          </div>
          <div className="glass" style={{ borderRadius: 24, overflow: 'hidden' }}>
            {open.map(row)}
            {square.length > 0 && (showSquare ? square.map(row) : (
              <button type="button" className="h-item" onClick={() => setShowSquare(true)}>
                <span style={{ flex: 1, textAlign: 'left', color: T.txt2, fontSize: 14 }}>{square.length} more, all square</span><ChevronDown size={17} color={T.txt3} />
              </button>
            ))}
          </div>
        </>
      ))}
    </Page>
  )
}

/* ------------------------------------------------------------ one person */

export function PersonPage({ c, person, onBack }: { c: FriendsCtx; person: string; onBack: () => void }) {
  const { T } = c
  const name = personName(c.members, person)
  const lines = useMemo(() => linesWith(c.books, c.uid, person), [c.books, c.uid, person])
  const tot = totals(lines, c.main)
  const main = tot[0]
  const shared = useMemo(() => sharedExpenses(c.expenses, c.uid, person), [c.expenses, c.uid, person])
  const pending = !c.members.some((m) => m.user_id === person && m.claimed_at)
  const link = c.members.find((m) => m.user_id === person && !m.claimed_at && !m.invite_email && m.invite_token)?.invite_token
  const isCircle = (id: string) => c.circles.some((x) => x.id === id)
  const nameOf = (u: string) => (u === c.uid ? 'You' : personName(c.members, u))
  // Non-group expenses as one line per currency; each group as its own
  const rows = useMemo(() => {
    const out: { key: string; place: string | null; label: string; currency: string; minor: number }[] = []
    for (const l of lines) {
      const circle = isCircle(l.place)
      const key = (circle ? '\u0000friends' : l.place) + '\u0000' + l.currency
      const had = out.find((r) => r.key === key)
      if (had) had.minor += l.minor
      else out.push({ key, place: circle ? null : l.place, label: circle ? 'Non-group expenses' : (c.groups.find((g) => g.id === l.place)?.name || ''), currency: l.currency, minor: l.minor })
    }
    return out.filter((r) => r.minor).sort((a, b) => Math.abs(b.minor) - Math.abs(a.minor) || (a.key < b.key ? -1 : 1))
  }, [lines, c.circles, c.groups])
  const sendLink = async () => {
    if (!link) return
    const url = `${webOrigin()}invite.html?t=${encodeURIComponent(link)}`
    const msg = `I added what we split on Splitlife — open this to see it and join: ${url}`
    if (await shareText(msg)) return
    if (await copyText(url)) c.showToast('Link copied')
  }
  return (
    <Page T={T} title={name} onBack={onBack}>
      <Card T={T} grad style={{ borderRadius: 28, padding: 18, textAlign: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}><Avatar name={name} seed={person} size={56} /></div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>{name}</div>
        {pending && <div style={{ fontSize: 12.5, color: T.txt2 }}>invited — not on Splitlife yet</div>}
        {main ? (
          <>
            <div style={{ fontSize: 13, color: T.txt2, marginTop: 6 }}>{main.minor > 0 ? 'owes you' : 'you owe'}</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1.2, color: main.minor > 0 ? T.green : T.red, fontVariantNumeric: 'tabular-nums' }}>{fmt(main)}</div>
            {tot.slice(1).map((a) => <div key={a.currency} style={{ fontSize: 13, color: T.txt2 }}>{a.minor > 0 ? 'and owes you ' : 'and you owe '}{fmt(a)}</div>)}
          </>
        ) : <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>All square</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Btn size="md" icon={ArrowRightLeft} disabled={!main} onClick={() => c.settlePerson(person)} style={{ flex: 1 }}>Settle up</Btn>
          {(main?.minor || 0) > 0 && <Btn size="md" kind="secondary" icon={Bell} onClick={() => c.remindPerson(person)} style={{ flex: 1 }}>Remind</Btn>}
        </div>
      </Card>
      {link && <Btn full icon={Share2} onClick={sendLink} style={{ marginBottom: 14 }}>Send {name} their link</Btn>}
      {rows.length > 0 && (
        <>
          <SectionLabel T={T}>Where it comes from</SectionLabel>
          <div className="glass" style={{ borderRadius: 24, overflow: 'hidden', marginBottom: 14 }}>
            {rows.map((r) => (
              <button key={r.key} type="button" className="h-item" onClick={() => (r.place ? c.openGroup(r.place) : c.openPage('nongroup'))}>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                <span style={{ fontWeight: 650, fontSize: 14, color: r.minor > 0 ? T.green : T.red, fontVariantNumeric: 'tabular-nums' }}>{r.minor > 0 ? 'owes you ' : 'you owe '}{fmt({ currency: r.currency, minor: r.minor })}</span>
                <ChevronRight size={17} color={T.txt3} />
              </button>
            ))}
          </div>
        </>
      )}
      <Btn full kind="secondary" icon={Plus} onClick={() => c.addWith([{ userId: person, name }])} style={{ marginBottom: 14 }}>Add an expense with {name}</Btn>
      {shared.length > 0 && (
        <>
          <SectionLabel T={T}>Shared expenses</SectionLabel>
          <div className="glass" style={{ borderRadius: 24, overflow: 'hidden' }}>
            {shared.slice(0, 40).map((e) => <ExpenseRow key={e.id} T={T} e={e} cats={c.cats} uid={c.uid} nameOf={nameOf} onClick={() => c.openExpense(e)} />)}
          </div>
        </>
      )}
    </Page>
  )
}

/* ------------------------------------------------- settling up with a person */

export function PersonSettle({ c, open, person, onClose, record }: {
  c: FriendsCtx; open: boolean; person: string | null; onClose: () => void
  record: (person: string, lines: PlaceLine[], currency: string, pay: number, iPay: boolean, pair: string | null) => void
}) {
  const { T } = c
  const lines = useMemo(() => (person ? linesWith(c.books, c.uid, person) : []), [c.books, c.uid, person])
  const tot = totals(lines, c.main)
  const [cur, setCur] = useState('')
  const [iPay, setIPay] = useState(true)
  const [amt, setAmt] = useState('')
  const seeded = useRef(false)
  const reset = (currency: string) => {
    const net = tot.find((t) => t.currency === currency)?.minor || 0
    setIPay(net <= 0)
    setAmt(net ? minorToInput(Math.abs(net), currency) : '')
  }
  useEffect(() => { if (open && person) { const first = tot[0]?.currency || c.hostCur; setCur(first); reset(first); seeded.current = true } else seeded.current = false }, [open, person])
  if (!person) return null
  const name = personName(c.members, person)
  const currency = cur || tot[0]?.currency || c.hostCur
  const net = tot.find((t) => t.currency === currency)?.minor || 0
  const pay = parseMinor(amt, currency) || 0
  const pair = pairCircle(c.circles, c.members, c.uid, person)
  const parts = pay > 0 ? settleParts(lines, currency, pay, iPay, pair) : []
  const isCircle = (id: string) => id === PAIR || c.circles.some((x) => x.id === id)
  const shown: { key: string; label: string; minor: number; reverse: boolean }[] = []
  for (const p of parts) {
    const circle = isCircle(p.place)
    const key = (circle ? '\u0000friends' : p.place) + (p.reverse ? '<' : '>')
    const had = shown.find((r) => r.key === key)
    if (had) had.minor += p.minor
    else shown.push({ key, label: circle ? 'Non-group expenses' : c.groups.find((g) => g.id === p.place)?.name || '', minor: p.minor, reverse: p.reverse })
  }
  shown.sort((a, b) => b.minor - a.minor)
  const full = net !== 0 && (iPay ? -net : net) > 0 && pay >= Math.abs(net)
  const m = (v: number) => money(toMajor(v, currency), currency)
  return (
    <Sheet open={open} onClose={onClose} title={`Settle up with ${name}`} T={T}
      footer={<Btn full disabled={pay <= 0} onClick={() => { record(person, lines, currency, pay, iPay, pair); onClose() }}>{pay > 0 ? `Record ${m(pay)}` : 'Record payment'}</Btn>}>
      {tot.length > 1 && (
        <Field T={T} label="Currency">
          <SegmentedControl T={T} label="Currency" options={tot.map((t) => [t.currency, t.currency] as [string, string])} value={currency} onChange={(v) => { setCur(v); reset(v) }} />
        </Field>
      )}
      <Field T={T} label="Who paid" hint={net ? (net > 0 ? `${name} owes you ${m(net)} in all.` : `You owe ${name} ${m(-net)} in all.`) : undefined}>
        <SegmentedControl T={T} label="Who paid" options={[['me', `You paid ${name}`], ['them', `${name} paid you`]]} value={iPay ? 'me' : 'them'} onChange={(v) => setIPay(v === 'me')} />
      </Field>
      <Field T={T} label={`Amount (${currency})`} htmlFor="sp-amt">
        <input id="sp-amt" className="fld fld-big" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="0,00" />
      </Field>
      {shown.length > 0 && (
        <Field T={T} label="Recorded as" hint={full ? `This squares you up with ${name} everywhere you share money${pay > Math.abs(net) ? ' — the extra is noted under non-group expenses.' : '.'}` : "Spread over the places you owe each other in, the largest first, so each one's own balances stay right."} style={{ marginBottom: 4 }}>
          <div className="h-well">
            {shown.map((r) => (
              <div key={r.key} className="h-item" style={{ minHeight: 48 }}>
                <span style={{ flex: 1 }}>{r.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: r.reverse ? T.txt3 : T.txt }}>{r.reverse ? 'evened out ' : ''}{m(r.minor)}</span>
              </div>
            ))}
          </div>
        </Field>
      )}
    </Sheet>
  )
}

