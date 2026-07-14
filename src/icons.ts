import {
  Home, ShoppingCart, Zap, Wifi, UtensilsCrossed, TrainFront, SprayCan, Package, Users, Wallet, Clock, User,
  Tag, ShoppingBag, Shirt, Pill, Dumbbell, Gift, PawPrint, Baby, Wrench, Sparkles, Coffee, Beer,
  Cigarette, Film, Plane, BookOpen, Trash,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TabId, Cat } from './lib/types'

export const CAT_ICON: Record<string, LucideIcon> = {
  rent: Home, groceries: ShoppingCart, utilities: Zap, internet: Wifi,
  eatout: UtensilsCrossed, transport: TrainFront, household: SprayCan, other: Package,
}

/* icons a user can pick for a custom category — must be statically imported to survive tree-shaking */
export const ICON_CHOICES: Record<string, LucideIcon> = {
  tag: Tag, bag: ShoppingBag, cart: ShoppingCart, shirt: Shirt, pill: Pill, gym: Dumbbell,
  gift: Gift, pet: PawPrint, baby: Baby, tools: Wrench, clean: Sparkles, coffee: Coffee,
  beer: Beer, smoke: Cigarette, film: Film, plane: Plane, book: BookOpen, trash: Trash,
}

/* colors a user can pick for a custom category */
export const COLOR_CHOICES = [
  '#3ddc97', '#c8a24a', '#5ec7a8', '#6ba8e0', '#fb7185',
  '#8aa0b4', '#b89ce0', '#f5b84e', '#14a978', '#e08a6b',
]

/* resolve a category's icon: custom categories carry an icon name, built-ins use CAT_ICON */
export const iconOf = (c: Cat): LucideIcon =>
  (c.icon && ICON_CHOICES[c.icon]) || CAT_ICON[c.id] || CAT_ICON.other

export const NAV_ICON: Record<TabId, LucideIcon> = {
  home: Home, flat: Users, money: Wallet, work: Clock, me: User,
}
