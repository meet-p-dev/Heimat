export type Theme = {
  bg: string; card: string; cardH: string; border: string
  txt: string; txt2: string; txt3: string
  acc: string; onAcc: string; accSoft: string; green: string; red: string; amber: string; inp: string
}

export interface Country { n: string; c: string; iso: string }
/* icon/color are set for user-defined categories; built-ins fall back to the static maps */
export interface Cat { id: string; label: string; icon?: string; color?: string; custom?: boolean }

/* a user-defined category, shared across the flat */
export interface FlatCategory {
  id: string; flat_id: string; key: string; label: string; icon: string; color: string
  created_by: string; created_at: string
}

export interface Profile {
  name?: string
  avatar?: string // avatar colour
  homeCountry?: string; homeCur?: string; homeIso?: string
  hostCountry?: string; hostCur?: string; hostIso?: string
  rate?: number
  rateAt?: string
  onboarded: boolean
}

export interface Flat { id: string; name: string; join_code: string }
export interface Member {
  user_id: string; flat_id: string; display_name: string
  /* set when they left or were removed; the row stays so past expenses still add up */
  left_at?: string | null
  /* a pending invite has an email and no claim yet */
  claimed_at?: string | null; invite_email?: string | null
}
export const hasLeft = (m: Member) => !!m.left_at
export const isPending = (m: Member) => !!m.invite_email && !m.claimed_at

export interface Expense {
  id: string; flat_id: string; description: string; amount: number; currency: string
  paid_by: string; split_among: string[]; category: string; created_by: string; spent_on: string
}

export interface Settlement {
  id: string; flat_id: string; from_user: string; to_user: string
  amount: number; created_by: string; settled_on: string
}

export interface ListItem {
  id: string; flat_id: string; title: string; category: string; added_by: string
  bought: boolean; bought_by: string | null; bought_at: string | null; created_at: string
}

export interface Shift {
  id: string; date: string; employer: string; start: string; end: string
  breakMin: number; paidBreak: boolean; wage: number; hours?: number; pay?: number
}

export interface Runway { total: number; start: string; monthly: number; targetMonths: number }

export interface Derived { paidHours: number; legalHours: number; pay: number; wage: number; overnight: boolean }

export type TabId = 'home' | 'flat' | 'money' | 'work'
export type PageId = 'profile' | 'settings'
export type AuthMode = 'signup' | 'signin' | 'forgot' | 'reset' | 'password' | 'email'
export type ModalId = null | 'exp' | 'expdetail' | 'settle' | 'invite' | 'create' | 'join' | 'runway' | 'shift' | 'pickflat' | 'analytics' | 'profile' | 'cats'
