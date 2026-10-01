/* kept on its own, with no imports, so the tests can load it (tests/bills.test.ts) */

/* the last day to cancel: the end, less the notice (the same sum as bill_cancel_by) */
export function cancelByOf(ends: string, amount: number, unit: 'week' | 'month'): string {
  const d = new Date(ends + 'T00:00:00')
  if (unit === 'week') d.setDate(d.getDate() - 7 * amount)
  else {
    const day = d.getDate()
    d.setDate(1); d.setMonth(d.getMonth() - amount)
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
