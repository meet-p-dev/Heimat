export type Theme = {
  bg: string; card: string; cardH: string; border: string
  txt: string; txt2: string; txt3: string
  acc: string; accSoft: string; green: string; red: string; amber: string; inp: string
}

export interface Country { n: string; c: string; iso: string }
export interface Cat { id: string; label: string }

export interface Profile {
  name?: string
  homeCountry?: string; homeCur?: string; homeIso?: string
  hostCountry?: string; hostCur?: string; hostIso?: string
  rate?: number
  onboarded: boolean
}

export interface Flat { id: string; name: string; join_code: string }
export interface Member { user_id: string; flat_id: string; display_name: string }

export interface Expense {
  id: string; flat_id: string; description: string; amount: number; currency: string
  paid_by: string; split_among: string[]; category: string; created_by: string; spent_on: string
}

export interface Settlement {
  id: string; flat_id: string; from_user: string; to_user: string
  amount: number; created_by: string; settled_on: string
}

export interface Shift {
  id: string; date: string; employer: string; start: string; end: string
  breakMin: number; paidBreak: boolean; wage: number; hours?: number; pay?: number
}

export interface Runway { total: number; start: string; monthly: number; targetMonths: number }

export interface Derived { paidHours: number; legalHours: number; pay: number; wage: number; overnight: boolean }

export type TabId = 'home' | 'flat' | 'money' | 'work' | 'me'
export type ModalId = null | 'exp' | 'settle' | 'invite' | 'create' | 'join' | 'runway' | 'shift' | 'pickflat'
