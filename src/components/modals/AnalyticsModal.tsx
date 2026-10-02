import { useMemo, useState } from 'react'
import type { Theme, Expense, Member, Cat } from '../../lib/types'
import { tod } from '../../lib/format'
import { catOf } from '../../lib/data'
import { colorOf, WORK } from '../../lib/theme'
import { inRange, monthlyTotals, byCategory, byMember, myShareTotal, total, monthNo, ymOf, type Range } from '../../lib/analytics'
import { Sheet, SegmentedControl, StatHero, SectionLabel, Card } from '../ui'
import LineArea from '../charts/LineArea'
import Bars from '../charts/Bars'
import Donut from '../charts/Donut'

const MEMCOL = [WORK, '#c8a24a', '#6ba8e0', '#b89ce0', '#fb7185', '#5ec7a8']
const RANGES: [Range, string][] = [['month', 'Month'], ['6m', '6 Months'], ['year', 'Year']]

/* A group's spending, or — with `personal` — your own: rows that are already your share of
   each bill, across every place, with "where it went" (place names) instead of "who spent". */
export default function AnalyticsModal({ open, onClose, T, expenses, members, uid, fH, nameOf, cats, currency, personal }: {
  open: boolean; onClose: () => void; T: Theme; expenses: Expense[]; members: Member[]; uid: string | null
  fH: (v: number) => string; nameOf: (u: string) => string; cats: Cat[]; currency?: string
  personal?: (place: string) => string
}) {
  const [range, setRange] = useState<Range>('6m')
  const today = tod()
  const scoped = useMemo(() => expenses.filter((e) => inRange(e, range, today)), [expenses, range, today])
  const months = range === 'year' ? 12 : 6
  const trend = useMemo(() => monthlyTotals(expenses, months, today), [expenses, months, today])
  // by the category it shows as: names this list doesn't know all read "Other" and add up as one
  const slices = useMemo(() => byCategory(scoped.map((e) => ({ ...e, category: catOf(cats, e.category).id }))), [scoped, cats])
  const mem = useMemo(() => {
    if (!personal) return byMember(scoped, members).map((x) => ({ label: nameOf(x.uid), total: x.total }))
    const by = new Map<string, number>()
    for (const e of scoped) { const p = personal(e.flat_id); by.set(p, (by.get(p) || 0) + Number(e.amount)) }
    return [...by].map(([label, total]) => ({ label, total: Math.round(total * 100) / 100 })).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  }, [scoped, members, personal, nameOf])
  const totalSpend = total(scoped)
  const myShare = personal ? totalSpend : myShareTotal(scoped, uid, currency)
  const ymNow = today.slice(0, 7)
  // by month number: setMonth(-1) on 31 May lands on "31 April" = 1 May, comparing May with itself
  const ymPrev = ymOf(monthNo(today) - 1)
  const mNow = total(expenses.filter((e) => e.spent_on.slice(0, 7) === ymNow))
  const mPrev = total(expenses.filter((e) => e.spent_on.slice(0, 7) === ymPrev))
  const dPct = mPrev > 0 ? Math.round(((mNow - mPrev) / mPrev) * 100) : null
  const heroLbl = (personal ? 'Your share' : 'Group spend') + (range === 'month' ? ' · this month' : range === 'year' ? ' · this year' : ' · last 6 months')
  return (
    <Sheet open={open} onClose={onClose} title={personal ? 'My spending' : 'Analytics'} T={T}>
      <div style={{ marginBottom: 14 }}><SegmentedControl options={RANGES} value={range} onChange={setRange} T={T} /></div>
      <StatHero T={T} grad label={heroLbl} value={fH(totalSpend)} sub={personal ? 'all groups and friends' : `your share ${fH(myShare)}`}
        delta={range === 'month' && dPct != null ? `${dPct >= 0 ? '↑' : '↓'} ${Math.abs(dPct)}% vs last` : undefined}
        deltaTone={dPct == null ? 'flat' : dPct > 0 ? 'down' : 'up'} />

      <SectionLabel T={T}>Spend trend</SectionLabel>
      <Card T={T}>{trend.some((t) => t.total > 0) ? <LineArea data={trend.map((t) => t.total)} labels={trend.map((t) => t.label)} format={fH} T={T} /> : <div style={{ color: T.txt3, fontSize: 14, padding: '8px 2px' }}>No spending in this range yet.</div>}</Card>

      <SectionLabel T={T}>By category</SectionLabel>
      <Card T={T}>
        {slices.length ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Donut T={T} size={104} stroke={13} segments={slices.map((s) => ({ value: s.total, color: colorOf(catOf(cats, s.cat)) }))} center={<span style={{ fontSize: 13, fontWeight: 800 }}>{fH(totalSpend)}</span>} />
            <div style={{ flex: 1, minWidth: 0 }}><Bars T={T} format={fH} items={slices.map((s) => { const c = catOf(cats, s.cat); return { label: c.label, value: s.total, color: colorOf(c), sub: `${s.pct.toFixed(0)}%` } })} /></div>
          </div>
        ) : <div style={{ color: T.txt3, fontSize: 14 }}>No spending in this range yet.</div>}
      </Card>

      <SectionLabel T={T}>{personal ? 'Where it went' : 'Who spent what'}</SectionLabel>
      <Card T={T} style={{ marginBottom: 8 }}>
        {mem.some((m) => m.total > 0) ? <Bars T={T} format={fH} items={mem.map((m, i) => ({ label: m.label, value: m.total, color: MEMCOL[i % MEMCOL.length] }))} /> : <div style={{ color: T.txt3, fontSize: 14 }}>No spending in this range yet.</div>}
      </Card>
    </Sheet>
  )
}
