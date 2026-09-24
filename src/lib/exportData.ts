import type { Shift } from './types'
import { deriveShift } from './shift'
import { isNative, shareText, copyText } from './native'

/* Hand a text file to the user: a download on the web, the share sheet in the
   apps (they have no file system plugin), the clipboard as a last resort. */
export async function saveTextFile(name: string, text: string, mime: string): Promise<'saved' | 'shared' | 'copied' | 'failed'> {
  if (!isNative) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: mime }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      return 'saved'
    } catch {}
  }
  if (await shareText(text, name)) return 'shared'
  if (await copyText(text)) return 'copied'
  return 'failed'
}

const cell = (v: string | number) => {
  const s = String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/* one row per shift, oldest first — the shape a timesheet or tax form wants */
export function shiftsCsv(shifts: Shift[]): string {
  const head = ['Date', 'Employer', 'Start', 'End', 'Break (min)', 'Paid break', 'Paid hours', 'Hourly wage', 'Gross pay']
  const rows = [...shifts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => {
      const d = deriveShift(s)
      return [s.date, s.employer || '', s.start || '', s.end || '', s.breakMin || 0, s.paidBreak ? 'yes' : 'no', d.paidHours.toFixed(2), d.wage.toFixed(2), d.pay.toFixed(2)]
    })
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n')
}
