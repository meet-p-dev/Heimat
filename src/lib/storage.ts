export const LS = {
  g<T = unknown>(k: string): T | null {
    try {
      const v = localStorage.getItem(k)
      return v ? (JSON.parse(v) as T) : null
    } catch {
      return null
    }
  },
  s(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {}
  },
}
