/*
  Test groups for the server's who-owes-whom (my_pairwise in
  supabase/migrations/20261002040000_splitlife_feed.sql): random bills — several payers,
  odd cents, every split type the engine has — and payments, with what the web engine
  (buildLedger + pairwiseFor, the person page's figures) says each pair owes.
  node tests/make-pairwise-vectors.ts > tests/pairwise-vectors.json
*/
import { buildLedger, pairwiseFor } from '../src/lib/ledger.ts'

let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(rnd() * 16).toString(16))

const groups = []
for (let g = 0; g < 6; g++) {
  const people = Array.from({ length: 2 + Math.floor(rnd() * 4) }, uuid)
  const expenses: any[] = [], settles: any[] = []
  for (let i = 0; i < 6 + Math.floor(rnd() * 6); i++) {
    const amount = Math.round((1 + rnd() * 120) * 100) / 100
    const among = people.filter(() => rnd() < 0.75)
    if (!among.length) among.push(people[0])
    const several = rnd() < 0.45 && people.length > 2
    let payers: Record<string, number> | null = null, paid_by = pick(people)
    if (several) {
      const a = people[0], b = people[1], cents = Math.round(amount * 100), first = Math.floor(cents * (0.2 + rnd() * 0.6))
      payers = { [a]: first, [b]: cents - first }; paid_by = first >= cents - first ? a : b
    }
    expenses.push({ id: uuid(), flat_id: 'g', description: 'x', amount, currency: rnd() < 0.15 ? 'CHF' : 'EUR', paid_by, payers, split_among: among,
      split_type: 'equal', split: null, shares: null, category: 'other', spent_on: '2026-09-01', created_by: people[0] })
  }
  for (let i = 0; i < Math.floor(rnd() * 4); i++) {
    const [f, t] = [pick(people), pick(people)]
    if (f !== t) settles.push({ id: uuid(), flat_id: 'g', from_user: f, to_user: t, amount: Math.round(rnd() * 3000) / 100, currency: 'EUR', settled_on: '2026-09-02' })
  }
  const l = buildLedger(expenses, settles, 'EUR')
  const expect: Record<string, Record<string, Record<string, number>>> = {}
  for (const [cur, book] of l.books) for (const u of people) {
    for (const [o, m] of pairwiseFor(book.owes, u)) if (m) ((expect[u] ||= {})[cur] ||= {})[o] = m
  }
  groups.push({ people, expenses, settles, expect })
}
console.log(JSON.stringify(groups))
