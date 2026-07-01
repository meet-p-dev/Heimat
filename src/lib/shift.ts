import type { Shift, Derived } from './types'

export const toMin = (t: string) => parseInt(t.slice(0, 2)) * 60 + parseInt(t.slice(3, 5))

/* shift earnings/hours derivation (handles overnight, paid break, legacy rows) */
export function deriveShift(s: Shift): Derived {
  if (s.start && s.end) {
    const grossMin = (toMin(s.end) - toMin(s.start) + 1440) % 1440
    const breakMin = Number(s.breakMin) || 0
    const workedMin = Math.max(0, grossMin - breakMin)
    const paidMin = s.paidBreak ? grossMin : workedMin
    const wage = Number(s.wage) || 0
    const paidHours = paidMin / 60
    return { paidHours, legalHours: workedMin / 60, pay: s.pay != null ? s.pay : paidHours * wage, wage, overnight: toMin(s.end) <= toMin(s.start) }
  }
  const lh = Number(s.hours) || 0
  const wage = Number(s.wage) || 0
  return { paidHours: lh, legalHours: lh, pay: s.pay != null ? s.pay : lh * wage, wage, overnight: false }
}
