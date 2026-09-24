import type { Theme, Cat } from './types'

/* Mirrors the tokens in index.css. The surface colours are translucent: the
   app sits on an ambient gradient and its cards are glass over it. */
export const DK: Theme = { bg: '#070b0a', card: 'rgba(255,255,255,.06)', cardH: 'rgba(255,255,255,.09)', border: 'rgba(255,255,255,.11)', txt: '#f1f6f4', txt2: '#a9b8b1', txt3: '#80918a', acc: '#2fd39a', onAcc: '#03140d', accSoft: 'rgba(47,211,154,.15)', green: '#3ddc97', red: '#ff7a8a', amber: '#f5b84e', inp: 'rgba(255,255,255,.06)' }
export const LT: Theme = { bg: '#eef2f0', card: 'rgba(255,255,255,.62)', cardH: 'rgba(255,255,255,.78)', border: 'rgba(13,26,21,.10)', txt: '#0d1a15', txt2: '#4b5a54', txt3: '#687670', acc: '#057d54', onAcc: '#ffffff', accSoft: 'rgba(5,125,84,.10)', green: '#08864f', red: '#c8362e', amber: '#9a6a12', inp: 'rgba(255,255,255,.66)' }
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
