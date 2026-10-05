/*
  The push sender's decisions (supabase/functions/push): where its settings come from,
  how a pasted key is tidied, which Apple server a phone goes to, when a phone is really
  gone — and that the JWTs it signs for Apple and Google verify, however the key was
  pasted. apns.ts and fcm.ts run against a stand-in fetch, so nothing leaves the machine.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APNS_HOST, ANDROID_CHANNEL, NOT_CONFIGURED, TEST_BODY, apnsFirstAnswer, apnsHostFor, apnsReasonText, apnsSecondAnswer,
  deviceHint, fcmGone, fcmReasonText, normalizePem, otherApnsHost, parseServiceAccount, pemBody, readPushConfig, summaryLine,
  thrownReasonText, transportOf, webGone,
} from '../supabase/functions/push/logic.ts'
import { signJwt } from '../supabase/functions/push/jwt.ts'
import { apnsPayload, resetApnsCache, sendApns } from '../supabase/functions/push/apns.ts'
import { fcmMessage, resetFcmCache, sendFcm } from '../supabase/functions/push/fcm.ts'

/* ---------- keys made fresh for each run ---------- */

const toPem = (der: ArrayBuffer) => {
  const b64 = Buffer.from(der).toString('base64')
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
}

const ecKeys = async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  return { pem: toPem(await crypto.subtle.exportKey('pkcs8', kp.privateKey)), publicKey: kp.publicKey }
}

const rsaKeys = async () => {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'])
  return { pem: toPem(await crypto.subtle.exportKey('pkcs8', kp.privateKey)), publicKey: kp.publicKey }
}

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const partsOf = (jwt: string) => {
  const [h, c, s] = jwt.split('.')
  return { header: JSON.parse(fromB64url(h).toString()), claims: JSON.parse(fromB64url(c).toString()), sig: fromB64url(s), input: `${h}.${c}` }
}

const verifyEs256 = async (jwt: string, publicKey: CryptoKey) => {
  const p = partsOf(jwt)
  assert.equal(p.sig.length, 64, 'ES256 signature is raw r||s, 64 bytes')
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, p.sig, new TextEncoder().encode(p.input))
}

/* every way a key gets pasted into a settings box */
const pastings = (pem: string) => ({
  'as is': pem,
  'one line with \\n written out': pem.trim().replace(/\n/g, '\\n'),
  'spaces for newlines': pem.trim().replace(/\n/g, ' '),
  'windows line ends': pem.replace(/\n/g, '\r\n'),
  'in quotes': `"${pem.trim().replace(/\n/g, '\\n')}"`,
  'only the middle': pem.replace(/-----[^-]+-----/g, '').trim(),
  'indented': pem.split('\n').map((l) => '   ' + l).join('\n'),
  'with \\n written out twice': pem.trim().replace(/\n/g, '\\\\n'),
  'with its slashes escaped': pem.replace(/\//g, '\\/'),
  // a one-line box (like a secret's value field) drops the line breaks altogether
  'line breaks dropped': pem.replace(/\r?\n/g, ''),
})

/* ---------- settings ---------- */

test('settings: Supabase secrets win over app_config, app_config is the fallback, defaults fill the rest', async () => {
  const { pem } = await ecKeys()
  const app = { apns_key_id: 'CFGKEY0001', apns_private_key: pem, apns_team_id: 'CFGTEAM001', apns_topic: 'cfg.topic', apns_env: 'development' }

  const fromCfg = readPushConfig(() => undefined, app)
  assert.equal(fromCfg.apns?.key_id, 'CFGKEY0001')
  assert.equal(fromCfg.apns?.team_id, 'CFGTEAM001')
  assert.equal(fromCfg.apns?.topic, 'cfg.topic')
  assert.equal(fromCfg.apns?.production, false)

  const env: Record<string, string> = { APNS_KEY_ID: ' ENVKEY0001 ', APNS_PRIVATE_KEY: pem.trim().replace(/\n/g, '\\n'), APNS_ENV: 'production' }
  const fromEnv = readPushConfig((n) => env[n], app)
  assert.equal(fromEnv.apns?.key_id, 'ENVKEY0001')
  assert.equal(fromEnv.apns?.team_id, 'CFGTEAM001', 'not in the secrets: app_config still counts')
  assert.equal(fromEnv.apns?.production, true)
  assert.equal(fromEnv.apns?.private_key, normalizePem(pem))

  const defaults = readPushConfig((n) => ({ APNS_KEY_ID: 'K', APNS_PRIVATE_KEY: pem } as Record<string, string>)[n], {})
  assert.deepEqual({ team: defaults.apns?.team_id, topic: defaults.apns?.topic, production: defaults.apns?.production },
    { team: 'Q3BTHLU74C', topic: 'app.heimat.mobile', production: true })

  // an empty secret doesn't hide the app_config value
  const blank = readPushConfig((n) => (n === 'APNS_KEY_ID' ? '   ' : undefined), app)
  assert.equal(blank.apns?.key_id, 'CFGKEY0001')

  for (const sandbox of ['development', 'Sandbox', 'dev']) {
    assert.equal(readPushConfig((n) => (n === 'APNS_ENV' ? sandbox : undefined), app).apns?.production, false, sandbox)
  }
})

test('settings: nothing set up, half set up, broken — named in problems, never their values', async () => {
  const none = readPushConfig(() => undefined, {})
  assert.equal(none.apns, null)
  assert.equal(none.fcm, null)
  assert.equal(none.web, null)
  assert.equal(none.problems.length, 3)

  const noKey = readPushConfig((n) => (n === 'APNS_KEY_ID' ? 'ABC' : undefined), {})
  assert.equal(noKey.apns, null)
  assert.ok(noKey.problems.includes('APNS_PRIVATE_KEY is missing'))

  const badKey = readPushConfig((n) => ({ APNS_KEY_ID: 'ABC', APNS_PRIVATE_KEY: 'not a key at all!' } as Record<string, string>)[n], {})
  assert.equal(badKey.apns, null)
  assert.ok(badKey.problems.includes('APNS_PRIVATE_KEY is not a key'))
  assert.ok(!badKey.problems.join(' ').includes('not a key at all'), 'the value itself is never repeated')

  const web = readPushConfig(() => undefined, { vapid_public: 'pub', vapid_private: 'priv' })
  assert.deepEqual(web.web, { public_key: 'pub', private_key: 'priv', subject: 'mailto:noreply@heimat.app' })
})

test('settings: the Firebase service account as JSON, as base64, or broken', async () => {
  const { pem } = await rsaKeys()
  const sa = { type: 'service_account', project_id: 'splitlife-1', client_email: 'push@splitlife-1.iam.gserviceaccount.com', private_key: pem }
  const raw = JSON.stringify(sa)

  const viaEnv = readPushConfig((n) => (n === 'FCM_SERVICE_ACCOUNT' ? raw : undefined), {})
  assert.equal(viaEnv.fcm?.project_id, 'splitlife-1')
  assert.equal(viaEnv.fcm?.private_key, normalizePem(pem))

  const viaCfg = readPushConfig(() => undefined, { fcm_service_account: raw })
  assert.equal(viaCfg.fcm?.client_email, sa.client_email)

  assert.equal(parseServiceAccount(Buffer.from(raw).toString('base64')).sa?.project_id, 'splitlife-1')
  // escaped twice: the key arrives with \n written out even after JSON.parse
  const twice = JSON.stringify({ ...sa, private_key: pem.replace(/\n/g, '\\n') })
  assert.equal(parseServiceAccount(twice).sa?.private_key, normalizePem(pem))
  // the downloaded file is several lines; pasted into a one-line box they are dropped or
  // become spaces, and it is still the same account
  const file = JSON.stringify(sa, null, 2)
  assert.equal(parseServiceAccount(file.replace(/\n/g, '')).sa?.private_key, normalizePem(pem))
  assert.equal(parseServiceAccount(file.replace(/\n/g, ' ')).sa?.client_email, sa.client_email)

  assert.match(parseServiceAccount('{nope').problem || '', /not JSON/)
  assert.match(parseServiceAccount(JSON.stringify({ project_id: 'x' })).problem || '', /client_email, private_key/)
  assert.equal(parseServiceAccount('').sa, null)
  assert.equal(parseServiceAccount('').problem, undefined)
})

/* ---------- keys ---------- */

test('a private key works however it was pasted', async () => {
  const { pem } = await ecKeys()
  const tidy = normalizePem(pem)
  for (const [how, pasted] of Object.entries(pastings(pem))) {
    assert.equal(normalizePem(pasted), tidy, how)
    assert.equal(pemBody(pasted), pemBody(pem), how)
  }
  assert.equal(normalizePem(''), '')
  assert.equal(normalizePem(null), '')
  assert.equal(normalizePem('-----BEGIN PRIVATE KEY-----\n***\n-----END PRIVATE KEY-----'), '')
  assert.throws(() => pemBody('nothing'))
})

test('signJwt ES256 (Apple): verifies with the public key, from every pasting', async () => {
  const { pem, publicKey } = await ecKeys()
  for (const [how, pasted] of Object.entries(pastings(pem))) {
    const jwt = await signJwt('ES256', pasted, { kid: 'KEY1234567' }, { iss: 'Q3BTHLU74C', iat: 1700000000 })
    const p = partsOf(jwt)
    assert.deepEqual(p.header, { alg: 'ES256', typ: 'JWT', kid: 'KEY1234567' }, how)
    assert.deepEqual(p.claims, { iss: 'Q3BTHLU74C', iat: 1700000000 }, how)
    assert.equal(await verifyEs256(jwt, publicKey), true, how)
    assert.ok(!/[+/=]/.test(jwt), 'base64url, no padding')
  }
  // and a different key doesn't verify it
  const other = await ecKeys()
  const jwt = await signJwt('ES256', pem, {}, { iss: 'x' })
  assert.equal(await verifyEs256(jwt, other.publicKey), false)
})

test('signJwt RS256 (Google): verifies with the public key', async () => {
  const { pem, publicKey } = await rsaKeys()
  const jwt = await signJwt('RS256', pem.trim().replace(/\n/g, '\\n'), {}, { iss: 'svc@x', aud: 'https://oauth2.googleapis.com/token' })
  const p = partsOf(jwt)
  assert.equal(p.header.alg, 'RS256')
  assert.equal(await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, publicKey, p.sig, new TextEncoder().encode(p.input)), true)
})

/* ---------- addresses and Apple's servers ---------- */

const HEX = 'ab'.repeat(32)

test('which service, and which Apple server', () => {
  assert.deepEqual(transportOf(`apns:${HEX}`), { kind: 'apns', platform: 'ios', token: HEX, sandbox: false })
  assert.deepEqual(transportOf(`apns-dev:${HEX}`), { kind: 'apns', platform: 'ios', token: HEX, sandbox: true })
  assert.deepEqual(transportOf('fcm:abc:def'), { kind: 'fcm', platform: 'android', token: 'abc:def' })
  assert.deepEqual(transportOf('https://fcm.googleapis.com/fcm/send/x'), { kind: 'web', platform: 'web' })

  const prod = { production: true }
  const sand = { production: false }
  assert.equal(apnsHostFor(`apns:${HEX}`, prod), APNS_HOST.production)
  assert.equal(apnsHostFor(`apns:${HEX}`, sand), APNS_HOST.sandbox)
  assert.equal(apnsHostFor(`apns-dev:${HEX}`, prod), APNS_HOST.sandbox, 'an Xcode build always goes to the test server')
  assert.equal(apnsHostFor(`apns-dev:${HEX}`, sand), APNS_HOST.sandbox)
  assert.equal(otherApnsHost(APNS_HOST.production), APNS_HOST.sandbox)
  assert.equal(otherApnsHost(APNS_HOST.sandbox), APNS_HOST.production)
})

test("when Apple says no: retry on the other server only for BadDeviceToken; forget only what's really gone", () => {
  assert.equal(apnsFirstAnswer({ status: 200 }), 'ok')
  assert.equal(apnsFirstAnswer({ status: 410, reason: 'Unregistered' }), 'gone')
  assert.equal(apnsFirstAnswer({ status: 410, reason: 'ExpiredToken' }), 'gone')
  assert.equal(apnsFirstAnswer({ status: 400, reason: 'BadDeviceToken' }), 'other-host')
  // the server's own settings are wrong — the phone is fine, keep it
  for (const reason of ['DeviceTokenNotForTopic', 'BadTopic', 'TopicDisallowed']) assert.equal(apnsFirstAnswer({ status: 400, reason }), 'fail', reason)
  assert.equal(apnsFirstAnswer({ status: 403, reason: 'InvalidProviderToken' }), 'fail')
  assert.equal(apnsFirstAnswer({ status: 429, reason: 'TooManyRequests' }), 'fail')
  assert.equal(apnsFirstAnswer({ status: 500, reason: 'InternalServerError' }), 'fail')
  assert.equal(apnsFirstAnswer({ status: 503 }), 'fail')

  assert.equal(apnsSecondAnswer({ status: 200 }), 'ok')
  assert.equal(apnsSecondAnswer({ status: 400, reason: 'BadDeviceToken' }), 'gone', 'refused by both servers')
  assert.equal(apnsSecondAnswer({ status: 410, reason: 'Unregistered' }), 'gone')
  assert.equal(apnsSecondAnswer({ status: 400, reason: 'DeviceTokenNotForTopic' }), 'fail')
  assert.equal(apnsSecondAnswer({ status: 503 }), 'fail')

  assert.equal(fcmGone(404), true)
  assert.equal(fcmGone(400, 'NOT_FOUND'), true)
  assert.equal(fcmGone(400, 'INVALID_ARGUMENT', 'UNREGISTERED'), true)
  assert.equal(fcmGone(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT'), false)
  assert.equal(fcmGone(403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH'), false)
  assert.equal(fcmGone(500, 'INTERNAL'), false)

  assert.equal(webGone(404), true)
  assert.equal(webGone(410), true)
  assert.equal(webGone(403), false)
  assert.equal(webGone(undefined), false)
})

// what a person pressing "Send a test notification" may read: no names of server settings
const JARGON = /APNS_|FCM_|Firebase|topic|provider|pkcs|JWT/i

test('plain words', () => {
  assert.match(apnsReasonText(400, 'DeviceTokenNotForTopic'), /set up for a different iPhone app\. This needs fixing on the server/)
  assert.match(apnsReasonText(403, 'InvalidProviderToken'), /Apple didn't accept the server's key/)
  for (const r of ['DeviceTokenNotForTopic', 'BadTopic', 'InvalidProviderToken', 'BadDeviceToken', 'Unregistered', 'TooManyProviderTokenUpdates']) {
    assert.doesNotMatch(apnsReasonText(403, r), JARGON, r)
  }
  for (const [h, st, c] of [[403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH'], [401, 'UNAUTHENTICATED'], [404, 'NOT_FOUND', 'UNREGISTERED'], [400, 'INVALID_ARGUMENT']] as [number, string, string?][]) {
    assert.doesNotMatch(fcmReasonText(h, st, c), JARGON, String(c || st))
  }
  for (const pl of ['ios', 'android', 'web'] as const) assert.doesNotMatch(thrownReasonText(pl, 'DataError'), JARGON, pl)
  assert.match(apnsReasonText(503), /Try again later/)
  assert.equal(NOT_CONFIGURED.ios, "Notifications for iPhone aren't switched on on the server yet.")
  assert.equal(NOT_CONFIGURED.android, "Notifications for Android aren't switched on on the server yet.")
  assert.equal(NOT_CONFIGURED.web, "Notifications for browsers aren't switched on on the server yet.")
  assert.equal(TEST_BODY, 'Test notification — notifications work on this device.')
  assert.match(thrownReasonText('ios', 'TimeoutError'), /didn't answer in time/)
  assert.match(thrownReasonText('ios', 'DataError'), /key for iPhone notifications can't be read/)
  assert.match(thrownReasonText('android', 'Error', 'the private key is empty or not a key'), /key for Android notifications can't be read/)
  assert.match(thrownReasonText('web', 'TypeError', 'fetch failed'), /couldn't be reached/)
})

test('the log never carries a whole token', () => {
  const token = 'f'.repeat(58) + '123456'
  assert.equal(deviceHint(`apns:${token}`), 'ios…123456')
  assert.equal(deviceHint(`fcm:${token}`), 'android…123456')
  assert.equal(deviceHint('https://web.push.apple.com/QGv-secret-path'), 'web@web.push.apple.com')
  const line = summaryLine('expense_added', 2, [
    { platform: 'ios', ok: true, hint: deviceHint(`apns:${token}`) },
    { platform: 'android', ok: false, code: 'not-configured', hint: deviceHint(`fcm:${token}`) },
  ], { apns: true, fcm: false, web: true }, ['FCM is not set up (FCM_SERVICE_ACCOUNT)'])
  assert.ok(!line.includes(token))
  const j = JSON.parse(line)
  assert.equal(j.sent, 1)
  assert.equal(j.failed, 1)
  assert.deepEqual(j.problems, ['FCM is not set up (FCM_SERVICE_ACCOUNT)'])
  // problems only show when a device needed what's missing
  assert.equal(JSON.parse(summaryLine('x', 1, [{ platform: 'ios', ok: true }], { apns: true, fcm: false, web: false }, ['FCM is not set up'])).problems, undefined)
})

/* ---------- apns.ts and fcm.ts against a stand-in fetch ---------- */

type Call = { url: string; init: RequestInit }
const withFetch = async (answers: ((c: Call) => Response | Promise<Response>)[], run: (calls: Call[]) => Promise<void>) => {
  const real = globalThis.fetch
  const calls: Call[] = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(url), init: init || {} }
    calls.push(c)
    const answer = answers[calls.length - 1]
    if (!answer) throw new Error(`unexpected fetch ${c.url}`)
    return answer(c)
  }) as typeof fetch
  try {
    await run(calls)
  } finally {
    globalThis.fetch = real
  }
}
const ok = () => new Response(null, { status: 200 })
const apple = (status: number, reason: string) => () => Response.json({ reason }, { status })

test('APNs: a store build goes to production, an Xcode build to the test server; no badge', async () => {
  resetApnsCache()
  const { pem, publicKey } = await ecKeys()
  const cfg = { key_id: 'KEY1234567', team_id: 'Q3BTHLU74C', private_key: normalizePem(pem), topic: 'app.heimat.mobile', production: true }
  const n = { title: 'Splitlife', body: 'Hi', tag: 'nudge' }

  await withFetch([ok, ok], async (calls) => {
    assert.deepEqual(await sendApns(cfg, `apns:${HEX}`, n), { ok: true, status: 200 })
    assert.deepEqual(await sendApns(cfg, `apns-dev:${HEX}`, n), { ok: true, status: 200 })
    assert.equal(calls[0].url, `https://${APNS_HOST.production}/3/device/${HEX}`)
    assert.equal(calls[1].url, `https://${APNS_HOST.sandbox}/3/device/${HEX}`)
    const h = calls[0].init.headers as Record<string, string>
    assert.equal(h['apns-topic'], 'app.heimat.mobile')
    assert.equal(h['apns-push-type'], 'alert')
    assert.equal(h['apns-collapse-id'], 'nudge')
    assert.equal(await verifyEs256(h.authorization.replace(/^bearer /, ''), publicKey), true)
    const body = JSON.parse(String(calls[0].init.body))
    assert.deepEqual(body, { aps: { alert: { title: 'Splitlife', body: 'Hi' }, sound: 'default' } })
    assert.equal('badge' in body.aps, false)
  })
  assert.equal('badge' in apnsPayload(n).aps, false)
})

test('APNs: BadDeviceToken → the other server once; forgotten only if both refuse', async () => {
  resetApnsCache()
  const { pem } = await ecKeys()
  const cfg = { key_id: 'KEY1234567', team_id: 'Q3BTHLU74C', private_key: normalizePem(pem), topic: 'app.heimat.mobile', production: true }
  const n = { title: 't', body: 'b' }

  await withFetch([apple(400, 'BadDeviceToken'), ok], async (calls) => {
    const r = await sendApns(cfg, `apns:${HEX}`, n)
    assert.equal(r.ok, true)
    assert.equal(calls[1].url, `https://${APNS_HOST.sandbox}/3/device/${HEX}`)
  })
  await withFetch([apple(400, 'BadDeviceToken'), apple(400, 'BadDeviceToken')], async () => {
    const r = await sendApns(cfg, `apns:${HEX}`, n)
    assert.equal(r.ok, false)
    assert.equal(r.gone, true)
    assert.equal(r.code, 'BadDeviceToken')
  })
  await withFetch([apple(400, 'BadDeviceToken'), () => { throw new DOMException('timed out', 'TimeoutError') }], async () => {
    const r = await sendApns(cfg, `apns:${HEX}`, n)
    assert.equal(r.gone, false, "the other server didn't answer: keep the phone")
  })
  await withFetch([apple(410, 'Unregistered')], async (calls) => {
    const r = await sendApns(cfg, `apns:${HEX}`, n)
    assert.equal(r.gone, true)
    assert.equal(calls.length, 1)
  })
  await withFetch([apple(400, 'DeviceTokenNotForTopic')], async (calls) => {
    const r = await sendApns(cfg, `apns:${HEX}`, n)
    assert.equal(r.gone, false, 'a settings problem, not a dead phone')
    assert.match(r.reason || '', /different iPhone app/)
    assert.equal(calls.length, 1)
  })
  await withFetch([apple(403, 'InvalidProviderToken')], async () => {
    const r = await sendApns(cfg, `apns:${HEX}`, n)
    assert.equal(r.gone, false)
    assert.match(r.reason || '', /didn't accept the server's key/)
  })
})

test('APNs: one token for several iPhones at once; a corrected key or a refused token is not kept', async () => {
  resetApnsCache()
  const first = await ecKeys()
  const cfg = { key_id: 'KEY1234567', team_id: 'Q3BTHLU74C', private_key: normalizePem(first.pem), topic: 'app.heimat.mobile', production: true }
  const n = { title: 't', body: 'b' }
  const bearer = (c: Call) => (c.init.headers as Record<string, string>).authorization

  await withFetch([ok, ok, ok], async (calls) => {
    await Promise.all([1, 2, 3].map(() => sendApns(cfg, `apns:${HEX}`, n)))
    assert.equal(new Set(calls.map(bearer)).size, 1, 'sent at once: one token between them')
  })
  // the same key id with a different (corrected) key signs a new token straight away
  const second = await ecKeys()
  const fixed = { ...cfg, private_key: normalizePem(second.pem) }
  await withFetch([ok], async (calls) => {
    await sendApns(fixed, `apns:${HEX}`, n)
    assert.equal(await verifyEs256(bearer(calls[0]).replace(/^bearer /, ''), second.publicKey), true)
  })
  // Apple refuses the token: the next send mints another rather than repeat it
  let before = ''
  await withFetch([apple(403, 'ExpiredProviderToken'), ok], async (calls) => {
    await sendApns(fixed, `apns:${HEX}`, n)
    before = bearer(calls[0])
    await sendApns(fixed, `apns:${HEX}`, n)
    assert.equal(calls.length, 2)
    assert.notEqual(bearer(calls[1]), before, 'a fresh token (ES256 signatures differ every time)')
  })
  // a key that can't be used isn't kept as a failure either
  resetApnsCache()
  const broken = { ...cfg, private_key: normalizePem('A'.repeat(64)) }
  await assert.rejects(sendApns(broken, `apns:${HEX}`, n))
  await withFetch([ok], async () => {
    assert.equal((await sendApns(cfg, `apns:${HEX}`, n)).ok, true)
  })
})

test("FCM: the 'splitlife' channel, and only UNREGISTERED forgets a phone", async () => {
  resetFcmCache()
  const { pem, publicKey } = await rsaKeys()
  const sa = { project_id: 'splitlife-1', client_email: 'push@splitlife-1.iam.gserviceaccount.com', private_key: normalizePem(pem) }
  const n = { title: 'Splitlife', body: 'Hi', tag: 'nudge' }
  assert.equal(ANDROID_CHANNEL, 'splitlife')
  assert.equal(fcmMessage('tok', n).message.android.notification.channel_id, 'splitlife')

  const token = () => Response.json({ access_token: 'ya29.test', expires_in: 3600 })
  await withFetch([token, ok], async (calls) => {
    assert.deepEqual(await sendFcm(sa, 'fcm:device-token', n), { ok: true, status: 200 })
    assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token')
    const assertion = new URLSearchParams(String(calls[0].init.body)).get('assertion')!
    const p = partsOf(assertion)
    assert.equal(p.claims.iss, sa.client_email)
    assert.equal(await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, publicKey, p.sig, new TextEncoder().encode(p.input)), true)
    assert.equal(calls[1].url, 'https://fcm.googleapis.com/v1/projects/splitlife-1/messages:send')
    assert.equal((calls[1].init.headers as Record<string, string>).authorization, 'Bearer ya29.test')
    const m = JSON.parse(String(calls[1].init.body)).message
    assert.equal(m.token, 'device-token')
    assert.equal(m.android.notification.channel_id, 'splitlife')
    assert.equal(m.android.notification.tag, 'nudge')
  })

  const google = (status: number, s: string, code?: string) => () =>
    Response.json({ error: { status: s, details: code ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] : [] } }, { status })
  // the access token is cached now: one fetch per send
  await withFetch([google(404, 'NOT_FOUND', 'UNREGISTERED')], async () => {
    const r = await sendFcm(sa, 'fcm:device-token', n)
    assert.equal(r.gone, true)
    assert.equal(r.code, 'UNREGISTERED')
  })
  await withFetch([google(403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH')], async () => {
    const r = await sendFcm(sa, 'fcm:device-token', n)
    assert.equal(r.gone, false)
    assert.match(r.reason || '', /set up for a different Android app/)
  })

  resetFcmCache()
  await withFetch([() => Response.json({ error: 'invalid_grant' }, { status: 400 })], async (calls) => {
    const r = await sendFcm(sa, 'fcm:device-token', n)
    assert.equal(r.ok, false)
    assert.equal(r.gone, false)
    assert.match(r.reason || '', /Google didn't accept the server's key/)
    assert.equal(calls.length, 1, 'no send without an access token')
  })

  // no answer from Google's sign-in is a timeout, not a wrong key
  resetFcmCache()
  await withFetch([() => { throw new DOMException('timed out', 'TimeoutError') }], async () => {
    const r = await sendFcm(sa, 'fcm:device-token', n)
    assert.equal(r.gone, false)
    assert.match(r.reason || '', /didn't answer in time/)
  })

  // several phones at once: one exchange between them
  resetFcmCache()
  await withFetch([token, ok, ok, ok], async (calls) => {
    const rs = await Promise.all([1, 2, 3].map(() => sendFcm(sa, 'fcm:device-token', n)))
    assert.ok(rs.every((r) => r.ok))
    assert.equal(calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token').length, 1)
  })
})
