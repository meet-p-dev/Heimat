import { readReceipt, itemsMatch } from './receipt.ts'

/* A page of a receipt as text recognition hands it over → its printed lines, top to
   bottom, for readReceipt. A port of the iPhone app's ReceiptOCR.swift (the part that
   isn't Apple's camera): on a receipt the name of a line and its price come back as two
   pieces, far apart. Pieces whose middles sit at the same height are one printed line.
   A photo taken at a slight angle tilts every line by the same angle, found from the
   receipt's columns. Runs on the phone — nothing leaves the device. */

export interface Piece {
  text: string
  /* in pixels, y growing upwards (the Android plugin turns its y over to match) */
  midX: number; midY: number; minX: number; maxX: number; height: number
}

/* One page as lines, and whether its lines can be trusted one by one. The same lines with
   the same prices come out when the tilt is taken half a degree either way. A reading that
   changes with that little has paired names and prices by chance — its lines can still add
   up (the same prices, each one line off), so only a steady reading is split line by line. */
export interface Page { rows: string[]; steady: boolean }

/* A page read at the tilt its columns show, and laid straight as the scanner handed it
   over; the reading where the receipt agrees with itself wins — its lines add up to the
   total, a card line repeats it — the columns' tilt when they agree equally. Two readings,
   as the iPhone reads the photo straightened and as taken; never a search over angles:
   some angle can always be found at which a misread receipt seems to agree with itself. */
export function pageOf(input: Piece[], now?: string): Page {
  const pieces = input.map((p) => ({ ...p, text: tidy(p.text) }))
  const score = (rs: string[]) => { const r = readReceipt(rs, now); return (itemsMatch(r) ? 4 : 0) + (r.totalSure ? 2 : 0) + (r.total != null ? 1 : 0) }
  let best: { score: number; page: Page } | null = null
  for (const angle of [...new Set([Math.atan(columnTilt(pieces)), 0])]) {
    const at = (nudge: number) => lines(pieces, Math.tan(angle + nudge * Math.PI / 180))
    const rows = at(0)
    const key = (rs: string[]) => JSON.stringify(readReceipt(rs, now).items)
    const k = key(rows)
    const sc = score(rows)
    if (!best || sc > best.score) best = { score: sc, page: { rows, steady: [-0.5, 0.5].every((n) => key(at(n)) === k) } }
  }
  return best!.page
}

/* Android's text recognition reads "1,49" as "1, 49" now and then: a figure with two
   decimals is put back together (nothing else on a receipt has a comma, a space and two digits) */
export const tidy = (t: string) => t.replace(/(\d)([.,]) (\d{2})(?!\d)/g, '$1$2$3')

/* The tilt at which the receipt's columns stand straightest: the names start at one edge
   and the prices end at the other, all the way down. Over the height of a whole receipt a
   wrong angle leans those edges far apart — unlike the lines, where tilting a line's height
   too far just pairs each price with the next name. */
export function columnTilt(pieces: Piece[]): number {
  if (pieces.length < 4) return 0
  const hs = pieces.map((p) => p.height).sort((a, b) => a - b)
  const tol = 0.5 * hs[Math.floor(hs.length / 4)]
  /* the biggest group of edges within `tol` of each other on that side of the receipt,
     and how tightly they line up (lower is straighter) */
  const edge = (xs: number[], left: boolean) => {
    const s = [...xs].sort((a, b) => a - b)
    const limit = Math.trunc(s.length * (left ? 0.4 : 0.6))
    let best = { count: 0, spread: Infinity }, j = 0
    for (let i = 0; i < s.length; i++) {
      while (s[i] - s[j] > tol) j++
      if (!(left ? j <= limit : i >= limit)) continue
      const n = i - j + 1
      let sum = 0
      for (let k = j; k <= i; k++) sum += s[k]
      const mean = sum / n
      let dev = 0
      for (let k = j; k <= i; k++) dev += Math.abs(s[k] - mean)
      const spread = dev / n
      if (n > best.count || (n === best.count && spread < best.spread)) best = { count: n, spread }
    }
    return best
  }
  let best = { count: -1, spread: Infinity, tilt: 0 }
  // ±10° in quarter degrees, straight first
  const steps = [0]
  for (let k = 1; k <= 40; k++) steps.push(k, -k)
  for (const step of steps) {
    const t = Math.tan(step * 0.25 * Math.PI / 180)
    const l = edge(pieces.map((p) => p.minX + t * p.midY), true)
    const r = edge(pieces.map((p) => p.maxX + t * p.midY), false)
    const count = l.count + r.count, spread = l.spread + r.spread
    // more edges in line, or as many standing straighter
    if (count > best.count || (count === best.count && spread < best.spread - 0.01)) best = { count, spread, tilt: t }
  }
  return best.tilt
}

/* pieces → printed lines, top first */
export function lines(pieces: Piece[], t: number): string[] {
  if (!pieces.length) return []
  // a piece's own height, less what the tilt adds across its width
  const level = pieces.map((p) => ({ p: { ...p, height: Math.max(p.height - Math.abs(t) * (p.maxX - p.minX), p.height * 0.3) }, y: p.midY - t * p.midX }))
    .sort((a, b) => b.y - a.y)
  const rows: { y: number; h: number; items: Piece[] }[] = []
  for (const { p, y } of level) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(last.y - y) < 0.5 * Math.min(last.h, p.height)) {
      const n = last.items.length
      last.y = (last.y * n + y) / (n + 1)
      last.h = Math.max(last.h, p.height)
      last.items.push(p)
    } else rows.push({ y, h: p.height, items: [p] })
  }
  return rows.map((r) => r.items.sort((a, b) => a.minX - b.minX).map((p) => p.text).join('  '))
}
