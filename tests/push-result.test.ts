/*
  What Settings → "Send a test notification" tells you, for each answer the push
  function can give (supabase/functions/push, event 'test').
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testResultMessage } from '../src/lib/pushResult.ts'

const all = { apns: true, fcm: true, web: true }

test('push test: sent to a device of this kind', () => {
  const r = { configured: all, devices: [{ platform: 'android', ok: false, reason: 'Unregistered' }, { platform: 'android', ok: true }], sent: 1 }
  assert.equal(testResultMessage('android', r), 'Sent. It should appear in a few seconds.')
})

test('push test: the server has no keys for this kind of device yet', () => {
  const r = {
    configured: { apns: false, fcm: false, web: true },
    devices: [{ platform: 'ios', ok: false, reason: 'not configured' }, { platform: 'android', ok: false, reason: 'not configured' }, { platform: 'web', ok: false, reason: 'not configured' }],
    sent: 0,
  }
  assert.equal(testResultMessage('ios', r), "Notifications for iPhone aren't switched on on the server yet.")
  assert.equal(testResultMessage('android', r), "Notifications for Android aren't switched on on the server yet.")
  assert.equal(testResultMessage('web', { ...r, configured: { apns: true, fcm: true, web: false } }), "Notifications for browsers aren't switched on on the server yet.")
})

test('push test: no device of this kind is said first, as the iPhone app does', () => {
  const r = { configured: { apns: true, fcm: false, web: true }, devices: [{ platform: 'ios', ok: true }], sent: 1 }
  assert.equal(testResultMessage('android', r), "This device isn't registered yet. Turn notifications on, then try again.")
})

test('push test: no device of this kind saved — another kind does not count', () => {
  const r = { configured: all, devices: [{ platform: 'ios', ok: true }], sent: 1 }
  assert.equal(testResultMessage('web', r), "This device isn't registered yet. Turn notifications on, then try again.")
  assert.equal(testResultMessage('android', { configured: all, devices: [], sent: 0 }), "This device isn't registered yet. Turn notifications on, then try again.")
})

test('push test: every device of this kind failed', () => {
  const r = { configured: all, devices: [{ platform: 'web', ok: false }, { platform: 'web', ok: false, reason: 'the browser said no' }], sent: 0 }
  assert.equal(testResultMessage('web', r), "Couldn't deliver it: the browser said no")
  assert.equal(testResultMessage('web', { configured: all, devices: [{ platform: 'web', ok: false }], sent: 0 }), "Couldn't deliver it: the server didn't say why.")
})

test('push test: a reply that is not the expected shape', () => {
  for (const r of [null, undefined, 'oops', {}, { configured: all }, { devices: [] }]) {
    assert.equal(testResultMessage('web', r), "Couldn't send a test right now. Try again in a moment.")
  }
})
