// Keyless exchange-rate lookup (open.er-api.com). Returns host→home rate, or null.
export async function fetchRate(hostCur: string, homeCur: string): Promise<number | null> {
  if (!hostCur || !homeCur || hostCur === homeCur) return null
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${hostCur}`)
    const d = await r.json()
    const v = d && d.rates && d.rates[homeCur]
    return v ? Math.round(v * 100) / 100 : null
  } catch {
    return null
  }
}
