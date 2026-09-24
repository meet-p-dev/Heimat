// Keyless exchange-rate lookup (open.er-api.com). Returns host→home rate, or null.
export async function fetchRate(hostCur: string, homeCur: string): Promise<number | null> {
  if (!hostCur || !homeCur || hostCur === homeCur) return null
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${hostCur}`)
    const d = await r.json()
    const v = d && d.rates && d.rates[homeCur]
    // six significant digits, not two decimals: 1 SEK is 0,0956 USD, and
    // rounding that to 0,10 made every home-currency figure 4,6% too high
    return v ? Number(v.toPrecision(6)) : null
  } catch {
    return null
  }
}
