import type { Country, Cat } from './types'

export const COUNTRIES: Country[] = [
  { n: 'India', c: 'INR', iso: 'in' }, { n: 'China', c: 'CNY', iso: 'cn' }, { n: 'Pakistan', c: 'PKR', iso: 'pk' },
  { n: 'Nigeria', c: 'NGN', iso: 'ng' }, { n: 'Turkey', c: 'TRY', iso: 'tr' }, { n: 'Iran', c: 'IRR', iso: 'ir' },
  { n: 'Bangladesh', c: 'BDT', iso: 'bd' }, { n: 'Indonesia', c: 'IDR', iso: 'id' }, { n: 'Egypt', c: 'EGP', iso: 'eg' },
  { n: 'Brazil', c: 'BRL', iso: 'br' }, { n: 'Vietnam', c: 'VND', iso: 'vn' }, { n: 'Mexico', c: 'MXN', iso: 'mx' },
  { n: 'Russia', c: 'RUB', iso: 'ru' }, { n: 'Ukraine', c: 'UAH', iso: 'ua' }, { n: 'Morocco', c: 'MAD', iso: 'ma' },
  { n: 'Ghana', c: 'GHS', iso: 'gh' }, { n: 'Kenya', c: 'KES', iso: 'ke' }, { n: 'Philippines', c: 'PHP', iso: 'ph' },
  { n: 'Nepal', c: 'NPR', iso: 'np' }, { n: 'Sri Lanka', c: 'LKR', iso: 'lk' }, { n: 'Colombia', c: 'COP', iso: 'co' },
  { n: 'Argentina', c: 'ARS', iso: 'ar' }, { n: 'South Africa', c: 'ZAR', iso: 'za' }, { n: 'Thailand', c: 'THB', iso: 'th' },
  { n: 'Malaysia', c: 'MYR', iso: 'my' }, { n: 'Saudi Arabia', c: 'SAR', iso: 'sa' }, { n: 'United States', c: 'USD', iso: 'us' },
  { n: 'United Kingdom', c: 'GBP', iso: 'gb' }, { n: 'Uzbekistan', c: 'UZS', iso: 'uz' }, { n: 'Georgia', c: 'GEL', iso: 'ge' },
  { n: 'Other / not listed', c: 'USD', iso: '' },
]

export const HOSTS: Country[] = [
  { n: 'Germany', c: 'EUR', iso: 'de' }, { n: 'Austria', c: 'EUR', iso: 'at' }, { n: 'Netherlands', c: 'EUR', iso: 'nl' },
  { n: 'France', c: 'EUR', iso: 'fr' }, { n: 'Italy', c: 'EUR', iso: 'it' }, { n: 'Spain', c: 'EUR', iso: 'es' },
  { n: 'United Kingdom', c: 'GBP', iso: 'gb' }, { n: 'United States', c: 'USD', iso: 'us' }, { n: 'Canada', c: 'CAD', iso: 'ca' },
  { n: 'Switzerland', c: 'CHF', iso: 'ch' }, { n: 'Sweden', c: 'SEK', iso: 'se' }, { n: 'Australia', c: 'AUD', iso: 'au' },
  { n: 'Poland', c: 'PLN', iso: 'pl' }, { n: 'Ireland', c: 'EUR', iso: 'ie' },
]

export const CATS: Cat[] = [
  { id: 'rent', label: 'Rent' }, { id: 'groceries', label: 'Groceries' },
  { id: 'utilities', label: 'Utilities' }, { id: 'internet', label: 'Internet' },
  { id: 'eatout', label: 'Eating out' }, { id: 'transport', label: 'Transport' },
  { id: 'household', label: 'Household' }, { id: 'other', label: 'Other' },
]

export const cat = (id: string): Cat => CATS.find((c) => c.id === id) || CATS[CATS.length - 1]
