import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/* Real refraction needs an SVG filter running as a backdrop-filter. Chromium
   (Chrome, Edge, the Android app's WebView) can do that; WebKit (Safari and the
   iOS app) cannot, and keeps the blur-only glass from index.css. */
export const canRefract: boolean = (() => {
  try {
    const ua = navigator.userAgent
    if (/iPhone|iPad|iPod/.test(ua) || !/Chrome\/|Chromium\//.test(ua)) return false
    return CSS.supports('backdrop-filter', 'url(#a)')
  } catch {
    return false
  }
})()

/* Displacement map for a rounded rectangle: neutral grey in the middle and,
   towards the rim, a vector along the edge normal that is strongest right at the
   edge. Through feDisplacementMap it bends the backdrop the way a thick glass
   bezel bends light. Drawn at half resolution; the filter stretches it back. */
function bezelMap(w: number, h: number, radius: number, bezel: number): string {
  const s = 0.5
  const W = Math.max(2, Math.round(w * s))
  const H = Math.max(2, Math.round(h * s))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(W, H)
  const d = img.data
  const hw = w / 2, hh = h / 2, r = Math.min(radius, hw, hh)
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const px = (i + 0.5) / s - hw, py = (j + 0.5) / s - hh
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r)
      let depth: number, nx: number, ny: number
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; depth = r - l; nx = qx / l; ny = qy / l }
      else if (qx > qy) { depth = r - qx; nx = 1; ny = 0 }
      else { depth = r - qy; nx = 0; ny = 1 }
      if (px < 0) nx = -nx
      if (py < 0) ny = -ny
      const m = Math.pow(1 - Math.min(Math.max(depth / bezel, 0), 1), 2)
      const k = (j * W + i) * 4
      d[k] = 128 + nx * m * 127
      d[k + 1] = 128 + ny * m * 127
      d[k + 2] = 128
      d[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv.toDataURL()
}

/* A glass surface whose rim refracts what scrolls beneath it, with a touch of
   chromatic aberration (red, green and blue bent by slightly different amounts).
   Where refraction is unavailable it is the ordinary strong glass. */
export default function LiquidGlass({ radius, className = '', style, children, scale = 40, bezel = 18, blur = 4 }: {
  radius: number; className?: string; style?: CSSProperties; children?: ReactNode
  scale?: number; bezel?: number; blur?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = 'lg' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!canRefract || !el) return
    const measure = () => {
      const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight)
      setSize((p) => (p && p.w === w && p.h === h ? p : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const map = useMemo(() => (size && size.w > 0 && size.h > 0 ? bezelMap(size.w, size.h, radius, bezel) : ''), [size, radius, bezel])
  const bf = map ? `url(#${id}) blur(${blur}px) saturate(185%) brightness(1.04)` : undefined

  return (
    <div ref={ref} className={`glass glass-strong${map ? ' lg-on' : ''} ${className}`} style={{ borderRadius: radius, ...style, ...(bf ? { backdropFilter: bf, WebkitBackdropFilter: bf } : null) }}>
      {map && size && (
        <svg width="0" height="0" style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true" focusable="false">
          <filter id={id} x="0" y="0" width={size.w} height={size.h} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feImage href={map} x="0" y="0" width={size.w} height={size.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" result="dr" />
            <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={scale * 0.92} xChannelSelector="R" yChannelSelector="G" result="dg" />
            <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={scale * 0.84} xChannelSelector="R" yChannelSelector="G" result="db" />
            <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feBlend in="r" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b" mode="screen" />
          </filter>
        </svg>
      )}
      {children}
    </div>
  )
}
