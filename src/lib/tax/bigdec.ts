/* Exactly the part of Java's BigDecimal that the Finance Ministry's payroll-tax plan
   (Programmablaufplan, PAP) is written in — so the generated code (lohnsteuer2026.gen.ts)
   computes digit for digit what every German payroll program computes. A number is an
   integer `u` (unscaled) with `scale` decimals: 12.50 = { u: 1250n, scale: 2 }.
   No floating point anywhere once a value is in. */

const P10 = (n: number) => 10n ** BigInt(n)

export class BigDecimal {
  readonly u: bigint
  readonly scale: number
  constructor(u: bigint, scale: number) { this.u = u; this.scale = scale }

  static readonly ROUND_UP = 0     // away from zero
  static readonly ROUND_DOWN = 1   // towards zero
  static readonly ZERO = new BigDecimal(0n, 0)
  static readonly ONE = new BigDecimal(1n, 0)
  static readonly TEN = new BigDecimal(10n, 0)

  /* Java's valueOf(double) goes through Double.toString, valueOf(long) is exact; for the
     literals in the PAP both are the shortest decimal that names the number */
  static valueOf(v: number | bigint | string | BigDecimal): BigDecimal {
    if (v instanceof BigDecimal) return v
    if (typeof v === 'string') return BigDecimal.parse(v)
    if (typeof v === 'bigint') return new BigDecimal(v, 0)
    if (!Number.isFinite(v)) throw new Error('BigDecimal.valueOf: not a number')
    if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return new BigDecimal(BigInt(v), 0)
    return BigDecimal.parse(String(v))
  }

  static parse(s: string): BigDecimal {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s.trim())
    if (!m) throw new Error(`BigDecimal.parse: ${s}`)
    const frac = m[3] || ''
    let scale = frac.length - (m[4] ? parseInt(m[4], 10) : 0)
    let u = BigInt((m[2] || '0') + frac)
    if (scale < 0) { u *= P10(-scale); scale = 0 }
    return new BigDecimal(m[1] === '-' ? -u : u, scale)
  }

  private at(scale: number): bigint {
    return scale >= this.scale ? this.u * P10(scale - this.scale) : this.u / P10(this.scale - scale)
  }

  add(o: BigDecimal): BigDecimal { const s = Math.max(this.scale, o.scale); return new BigDecimal(this.at(s) + o.at(s), s) }
  subtract(o: BigDecimal): BigDecimal { const s = Math.max(this.scale, o.scale); return new BigDecimal(this.at(s) - o.at(s), s) }
  multiply(o: BigDecimal): BigDecimal { return new BigDecimal(this.u * o.u, this.scale + o.scale) }

  compareTo(o: BigDecimal): -1 | 0 | 1 {
    const s = Math.max(this.scale, o.scale)
    const a = this.at(s), b = o.at(s)
    return a < b ? -1 : a > b ? 1 : 0
  }

  setScale(scale: number, mode: number): BigDecimal {
    if (scale >= this.scale) return new BigDecimal(this.at(scale), scale)
    const d = P10(this.scale - scale)
    const q = this.u / d, r = this.u % d                      // bigint division truncates towards zero
    return new BigDecimal(mode === BigDecimal.ROUND_UP && r !== 0n ? q + (this.u < 0n ? -1n : 1n) : q, scale)
  }

  /* divide(x, scale, mode) rounds to that scale; divide(x) must be exact, as in Java
     (which throws on a quotient that never ends) */
  divide(o: BigDecimal, scale?: number, mode?: number): BigDecimal {
    if (o.u === 0n) throw new Error('BigDecimal.divide: by zero')
    if (scale === undefined) {
      // the smallest number of decimals that holds the quotient exactly (every later rounding
      // in the PAP is explicit, so only the value matters, not how many trailing zeros it keeps)
      for (let s = 0; s <= 40; s++) {
        const num = this.u * P10(s + o.scale), den = o.u * P10(this.scale)
        if (num % den === 0n) return new BigDecimal(num / den, s)
      }
      throw new Error('BigDecimal.divide: non-terminating decimal expansion')
    }
    // the exact quotient at scale+1 decides nothing on its own; do it on the integers
    const num = this.u * P10(scale + o.scale), den = o.u * P10(this.scale)
    const q = num / den, r = num % den
    return new BigDecimal(mode === BigDecimal.ROUND_UP && r !== 0n ? q + ((num < 0n) !== (den < 0n) ? -1n : 1n) : q, scale)
  }

  longValue(): number { return Number(this.at(0)) }
  toNumber(): number { return Number(this.u) / Number(P10(this.scale)) }
  toString(): string {
    const neg = this.u < 0n, a = (neg ? -this.u : this.u).toString().padStart(this.scale + 1, '0')
    return (neg ? '-' : '') + (this.scale ? `${a.slice(0, -this.scale)}.${a.slice(-this.scale)}` : a)
  }
}
