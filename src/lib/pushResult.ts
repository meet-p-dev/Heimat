/* What "Send a test notification" (Settings) says, from the push function's reply
   (supabase/functions/push, event 'test'). Kept on its own, with no imports, so the
   tests can load it (tests/push-result.test.ts). The iPhone app says the same things. */

export type PushPlatform = 'ios' | 'android' | 'web'

export type PushTestReply = {
  // which ways of sending the server has keys for: Apple's, Firebase's, browsers'
  configured: { apns: boolean; fcm: boolean; web: boolean }
  // every device saved for you, and how sending to it went
  devices: { platform: PushPlatform; ok: boolean; reason?: string }[]
  sent: number
}

const SENDER = { ios: 'apns', android: 'fcm', web: 'web' } as const
const WHERE = { ios: 'iPhone', android: 'Android', web: 'browsers' } as const

/* The reply covers all of your devices and can't say which one is this one, so it
   is judged by the devices of the same kind as this one. Checked in the same order
   as the iPhone app (Push.swift sendTest): no such device, then the server's keys,
   then whether any arrived. */
export function testResultMessage(platform: PushPlatform, reply: unknown): string {
  const r = reply as Partial<PushTestReply> | null
  if (!r || typeof r !== 'object' || !r.configured || !Array.isArray(r.devices)) {
    return "Couldn't send a test right now. Try again in a moment."
  }
  const mine = r.devices.filter((d) => d && d.platform === platform)
  if (!mine.length) return "This device isn't registered yet. Turn notifications on, then try again."
  if (!r.configured[SENDER[platform]]) return `Notifications for ${WHERE[platform]} aren't switched on on the server yet.`
  if (mine.some((d) => d.ok)) return 'Sent. It should appear in a few seconds.'
  return `Couldn't deliver it: ${mine.find((d) => d.reason)?.reason || "the server didn't say why."}`
}
