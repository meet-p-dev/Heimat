import type { Theme, Cat } from './types'

export const DK: Theme = { bg: '#0c1110', card: '#141b19', cardH: '#1d2623', border: '#2a3531', txt: '#eef3f1', txt2: '#a3b1ab', txt3: '#7e8e87', acc: '#14a978', accSoft: '#16352a', green: '#3ddc97', red: '#fb7185', amber: '#f5b84e', inp: '#19211e' }
export const LT: Theme = { bg: '#f3f6f2', card: '#ffffff', cardH: '#f6f9f5', border: '#e4e8e1', txt: '#10201a', txt2: '#54635d', txt3: '#6b7973', acc: '#057d54', accSoft: '#dff2e8', green: '#08864f', red: '#c8362e', amber: '#9a6a12', inp: '#edf0eb' }
export const WORK = '#16c784'
export const GOLD = '#c8a24a'

// per-category accent colors (charts, dots, bars)
export const CAT_COLOR: Record<string, string> = {
  rent: '#3ddc97', groceries: '#c8a24a', utilities: '#5ec7a8', internet: '#6ba8e0',
  eatout: '#fb7185', transport: '#8aa0b4', household: '#b89ce0', other: '#7e8e87',
}
export const catColor = (id: string) => CAT_COLOR[id] || CAT_COLOR.other

/* a custom category carries its own color; built-ins come from CAT_COLOR */
export const colorOf = (c: Cat) => c.color || CAT_COLOR[c.id] || CAT_COLOR.other
