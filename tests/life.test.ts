/*
  Which parts of the app someone sees, from the onboarding questions
  (src/lib/life.ts; Life in ios-native/Heimat/Models.swift follows the same rules).
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggested, partOn, withPart, withAnswers, PARTS } from '../src/lib/life.ts'
import type { Profile } from '../src/lib/types.ts'

const on = (share: string[], doing: string[]) =>
  PARTS.filter(([p]) => suggested(p, share, doing)).map(([p]) => p).join(',')

test('before the questions, everything stays on', () => {
  for (const [p] of PARTS) assert.equal(suggested(p, undefined, undefined), true)
})

test('who you are decides what you see', () => {
  assert.equal(on([], ['salaried']), 'bills')
  assert.equal(on(['flatmates'], ['study', 'shifts']), 'groups,bills,chores,list,work,limit,runway')
  assert.equal(on(['partner'], ['salaried']), 'groups,bills,chores,list')
  assert.equal(on(['friends'], ['study']), 'groups,bills,runway')
  assert.equal(on(['family'], ['shifts']), 'groups,bills,chores,list,work')
  assert.equal(on([], ['looking']), 'bills,runway')
})

test('a hand-made switch wins, and is forgotten when it agrees with the answers', () => {
  const p: Profile = { onboarded: true, share: [], doing: ['salaried'] }
  const q = withPart(p, 'chores', true)
  assert.equal(partOn(q, 'chores'), true)
  assert.deepEqual(q.parts, { chores: true })
  assert.equal(withPart(q, 'chores', false).parts, undefined)
})

test('answering one question for the first time keeps the other sensible', () => {
  const p = withAnswers({ onboarded: true }, 'share', ['partner', 'flatmates'])
  assert.deepEqual(p.share, ['flatmates', 'partner'])
  assert.deepEqual(p.doing, ['study', 'shifts'])
})
