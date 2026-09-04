/* Draws the Heimat mark (the same one as public/favicon.svg) at store sizes.
   No image libraries: the mark is a rounded rect plus three round-capped
   strokes, so it is drawn from signed distance fields and written out as PNG.
   Run with `npm run assets:source`, then `npx @capacitor/assets generate`. */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'

const BG = [0x0c, 0x11, 0x10]      // #0c1110 — the app's dark ground
const ACC = [0x3d, 0xdc, 0x97]     // #3ddc97 — Heimat green

/* ---- tiny PNG writer ---- */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const writePNG = (path, w, h, rgba) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // 8-bit RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // no per-scanline filter
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

/* ---- drawing ---- */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const sdRoundRect = (px, py, cx, cy, halfW, halfH, r) => {
  const dx = Math.max(Math.abs(px - cx) - halfW + r, 0)
  const dy = Math.max(Math.abs(py - cy) - halfH + r, 0)
  return Math.hypot(dx, dy) - r
}
const sdCapsule = (px, py, ax, ay, bx, by, r) => {
  const vx = bx - ax, vy = by - ay
  const t = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1))
  return Math.hypot(px - ax - vx * t, py - ay - vy * t) - r
}

const canvas = (w, h, bg) => {
  const buf = Buffer.alloc(w * h * 4)
  if (bg) for (let i = 0; i < w * h; i++) { buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255 }
  return buf
}
const paint = (buf, w, h, color, sd) => {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = clamp01(0.5 - sd(x + 0.5, y + 0.5)) // 1px analytic anti-aliasing
      if (a <= 0) continue
      const i = (y * w + x) * 4
      const dstA = buf[i + 3] / 255
      const outA = a + dstA * (1 - a)
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round((color[c] * a + buf[i + c] * dstA * (1 - a)) / (outA || 1))
      buf[i + 3] = Math.round(outA * 255)
    }
  }
}

/* the mark, in the favicon's own 64-unit coordinate space, centred on the canvas */
const drawMark = (buf, w, h, size, color = ACC, cx = w / 2, cy = h / 2) => {
  const u = size / 64 // one favicon unit in pixels
  const X = (v) => cx + (v - 32) * u
  const Y = (v) => cy + (v - 32) * u
  const r = 3 * u    // stroke-width 6, round caps
  const strokes = [[21, 17, 21, 47], [43, 17, 43, 47], [21, 32, 43, 32]]
  for (const [ax, ay, bx, by] of strokes) {
    paint(buf, w, h, color, (px, py) => sdCapsule(px, py, X(ax), Y(ay), X(bx), Y(by), r))
  }
}

mkdirSync('assets', { recursive: true })

/* App icon — full bleed, no transparency (both stores reject alpha in the store icon) */
{
  const N = 1024
  const buf = canvas(N, N, BG)
  drawMark(buf, N, N, N)
  writePNG('assets/icon.png', N, N, buf)
  writePNG('assets/icon-only.png', N, N, buf)
}

/* Android adaptive icon — foreground on transparent. @capacitor/assets insets both
   layers by 16.7%, so this 1024px square becomes the 72dp visible viewport and the
   mark can keep the same framing it has in the full-bleed icon. */
{
  const N = 1024
  const fg = canvas(N, N, null)
  drawMark(fg, N, N, N)
  writePNG('assets/icon-foreground.png', N, N, fg)
  writePNG('assets/icon-background.png', N, N, canvas(N, N, BG))
}

/* Splash — one square that gets cropped to every device aspect ratio */
for (const name of ['splash.png', 'splash-dark.png']) {
  const N = 2732
  const buf = canvas(N, N, BG)
  drawMark(buf, N, N, N * 0.22)
  writePNG(`assets/${name}`, N, N, buf)
}

/* Android themed ("monochrome") icon: the launcher tints it, so it is drawn white
   on transparent straight into the res/ tree at every density. */
if (existsSync('android/app/src/main/res')) {
  const dp = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
  for (const [density, N] of Object.entries(dp)) {
    const dir = `android/app/src/main/res/mipmap-${density}`
    if (!existsSync(dir)) continue
    const buf = canvas(N, N, null)
    // inset by the same 16.7% as the other layers, so it shares their framing
    drawMark(buf, N, N, N, [0xff, 0xff, 0xff])
    writePNG(`${dir}/ic_launcher_monochrome.png`, N, N, buf)
  }
  console.log('wrote android monochrome launcher icons')
}

/* Android status-bar icon: the system draws it as a white silhouette, so it is
   white on transparent and sized to fill the 24dp notification box. */
if (existsSync('android/app/src/main/res')) {
  const dp = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 }
  for (const [density, N] of Object.entries(dp)) {
    const dir = `android/app/src/main/res/drawable-${density}`
    mkdirSync(dir, { recursive: true })
    const buf = canvas(N, N, null)
    drawMark(buf, N, N, N * 1.3, [0xff, 0xff, 0xff])
    writePNG(`${dir}/ic_stat_heimat.png`, N, N, buf)
  }
  console.log('wrote android notification icons')
}

console.log('wrote assets/{icon,icon-only,icon-foreground,icon-background,splash,splash-dark}.png')
