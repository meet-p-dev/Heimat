/*
  The payroll tax plan (src/lib/tax/lohnsteuer2026.gen.ts, generated from the Finance
  Ministry's own pseudo-code) against the Ministry's own calculator: every output, to the
  cent, for every case in tests/lohnsteuer-vectors.json (scripts/fetch-lohnsteuer-vectors.py).
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lohnsteuer2026 } from '../src/lib/tax/lohnsteuer2026.gen.ts'

const v = JSON.parse(readFileSync(new URL('./lohnsteuer-vectors.json', import.meta.url), 'utf8'))

test(`payroll tax 2026: ${v.cases.length} cases, every output, against bmf-steuerrechner.de`, () => {
  let checked = 0
  for (const { in: i, out: o } of v.cases) {
    const r: any = lohnsteuer2026(i)
    for (const [k, want] of Object.entries(o)) {
      assert.equal(r[k].toString(), want, `${k} for ${JSON.stringify(i)}`)
      checked++
    }
  }
  assert.ok(checked > 3000)
})
