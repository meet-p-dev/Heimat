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
  /* the questions (src/lib/life.ts): who you share costs with, what you do — absent until answered */
  share?: string[]
  doing?: string[]
  /* parts switched on or off by hand in Settings */
  parts?: Partial<Record<string, boolean>>
  /* tax details for the monthly estimate (src/lib/tax/estimate.ts), and each employer's kind */
  tax?: { taxClass: number; church: boolean; churchRate: number; kvz: number; children: number; over23: boolean; sachsen: boolean; minijobPensionOptOut: boolean }
  jobs?: Record<string, { kind: 'minijob' | 'werkstudent' | 'shortterm' | 'regular'; main: boolean }>
}

export interface Flat { id: string; name: string; join_code: string; kind?: string; simplify_debts?: boolean }
export interface Member {
  id?: string
  user_id: string; flat_id: string; display_name: string
  /* a pending invite's link (invite.html?t=…), and whether its email went out */
  invite_token?: string | null; invite_sent_at?: string | null; invite_error?: string | null
  /* set when they left or were removed; the row stays so past expenses still add up */
  left_at?: string | null
  /* a pending invite has an email and no claim yet */
  claimed_at?: string | null; invite_email?: string | null
}
export const hasLeft = (m: Member) => !!m.left_at
/* invited, not on Splitlife yet — by email, or by a link sent to them */
export const isPending = (m: Member) => !m.claimed_at && (!!m.invite_email || !!m.invite_token)

export type SplitType = 'equal' | 'exact' | 'percent' | 'shares' | 'adjust' | 'itemized'

/* the inputs of a split, as the database stores them in expenses.split (see lib/ledger.ts):
   exact — minor units per person; percent — basis points per person (10000 = 100 %);
   shares — a weight per person (up to two decimals); adjust — ± minor units per person on
   top of an equal split of the rest; itemized — receipt lines plus tax, tip and discount */
export interface SplitItem { label?: string; minor: number; among: string[] }
export interface SplitData {
  values?: Record<string, number>
  items?: SplitItem[]; tax?: number; tip?: number; discount?: number
}

export interface Expense {
  id: string; flat_id: string; description: string; amount: number; currency: string
  paid_by: string; split_among: string[]; category: string; created_by: string; spent_on: string
  /* engine v2 — all optional, so rows written before it and by older apps still read */
  split_type?: SplitType | null
  split?: SplitData | null
  /* who paid how much, in minor units, when more than one person did; null: paid_by paid it all */
  payers?: Record<string, number> | null
  /* what each person owes for it, in minor units, worked out by the database from the split — authoritative */
  shares?: Record<string, number> | null
  recurring_id?: string | null
  deleted_at?: string | null
}

export interface Settlement {
  id: string; flat_id: string; from_user: string; to_user: string
  amount: number; created_by: string; settled_on: string
  /* null on rows from before currencies were recorded: the flat's own currency */
  currency?: string | null
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'

export interface RecurringExpense {
  id: string; flat_id: string; created_by: string; description: string; amount: number; currency: string
  paid_by: string; payers?: Record<string, number> | null; split_among: string[]
  split_type: SplitType; split?: SplitData | null; category: string
  cadence: Cadence; anchor_on: string; next_n: number; until_on?: string | null; active: boolean
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
/* pushed pages: the personal ones, and inside Groups a group, Non-group expenses or one person */
export type PageId = 'profile' | 'settings' | `group:${string}` | 'nongroup' | `person:${string}` | 'mybills'
export type AuthMode = 'signup' | 'signin' | 'forgot' | 'reset' | 'password' | 'email'
export type ModalId = null | 'exp' | 'expdetail' | 'settle' | 'invite' | 'create' | 'join' | 'runway' | 'shift' | 'pickflat' | 'analytics' | 'profile' | 'cats' | 'settleperson' | 'bill' | 'chore'
