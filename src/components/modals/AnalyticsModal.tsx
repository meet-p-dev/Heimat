import { useMemo, useState } from 'react'
import type { Theme, Expense, Member } from '../../lib/types'
import { tod } from '../../lib/format'
import { cat } from '../../lib/data'
import { catColor, WORK } from '../../lib/theme'
import { inRange, monthlyTotals, byCategory, byMember, myShareTotal, total, type Range } from '../../lib/analytics'
import { Sheet, SegmentedControl, StatHero, SectionLabel, Card } from '../ui'
import LineArea from '../charts/LineArea'
import Bars from '../charts/Bars'
import Donut from '../charts/Donut'

const MEMCOL = [WORK, '#c8a24a', '#6ba8e0', '#b89ce0', '#fb7185', '#5ec7a8']
const RANGES: [Range, string][] = [['month', 'Month'], ['6m', '6 Months'], ['year', 'Year']]

export default function AnalyticsModal({ open, onClose, T, expenses, members, uid, fH, nameOf }: {
  open: boolean; onClose: () => void; T: Theme; expenses: Expense[]; members: Member[]; uid: string | null
  fH: (v: number) => string; nameOf: (u: string) => string
}) {
  const [range, setRange] = useState<Range>('6m')
  const today = tod()
  const scoped = useMemo(() => expenses.filter((e) => inRange(e, range, today)), [expenses, range, today])
  const months = range === 'year' ? 12 : 6
  const trend = useMemo(() => monthlyTotals(expenses, months, today), [expenses, months, today])
  const cats = useMemo(() => byCategory(scoped), [scoped])
  const mem = useMemo(() => byMember(scoped, members), [scoped, members])
  const totalSpend = total(scoped)
  const myShare = myShareTotal(scoped, uid)
  const ymNow = today.slice(0, 7)
  const prevD = new Date(today + 'T00:00:00'); prevD.setMonth(prevD.getMonth() - 1)
  const ymPrev = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`
  const mNow = expenses.filter((e) => e.spent_on.slice(0, 7) === ymNow).reduce((s, e) => s + e.amount, 0)
  const mPrev = expenses.filter((e) => e.spent_on.slice(0, 7) === ymPrev).reduce((s, e) => s + e.amount, 0)
  const dPct = mPrev > 0 ? Math.round(((mNow - mPrev) / mPrev) * 100) : null
  const heroLbl = range === 'month' ? 'Group spend · this month' : range === 'year' ? 'Group spend · this year' : 'Group spend · last 6 months'
  return (
    <Sheet open={open} onClose={onClose} title="Analytics" T={T}>
      <div style={{ marginBottom: 14 }}><SegmentedControl options={RANGES} value={range} onChange={setRange} T={T} /></div>
      <StatHero T={T} grad label={heroLbl} value={fH(totalSpend)} sub={`your share ${fH(myShare)}`}
        delta={range === 'month' && dPct != null ? `${dPct >= 0 ? '↑' : '↓'} ${Math.abs(dPct)}% vs last` : undefined}
        deltaTone={dPct == null ? 'flat' : dPct > 0 ? 'down' : 'up'} />

      <SectionLabel T={T}>Spend trend</SectionLabel>
      <Card T={T}>{trend.some((t) => t.total > 0) ? <LineArea data={trend.map((t) => t.total)} labels={trend.map((t) => t.label)} format={fH} T={T} /> : <div style={{ color: T.txt3, fontSize: 14, padding: '8px 2px' }}>No spending in this range yet.</div>}</Card>

      <SectionLabel T={T}>By category</SectionLabel>
      <Card T={T}>
        {cats.length ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Donut T={T} size={104} stroke={13} segments={cats.map((c) => ({ value: c.total, color: catColor(c.cat) }))} center={<span style={{ fontSize: 13, fontWeight: 800 }}>{fH(totalSpend)}</span>} />
            <div style={{ flex: 1, minWidth: 0 }}><Bars T={T} format={fH} items={cats.map((c) => ({ label: cat(c.cat).label, value: c.total, color: catColor(c.cat), sub: `${c.pct.toFixed(0)}%` }))} /></div>
          </div>
        ) : <div style={{ color: T.txt3, fontSize: 14 }}>No spending in this range yet.</div>}
      </Card>

      <SectionLabel T={T}>Who spent what</SectionLabel>
      <Card T={T} style={{ marginBottom: 8 }}>
        {mem.some((m) => m.total > 0) ? <Bars T={T} format={fH} items={mem.map((m, i) => ({ label: nameOf(m.uid), value: m.total, color: MEMCOL[i % MEMCOL.length] }))} /> : <div style={{ color: T.txt3, fontSize: 14 }}>No spending in this range yet.</div>}
      </Card>
    </Sheet>
  )
}
