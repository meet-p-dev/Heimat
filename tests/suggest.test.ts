/*
  The category suggested while typing (src/lib/suggest.ts). The iPhone app
  (ios-native/Heimat/Suggest.swift) is held to the same vectors by
  scripts/test-ledger-swift.sh.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { builtinCategory, learn, suggestCategory } from '../src/lib/suggest.ts'

const v = JSON.parse(readFileSync(new URL('./suggest-vectors.json', import.meta.url), 'utf8'))

test('shops and everyday words', () => {
  for (const [text, want] of v.builtin) assert.equal(builtinCategory(text), want, text)
})

test('what you chose before wins, newest first', () => {
  const l = learn(v.learned.history)
  for (const [text, want] of v.learned.cases) assert.equal(suggestCategory(text, l), want, text)
})
