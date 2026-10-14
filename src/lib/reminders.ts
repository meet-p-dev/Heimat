import { sb } from './supabase'
import { LS } from './storage'

/* Reminders (bills, chore turns, the daily "anything to add today?") go out in this device's
   own time, so the server is told its time zone — again only when it changes or someone else
   signs in. The time zone, not the country: the US, Canada or Australia have several.
   Same as AppModel.syncTimeZone on iPhone. */
export async function syncTimeZone(uid: string | null) {
  if (!uid || !sb) return
  let tz = ''
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return }
  const key = `${uid}|${tz}`
  if (!tz || LS.g<string>('mt-h-tz-sent') === key) return
  const { error } = await sb.rpc('set_time_zone', { p_tz: tz })
  if (!error) LS.s('mt-h-tz-sent', key)
}

/* the daily reminder's local hour; null = off; undefined = couldn't tell (20:00 until changed) */
export async function dailyReminderHour(uid: string | null): Promise<number | null | undefined> {
  if (!uid || !sb) return undefined
  const { data, error } = await sb.from('notify_prefs').select('daily_hour').eq('user_id', uid).maybeSingle()
  if (error) return undefined
  return data ? (data as { daily_hour: number | null }).daily_hour : 20
}

export async function setDailyReminder(uid: string | null, hour: number | null): Promise<boolean> {
  if (!uid || !sb) return false
  await syncTimeZone(uid)
  const { error } = await sb.rpc('set_daily_reminder', { p_hour: hour })
  return !error
}
