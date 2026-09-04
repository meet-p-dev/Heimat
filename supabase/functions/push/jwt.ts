/* Just enough JWT to talk to Apple (ES256) and Google (RS256) — both providers
   want a signed token, and pulling in a library for two claims isn't worth it. */

const enc = new TextEncoder()

export const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/* PEM (PKCS#8) → the DER bytes crypto.subtle wants */
const pemToDer = (pem: string) => {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
}

type Alg = 'ES256' | 'RS256'

const params = (alg: Alg) =>
  alg === 'ES256'
    ? { import: { name: 'ECDSA', namedCurve: 'P-256' }, sign: { name: 'ECDSA', hash: 'SHA-256' } }
    : { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, sign: { name: 'RSASSA-PKCS1-v1_5' } }

export async function signJwt(alg: Alg, pem: string, header: Record<string, unknown>, claims: Record<string, unknown>) {
  const p = params(alg)
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(pem), p.import as any, false, ['sign'])
  const signingInput = `${b64url(enc.encode(JSON.stringify({ alg, typ: 'JWT', ...header })))}.${b64url(enc.encode(JSON.stringify(claims)))}`
  // ES256 from WebCrypto is already the raw r||s pair a JWT expects
  const sig = await crypto.subtle.sign(p.sign as any, key, enc.encode(signingInput))
  return `${signingInput}.${b64url(sig)}`
}
