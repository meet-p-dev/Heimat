import type { Profile } from './types'

/* Who someone is, in the questions from onboarding, and the parts of the app that
   follow from it — the same rules as Life in ios-native/Heimat/Models.swift (the
   web also has the money runway, which iOS doesn't show). Hiding a part never
   deletes anything. */

export type Share = 'flatmates' | 'partner' | 'family' | 'friends'
export type Doing = 'study' | 'shifts' | 'salaried' | 'looking'
export type Part = 'groups' | 'bills' | 'chores' | 'list' | 'work' | 'limit' | 'runway'

export const SHARES: [Share, string][] = [['flatmates', 'Flatmates'], ['partner', 'Partner'], ['family', 'Family & kids'], ['friends', 'Friends']]
export const DOINGS: [Doing, string][] = [['study', 'Studying'], ['shifts', 'Job with shifts or hours'], ['salaried', 'Salaried job'], ['looking', 'Looking for work']]
export const PARTS: [Part, string, string][] = [
  ['groups', 'Shared expenses', 'Groups, friends and settling up'],
  ['bills', 'Bills', 'Rent, phone, insurance — reminders and ticks'],
  ['chores', 'Chores rota', 'Whose turn it is, and points'],
  ['list', 'Shopping list', 'One list for the household'],
  ['work', 'Shifts & pay', 'Log shifts and see your pay'],
  ['limit', 'Work limit', "Stay under a student visa's hours"],
  ['runway', 'Money runway', 'How long your money lasts'],
]

/* what the answers suggest; before the questions were asked, everything stays on */
export function suggested(part: Part, share?: string[], doing?: string[]): boolean {
  if (!share || !doing) return true
  const home = share.some((s) => s === 'flatmates' || s === 'partner' || s === 'family')
  switch (part) {
    case 'groups': return share.length > 0
    case 'bills': return true
    case 'chores': case 'list': return home
    case 'work': return doing.includes('shifts')
    case 'limit': return doing.includes('study') && doing.includes('shifts')
    case 'runway': return doing.includes('study') || doing.includes('looking')
  }
}

/* a hand-made choice from Settings first, else the suggestion */
export const partOn = (p: Profile, part: Part) => p.parts?.[part] ?? suggested(part, p.share, p.doing)

/* flip a part by hand, remembering it only when it differs from the suggestion */
export function withPart(p: Profile, part: Part, on: boolean): Profile {
  const o = { ...(p.parts || {}) }
  if (on === suggested(part, p.share, p.doing)) delete o[part]; else o[part] = on
  return { ...p, parts: Object.keys(o).length ? o : undefined }
}

/* a new set of answers to one question; someone from before the questions gets the
   other one as what Splitlife was made for (a student with a job, in a shared flat) */
export function withAnswers(p: Profile, key: 'share' | 'doing', v: string[]): Profile {
  const order = (key === 'share' ? SHARES : DOINGS).map(([k]) => k as string)
  return {
    ...p,
    share: p.share ?? ['flatmates'],
    doing: p.doing ?? ['study', 'shifts'],
    [key]: order.filter((k) => v.includes(k)),
  }
}
