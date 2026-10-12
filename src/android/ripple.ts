/* Material's touch ripple, for the Android build: a circle that grows from the
   finger across whatever was pressed, and fades when it lets go. One listener
   for the whole app, so no screen has to know about it. The navigation bar's
   ripple stays inside the pill behind its icon, as Pixel's does. */
const PRESSABLE = '.btn,.h-icbtn,.h-qa,.chip,.h-item,.h-tab,.h-press,.h-avbtn,.m-fab,.h-seg button'

function ripple(e: PointerEvent) {
  if (document.documentElement.dataset.os !== 'android' || e.button > 0) return
  let host = (e.target as Element | null)?.closest<HTMLElement>(PRESSABLE)
  if (!host || (host as HTMLButtonElement).disabled) return
  if (host.classList.contains('h-tab')) host = host.querySelector<HTMLElement>('.msym') || host
  const r = host.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  const d = 2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y))
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  host.style.overflow = 'hidden'
  host.style.isolation = 'isolate'
  const s = document.createElement('span')
  s.className = 'm-ripple'
  s.style.cssText = `width:${d}px;height:${d}px;left:${x - d / 2}px;top:${y - d / 2}px`
  host.appendChild(s)
  const end = () => {
    s.classList.add('out')
    setTimeout(() => s.remove(), 360)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
  }
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

if (typeof window !== 'undefined') window.addEventListener('pointerdown', ripple, { passive: true })
export {}
