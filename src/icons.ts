import { Home, ShoppingCart, Zap, Wifi, UtensilsCrossed, TrainFront, SprayCan, Package, Users, Wallet, Clock, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TabId } from './lib/types'

export const CAT_ICON: Record<string, LucideIcon> = {
  rent: Home, groceries: ShoppingCart, utilities: Zap, internet: Wifi,
  eatout: UtensilsCrossed, transport: TrainFront, household: SprayCan, other: Package,
}

export const NAV_ICON: Record<TabId, LucideIcon> = {
  home: Home, flat: Users, money: Wallet, work: Clock, me: User,
}
