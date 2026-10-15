/* Demo mode: `npm run build:demo` (VITE_DEMO=1). The app talks to a pretend
   Supabase that lives in memory, filled with the same made-up flat, friends,
   bills and chores as the iPhone app's demo (ios-native/Heimat/Fixture.swift).
   Every screen and button works — adding, editing, ticking — but nothing ever
   leaves the device: opening the real app root would sign in anonymously
   against production and create a real account. Reloading starts over.

   Only the parts of the supabase-js API the app uses are here: from(table)
   with select / insert / update / upsert / delete and eq / neq / in / is /
   gte / lte / order / limit / maybeSingle / single, rpc(name), auth, and
   realtime channels that never fire. */

type Row = Record<string, any>
type Result = { data: any; error: { message: string } | null }

const ME = '00000000-0000-4000-a000-000000000001'
const NINA = '00000000-0000-4000-a000-000000000002', TOM = '00000000-0000-4000-a000-000000000003'
const SARA = '00000000-0000-4000-a000-000000000004', ALEX = '00000000-0000-4000-a000-000000000005'
const BEN = '00000000-0000-4000-a000-000000000006', DANA = '00000000-0000-4000-a000-000000000007'
const KAI = '00000000-0000-4000-a000-000000000008', VI = '00000000-0000-4000-a000-000000000009'
const FLAT = '10000000-0000-4000-a000-000000000001', MEEVI = '10000000-0000-4000-a000-000000000002'
const C_NINA = '20000000-0000-4000-a000-000000000001', C_TRIO = '20000000-0000-4000-a000-000000000002'
const C_SARA = '20000000-0000-4000-a000-000000000003', C_TOM = '20000000-0000-4000-a000-000000000004'
const NOW = '2026-09-01T10:00:00Z'

const uuid = () => 'd' + crypto.randomUUID().slice(1)
const stamp = () => new Date().toISOString()

function seed(): Record<string, Row[]> {
  let n = 0
  const mem = (flat: string, user: string, name: string, pending?: string): Row => ({
    id: `m${++n}`, flat_id: flat, user_id: user, display_name: name, left_at: null,
    claimed_at: pending ? null : NOW, invite_email: pending || null, invite_token: pending ? `tok${n}` : null,
  })
  const ex = (id: string, flat: string, d: string, amount: number, by: string, among: string[], day: string, category = 'food', extra: Row = {}): Row => ({
    id: '30000000-0000-4000-a000-0000000000' + id, flat_id: flat, description: d, amount, currency: 'EUR', paid_by: by,
    split_among: among, category, spent_on: day, created_by: by, created_at: day + 'T12:00:00Z',
    split_type: 'equal', split: null, payers: null, deleted_at: null, ...extra,
  })
  const flat6 = [ME, ALEX, BEN, DANA, KAI, NINA]
  const turn = (c: string, nn: number, s: string, e: string, who: string, state = 'open', by: string | null = null, pts: number | null = null): Row => ({
    chore_id: c, n: nn, flat_id: FLAT, starts_on: s, ends_on: e, assignee: who, state, done_by: by, done_at: by ? new Date().toISOString().slice(0, 10) + 'T08:00:00Z' : null, points: pts,
  })
  const act = (id: string, flat: string, by: string | null, kind: string, subject: string | null, at: string, amount: number | null = null, meta: Row = {}): Row => ({
    id: '40000000-0000-4000-a000-0000000000' + id, flat_id: flat, actor: by, kind, subject, amount, at, meta,
  })
  return {
    flats: [
      { id: FLAT, name: 'Sunny WG', join_code: 'DD325F', kind: 'flat', simplify_debts: false, created_at: '2026-01-01T00:00:00Z' },
      { id: MEEVI, name: 'Lisbon trip', join_code: '7KQ2PA', kind: 'group', simplify_debts: false, created_at: '2026-02-01T00:00:00Z' },
      ...[C_NINA, C_TRIO, C_SARA, C_TOM].map((id, i) => ({ id, name: '', join_code: '', kind: 'direct', simplify_debts: false, created_at: `2026-03-0${i + 1}T00:00:00Z` })),
    ],
    flat_members: [
      mem(FLAT, ME, 'Priya Nair'), mem(FLAT, ALEX, 'Alex'), mem(FLAT, BEN, 'Ben'), mem(FLAT, DANA, 'Dana Schulz'),
      mem(FLAT, KAI, 'Kai'), mem(FLAT, NINA, 'Nina'),
      mem(MEEVI, ME, 'Priya Nair'), mem(MEEVI, VI, 'Vi'),
      mem(C_NINA, ME, 'Priya Nair'), mem(C_NINA, NINA, 'Nina'),
      mem(C_TRIO, ME, 'Priya Nair'), mem(C_TRIO, NINA, 'Nina'), mem(C_TRIO, TOM, 'Tom'),
      mem(C_SARA, ME, 'Priya Nair'), mem(C_SARA, SARA, 'Sara', 'sara@example.com'),
      mem(C_TOM, ME, 'Priya Nair'), mem(C_TOM, TOM, 'Tom'),
    ],
    expenses: [
      ex('01', C_NINA, 'Dinner at Thai Park', 30, ME, [ME, NINA], '2026-09-28'),
      ex('02', C_NINA, 'Cinema', 18, NINA, [ME, NINA], '2026-09-20', 'fun'),
      ex('03', C_TRIO, 'Taxi to the airport', 42, ME, [ME, NINA, TOM], '2026-09-25', 'transport'),
      ex('04', C_SARA, 'Concert tickets', 10.8, ME, [ME, SARA], '2026-09-22', 'fun'),
      ex('05', C_TOM, 'Lunch', 8.4, TOM, [ME, TOM], '2026-09-26'),
      ex('06', FLAT, 'Rewe groceries', 64.2, ALEX, flat6, '2026-09-27', 'groceries'),
      ex('07', FLAT, 'Internet', 39.99, ME, flat6, '2026-09-01', 'utilities'),
      ex('08', MEEVI, 'Ikea', 80, VI, [ME, VI], '2026-08-30', 'home'),
      ex('09', MEEVI, 'Pizza', 22, ME, [ME, VI], '2026-08-30'),
      // a split that isn't even, and one between only some of the flat
      ex('10', FLAT, 'Pizza night', 30, ME, [ME, ALEX, BEN], '2026-09-29', 'food', { split_type: 'percent', split: { values: { [ME]: 5000, [ALEX]: 3000, [BEN]: 2000 } } }),
      ex('11', FLAT, 'Drinks', 12, NINA, [ME, NINA], '2026-09-29'),
    ],
    settlements: [{ id: 's1', flat_id: MEEVI, from_user: ME, to_user: VI, amount: 29, currency: 'EUR', created_by: ME, settled_on: '2026-09-02' }],
    flat_items: [
      { id: 'i1', flat_id: FLAT, title: 'Oat milk', category: 'groceries', added_by: NINA, bought: true, bought_by: NINA, bought_at: '2026-10-07T12:40:00Z', created_at: '2026-10-05T10:00:00Z' },
      { id: 'i2', flat_id: FLAT, title: 'Dish soap', category: 'household', added_by: DANA, bought: false, bought_by: null, bought_at: null, created_at: '2026-09-27T16:00:00Z' },
      { id: 'i3', flat_id: FLAT, title: 'Toilet paper', category: 'household', added_by: ME, bought: false, bought_by: null, bought_at: null, created_at: '2026-10-01T09:00:00Z' },
    ],
    flat_categories: [],
    bills: [
      { id: 'b1', flat_id: FLAT, owner_id: null, name: 'Rent', amount: 2340, currency: 'EUR', category: 'bills', cadence: 'monthly', anchor_on: '2026-01-01', payer: ALEX, contract_ends_on: null, notice_amount: null, notice_unit: null, archived_at: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 'b2', flat_id: FLAT, owner_id: null, name: 'Electricity', amount: null, currency: 'EUR', category: 'bills', cadence: 'monthly', anchor_on: '2026-01-15', payer: ME, contract_ends_on: null, notice_amount: null, notice_unit: null, archived_at: null, created_at: '2026-01-02T00:00:00Z' },
      { id: 'b3', flat_id: FLAT, owner_id: null, name: 'Internet', amount: 39.99, currency: 'EUR', category: 'bills', cadence: 'monthly', anchor_on: '2026-01-12', payer: ME, contract_ends_on: '2026-12-31', notice_amount: 1, notice_unit: 'month', archived_at: null, created_at: '2026-01-03T00:00:00Z' },
      { id: 'b4', flat_id: null, owner_id: ME, name: 'Phone', amount: 20, currency: 'EUR', category: 'bills', cadence: 'monthly', anchor_on: '2026-01-03', payer: ME, contract_ends_on: null, notice_amount: null, notice_unit: null, archived_at: null, created_at: '2026-01-04T00:00:00Z' },
      { id: 'b5', flat_id: null, owner_id: ME, name: 'Gym', amount: 29.9, currency: 'EUR', category: 'bills', cadence: 'monthly', anchor_on: '2026-01-28', payer: ME, contract_ends_on: null, notice_amount: null, notice_unit: null, archived_at: null, created_at: '2026-01-05T00:00:00Z' },
    ],
    bill_status: [
      { bill_id: 'b1', due_on: '2026-10-01', state: 'due', paid_on: '2026-09-01', paid_by: ALEX, cancel_by: null },
      { bill_id: 'b2', due_on: '2026-09-15', state: 'overdue', paid_on: null, paid_by: null, cancel_by: null },
      { bill_id: 'b3', due_on: '2026-10-12', state: 'upcoming', paid_on: '2026-09-12', paid_by: ME, cancel_by: '2026-11-30' },
      { bill_id: 'b4', due_on: '2026-10-03', state: 'upcoming', paid_on: null, paid_by: null, cancel_by: null },
      { bill_id: 'b5', due_on: '2026-10-28', state: 'paid', paid_on: '2026-09-28', paid_by: ME, cancel_by: null },
    ],
    chores: [
      { id: 'c1', flat_id: FLAT, name: 'Bathroom', cadence: 'weekly', anchor_on: '2026-09-07', points: 3, rota: flat6, archived_at: null, created_at: '2026-09-01T00:00:00Z' },
      { id: 'c2', flat_id: FLAT, name: 'Kitchen', cadence: 'weekly', anchor_on: '2026-09-07', points: 2, rota: flat6, archived_at: null, created_at: '2026-09-01T00:00:01Z' },
      { id: 'c3', flat_id: FLAT, name: 'Trash', cadence: 'weekly', anchor_on: '2026-09-07', points: 1, rota: flat6, archived_at: null, created_at: '2026-09-01T00:00:02Z' },
      { id: 'c4', flat_id: FLAT, name: 'Vacuuming', cadence: 'biweekly', anchor_on: '2026-09-21', points: 2, rota: flat6, archived_at: null, created_at: '2026-09-01T00:00:03Z' },
    ],
    chore_turns: [
      turn('c1', 3, '2026-09-28', '2026-10-04', ME), turn('c1', 4, '2026-10-05', '2026-10-11', ALEX),
      turn('c2', 3, '2026-09-28', '2026-10-04', NINA, 'done', NINA, 2), turn('c2', 4, '2026-10-05', '2026-10-11', ME),
      turn('c3', 3, '2026-09-28', '2026-10-04', BEN), turn('c3', 4, '2026-10-05', '2026-10-11', DANA),
      turn('c4', 0, '2026-09-21', '2026-10-04', DANA), turn('c4', 1, '2026-10-05', '2026-10-18', KAI),
    ],
    chore_swaps: [{ id: 'w1', chore_id: 'c4', n: 0, flat_id: FLAT, from_user: DANA, to_user: ME, answer: null }],
    activity: [
      act('01', FLAT, NINA, 'item_bought', 'Oat milk', '2026-10-07T12:40:00Z'),
      act('02', FLAT, ALEX, 'chore_done', 'Bins', '2026-10-07T09:15:00Z'),
      act('03', MEEVI, VI, 'bill_paid', 'Internet', '2026-10-06T18:02:00Z', 39.99),
      act('04', FLAT, BEN, 'swap_asked', 'Bathroom', '2026-10-06T08:30:00Z', null, { to: ME }),
      act('05', FLAT, ME, 'expense_added', 'Pizza night', '2026-09-29T19:20:00Z', 30),
      act('06', FLAT, NINA, 'expense_added', 'Drinks', '2026-09-29T21:05:00Z', 12),
      act('07', C_NINA, ME, 'expense_added', 'Dinner at Thai Park', '2026-09-28T20:00:00Z', 30),
      act('08', C_NINA, ME, 'joined', 'Nina', '2026-09-01T10:00:00Z'),
      act('09', FLAT, DANA, 'item_added', 'Dish soap', '2026-09-27T16:00:00Z'),
    ],
    app_users: [{ user_id: ME, app: 'heimat', display_name: 'Priya Nair' }],
  }
}

/* filled when a demo build starts (demoClient), so a normal build carries none of it */
let db: Record<string, Row[]> = {}
const log = (kind: string, subject: string | null, flat: string, amount: number | null = null, meta: Row = {}) =>
  db.activity.unshift({ id: uuid(), flat_id: flat, actor: ME, kind, subject, amount, at: stamp(), meta })

/* ---- queries ---- */

type Filter = (r: Row) => boolean
class Query implements PromiseLike<Result> {
  private filters: Filter[] = []
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private payload: Row | Row[] | null = null
  private sort: { col: string; asc: boolean }[] = []
  private max: number | null = null
  private one: 'maybe' | 'one' | null = null
  private returning = false
  constructor(private table: string) {}

  select(_cols?: string) { if (this.op !== 'select') this.returning = true; return this }
  insert(v: Row | Row[]) { this.op = 'insert'; this.payload = v; return this }
  upsert(v: Row | Row[]) { this.op = 'upsert'; this.payload = v; return this }
  update(v: Row) { this.op = 'update'; this.payload = v; return this }
  delete() { this.op = 'delete'; return this }
  eq(c: string, v: any) { this.filters.push((r) => String(r[c]) === String(v)); return this }
  neq(c: string, v: any) { this.filters.push((r) => String(r[c]) !== String(v)); return this }
  in(c: string, vs: any[]) { const s = new Set(vs.map(String)); this.filters.push((r) => s.has(String(r[c]))); return this }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return this }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) <= String(v)); return this }
  gt(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) > String(v)); return this }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) < String(v)); return this }
  order(col: string, o?: { ascending?: boolean }) { this.sort.push({ col, asc: o?.ascending !== false }); return this }
  limit(n: number) { this.max = n; return this }
  maybeSingle() { this.one = 'maybe'; return this }
  single() { this.one = 'one'; return this }

  private run(): Result {
    const rows = (db[this.table] ||= [])
    const hit = (r: Row) => this.filters.every((f) => f(r))
    let out: Row[] = []
    if (this.op === 'select') out = rows.filter(hit)
    else if (this.op === 'insert' || this.op === 'upsert') {
      for (const v of Array.isArray(this.payload) ? this.payload : [this.payload!]) {
        const row = { id: uuid(), created_at: stamp(), ...v }
        const at = this.op === 'upsert' ? rows.findIndex((r) => (row.user_id && r.user_id === row.user_id && r.app === row.app) || r.id === row.id) : -1
        if (at >= 0) rows[at] = { ...rows[at], ...v }; else rows.push(row)
        out.push(at >= 0 ? rows[at] : row)
        if (this.table === 'expenses') log('expense_added', row.description, row.flat_id, row.amount)
      }
    } else if (this.op === 'update') {
      for (const r of rows.filter(hit)) { Object.assign(r, this.payload); out.push(r) }
    } else {
      const keep = rows.filter((r) => !hit(r)); out = rows.filter(hit); db[this.table] = keep
    }
    for (const { col, asc } of [...this.sort].reverse()) out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
    if (this.max != null) out = out.slice(0, this.max)
    const copy = JSON.parse(JSON.stringify(out))
    if (this.one) return copy.length || this.one === 'maybe' ? { data: copy[0] ?? null, error: null } : { data: null, error: { message: 'no rows' } }
    return { data: this.op === 'select' || this.returning ? copy : null, error: null }
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, no)
  }
}

/* ---- server functions ---- */

const flatOf = (id: string) => db.flats.find((f) => f.id === id)
const rpcs: Record<string, (a: Row) => any> = {
  // a newer version, to see Home's Update card: localStorage 'demo-update' = '1'
  app_update: () => (localStorage.getItem('demo-update') ? { build: 16, url: 'https://example.com/splitlife-16.apk' } : null),
  my_bills: () => db.bill_status,
  my_chores: () => db.chore_turns,
  tick_bill: ({ p_bill, p_paid }) => {
    const s = db.bill_status.find((x) => x.bill_id === p_bill)
    const b = db.bills.find((x) => x.id === p_bill)
    // like my_bills: once paid, it shows the next due date
    const month = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10) }
    if (s) Object.assign(s, p_paid ? { state: 'paid', paid_on: s.due_on, paid_by: ME, due_on: month(s.due_on, 1) } : { state: 'due', due_on: s.paid_on || s.due_on, paid_on: null, paid_by: null })
    if (b?.flat_id) log(p_paid ? 'bill_paid' : 'bill_unpaid', b.name, b.flat_id, b.amount)
  },
  chore_tick: ({ p_chore, p_n, p_done }) => {
    const t = db.chore_turns.find((x) => x.chore_id === p_chore && x.n === p_n)
    const pts = db.chores.find((c) => c.id === p_chore)?.points ?? 1
    if (t) Object.assign(t, p_done ? { state: 'done', done_by: ME, done_at: stamp(), points: pts } : { state: 'open', done_by: null, done_at: null, points: null })
  },
  chore_skip: ({ p_chore, p_n }) => {
    const t = db.chore_turns.find((x) => x.chore_id === p_chore && x.n === p_n)
    if (t) t.state = 'missed'
  },
  chore_swap_ask: ({ p_chore, p_n, p_to }) => { db.chore_swaps.push({ id: uuid(), chore_id: p_chore, n: p_n, flat_id: FLAT, from_user: ME, to_user: p_to, answer: null }) },
  chore_swap_answer: (a) => {
    const s = db.chore_swaps.find((x) => x.id === (a.p_swap ?? a.p_id))
    if (!s) return
    s.answer = a.p_accept ?? a.p_yes ? 'yes' : 'no'
    const t = db.chore_turns.find((x) => x.chore_id === s.chore_id && x.n === s.n)
    if (t && s.answer === 'yes') t.assignee = s.to_user
  },
  set_simplify_debts: ({ p_flat, p_on }) => { const f = flatOf(p_flat); if (f) f.simplify_debts = p_on },
  delete_expense: ({ p_id }) => { db.expenses = db.expenses.filter((e) => e.id !== p_id) },
  create_group: ({ p_name }) => {
    const id = uuid()
    db.flats.push({ id, name: p_name, join_code: 'DEMO' + db.flats.length, kind: 'group', simplify_debts: false, created_at: stamp() })
    db.flat_members.push({ id: uuid(), flat_id: id, user_id: ME, display_name: 'Priya Nair', claimed_at: stamp(), left_at: null })
    return id
  },
  // a Splitwise import, as the server's import_group writes it (minus its checks)
  import_group: ({ p }) => {
    if ((db.imports ||= []).some((i) => i.hash === p.hash && i.flat_id)) throw new Error('import: already')
    const id = uuid(), ids: Record<string, string> = { [p.me]: ME }
    const dig = (cur: string) => (['JPY', 'KRW', 'VND', 'ISK', 'CLP', 'HUF'].includes(cur) ? 0 : 2)
    const flat = { id, name: p.name, join_code: 'DEMO' + db.flats.length, kind: p.kind, simplify_debts: false, created_at: stamp() }
    db.flats.push(flat)
    for (const pp of p.people) {
      if (pp.key !== p.me) ids[pp.key] = uuid()
      db.flat_members.push({ id: uuid(), flat_id: id, user_id: ids[pp.key], display_name: pp.name, left_at: null,
        claimed_at: pp.key === p.me ? stamp() : null, invite_email: null, invite_token: pp.key === p.me ? null : 'tok' + uuid().slice(0, 8) })
    }
    const map = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [ids[k], v]))
    for (const e of p.expenses) {
      const paid = map(e.paid), owed = map(e.owed)
      const payer = Object.entries(paid).sort((a, b) => b[1] - a[1])[0][0]
      db.expenses.push({ id: uuid(), flat_id: id, description: e.t, amount: e.total / 10 ** dig(e.cur), currency: e.cur, paid_by: payer,
        split_among: Object.keys(owed), category: e.c, spent_on: e.d, created_by: ME, created_at: stamp(), split_type: 'exact',
        split: { values: owed }, payers: Object.keys(paid).length > 1 ? paid : null, shares: owed, deleted_at: null })
    }
    for (const s of p.payments) (db.settlements ||= []).push({ id: uuid(), flat_id: id, from_user: ids[s.from], to_user: ids[s.to], amount: s.total / 10 ** dig(s.cur), currency: s.cur, settled_on: s.d, created_by: ME, created_at: stamp() })
    const imp = { id: uuid(), flat_id: id, source: p.source, hash: p.hash, expenses: p.expenses.length, payments: p.payments.length, created_at: stamp() }
    db.imports.push(imp)
    log('imported', ({ splitwise: 'Splitwise', tricount: 'Tricount', settleup: 'Settle Up', splid: 'Splid' } as Record<string, string>)[p.source] || 'a spreadsheet', id, null, { expenses: p.expenses.length, payments: p.payments.length })
    return { flat, import: imp.id }
  },
  remove_import: ({ p_import }) => {
    const imp = (db.imports ||= []).find((i) => i.id === p_import)
    if (!imp?.flat_id) throw new Error('import: gone')
    for (const t of ['expenses', 'settlements', 'flat_members', 'activity']) db[t] = (db[t] || []).filter((r) => r.flat_id !== imp.flat_id)
    db.flats = db.flats.filter((f) => f.id !== imp.flat_id)
    imp.flat_id = null
  },
  update_group: ({ p_flat, p_name, p_purpose }) => {
    const f = flatOf(p_flat)
    if (!f) throw new Error('Not your group')
    if (f.name !== p_name) log('renamed', p_name, p_flat, null, { was: f.name })
    Object.assign(f, { name: p_name, purpose: p_purpose ?? f.purpose })
    return f
  },
  rename_member: ({ p_flat, p_uid, p_name }) => {
    const m = db.flat_members.find((x) => x.flat_id === p_flat && x.user_id === p_uid)
    if (!m) throw new Error('Not in this group')
    if (p_uid !== ME && m.claimed_at) throw new Error('group: only they can change their name')
    m.display_name = p_name
  },
  remove_member: ({ p_flat, p_uid }) => { const m = db.flat_members.find((x) => x.flat_id === p_flat && x.user_id === p_uid); if (m) m.left_at = stamp() },
  delete_group: ({ p_flat }) => {
    for (const t of ['expenses', 'settlements', 'flat_members', 'activity']) db[t] = (db[t] || []).filter((r) => r.flat_id !== p_flat)
    db.flats = db.flats.filter((f) => f.id !== p_flat)
  },
  join_flat: () => { throw new Error('Demo mode — there is no group with that code') },
  leave_flat: ({ p_flat }) => { const m = db.flat_members.find((x) => x.flat_id === p_flat && x.user_id === ME); if (m) m.left_at = stamp() },
  save_friend_expense: ({ p_id, p_expense }) => { const e = db.expenses.find((x) => x.id === p_id); if (e) Object.assign(e, p_expense) },
  friend_circle: () => C_NINA,
  find_person: () => null,
  nudge: () => null,
  invite_member: () => null, revoke_invite: () => null, invite_back: () => null,
  claim_invite: () => null, decline_invite: () => null, invite_preview: () => null,
  save_push_device: () => null, forget_push_device: () => null,
}

/* ---- the client ---- */

const session = { user: { id: ME, is_anonymous: false, email: 'priya@example.com', new_email: null }, access_token: 'demo' }
const ok = (data: any = null): Promise<Result & Row> => Promise.resolve({ data, error: null })
const channel: any = { on: () => channel, subscribe: () => channel, unsubscribe: () => ok() }

export function demoClient(): any {
  db = seed()
  // ?new: a brand-new person — nothing set up, no groups — for looking at setup and Get started
  // (add &join=CODE to arrive from an invite link)
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('new')) {
    for (const k of Object.keys(db)) db[k] = []
    try {
      if (!sessionStorage.getItem('demo-new')) {
        sessionStorage.setItem('demo-new', '1')
        for (const k of ['mt-h-profile', 'mt-h-flatid', 'mt-h-shifts', 'mt-h-start-hidden']) localStorage.removeItem(k)
      }
    } catch {}
    return client()
  }
  // a first start: the demo person has answered the questions, lives in the flat and works two jobs
  try {
    if (!localStorage.getItem('mt-h-profile')) {
      localStorage.setItem('mt-h-profile', JSON.stringify({
        name: 'Priya Nair', homeCountry: 'India', homeCur: 'INR', homeIso: 'in', hostCountry: 'Germany', hostCur: 'EUR', hostIso: 'de',
        rate: 103.2, rateAt: '2026-10-01', onboarded: true, share: ['flatmates', 'friends'], doing: ['study', 'shifts'],
      }))
      localStorage.setItem('mt-h-flatid', JSON.stringify(FLAT))
      const month = new Date().toISOString().slice(0, 7)
      localStorage.setItem('mt-h-shifts', JSON.stringify([['01', 'Uni lab', 8], ['02', 'Uni lab', 8], ['05', 'Uni lab', 6], ['06', 'Café Mondo', 5], ['08', 'Uni lab', 8]].map(([d, emp, h], i) => ({
        id: `sh${i}`, date: `${month}-${d}`, employer: emp, start: '09:00', end: `${String(9 + (h as number)).padStart(2, '0')}:00`, breakMin: 0, paidBreak: false, wage: emp === 'Uni lab' ? 15.5 : 13.9,
      }))))
    }
  } catch {}
  return client()
}

function client(): any {
  return {
    auth: {
      getSession: () => ok({ session }),
      getUser: () => ok({ user: session.user }),
      signInAnonymously: () => ok({ session }),
      signInWithPassword: () => ok({ session }),
      signUp: () => ok({ session }),
      signOut: () => ok(),
      updateUser: () => ok({ user: session.user }),
      resetPasswordForEmail: () => ok(),
      verifyOtp: () => ok({ session }),
      exchangeCodeForSession: () => ok({ session }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (t: string) => new Query(t),
    rpc: (name: string, args: Row = {}) => {
      try { return ok(rpcs[name] ? JSON.parse(JSON.stringify(rpcs[name](args) ?? null)) : null) }
      catch (e: any) { return Promise.resolve({ data: null, error: { message: e?.message || 'demo' } }) }
    },
    channel: () => channel,
    removeChannel: () => ok(),
  }
}
