// The figures behind the Statistik page: one season of registrations turned
// into what the club's yearly report shows.
//
// Every registration filed under a jump day counts as a tandem, the same rows
// the Übersicht calendar counts and the Tagesabschluss pays out for. Whether
// it was paid is not a statistic: an unpaid tandem is a mistake to fix on the
// day, not a figure to report on.

import type { Prices } from './config'
import { collectedVia, voucherCovered } from './pricing'
import type { PricedFields } from './pricing'

export interface StatsRow {
  jump_date: string
  tandem_master_id: number | null
  camera_flyer_id: number | null
  extra_booking: string | null
  payment_method: string | null
  gender: string | null
  age: number | null
  city: string | null
  // Read only by moneyStats.
  price: number | null
  voucher_payment_method: string | null
  voucher_service: string | null
  voucher_check_status: string | null
  voucher_accepted: number | null
}

export interface DayCount {
  date: string
  count: number
}

export interface MasterStats {
  /** null: registrations without a tandem master. */
  name: string | null
  tandems: number
  days: number
  bestDay: DayCount
  video: number
  /** Tandems in the comparison period; set by the route. */
  previous: number | null
}

export interface FlyerStats {
  /** null: video booked, but no camera flyer entered. */
  name: string | null
  jumps: number
  days: number
  bestDay: DayCount
  videoPhoto: number
}

/** The headline figures the report compares year against year. */
export interface JumpTotals {
  tandems: number
  jumpDays: number
  video: number
  voucher: number
  /** Tandems per month, January first. */
  months: number[]
}

export interface Comparison {
  year: number
  /** 'MM-DD' the previous year was cut at, or null for the whole year. */
  asOf: string | null
}

export interface JumpStats extends JumpTotals {
  year: number
  /** Years with registrations; set by the route. */
  years: number[]
  firstDay: string | null
  lastDay: string | null
  busiestDay: DayCount | null
  /** Jump days per month, January first. */
  monthDays: number[]
  /** Monday first. */
  weekdays: { tandems: number; days: number }[]
  services: { none: number; video: number; video_photo: number }
  masters: MasterStats[]
  flyers: FlyerStats[]
  gender: { female: number; male: number; diverse: number }
  /** <18, 18–25, 26–35, 36–50, 51–65, >65. */
  ageGroups: number[]
  cities: { city: string; count: number }[]
  /** Set by the route when the comparison period has registrations. */
  previous: JumpTotals | null
  comparedTo: Comparison | null
}

const TOP_CITIES = 8
const AGE_LIMITS = [17, 25, 35, 50, 65]

export function hasVideo(row: StatsRow): boolean {
  return row.extra_booking === 'video' || row.extra_booking === 'video_photo'
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = groups.get(k)
    if (list) list.push(item)
    else groups.set(k, [item])
  }
  return groups
}

// The day with the most rows; on a tie the earlier day, so the answer does not
// depend on the order the rows were read in.
function busiest(rows: StatsRow[]): DayCount | null {
  let best: DayCount | null = null
  for (const [date, list] of groupBy(rows, r => r.jump_date)) {
    const d = date as string
    if (!best || list.length > best.count || (list.length === best.count && d < best.date)) {
      best = { date: d, count: list.length }
    }
  }
  return best
}

const dayCount = (rows: StatsRow[]) => new Set(rows.map(r => r.jump_date)).size

// Most first, then by name; the unassigned entry is a to-do, not a person, so
// it sits at the end wherever its count would put it.
function byCountThenName<T extends { name: string | null }>(count: (item: T) => number) {
  return (a: T, b: T) => {
    if (a.name === null) return 1
    if (b.name === null) return -1
    return count(b) - count(a) || a.name.localeCompare(b.name, 'de')
  }
}

function monthIndex(date: string): number {
  return Number(date.slice(5, 7)) - 1
}

function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

function ageGroup(age: number): number {
  const i = AGE_LIMITS.findIndex(limit => age <= limit)
  return i === -1 ? AGE_LIMITS.length : i
}

// Towns are typed by guests, so "Linz", "Linz " and "linz" are one town, shown
// in the spelling most guests used.
function topCities(rows: StatsRow[]): { city: string; count: number }[] {
  const towns = groupBy(rows.filter(r => r.city?.trim()), r => r.city!.trim().toLowerCase())
  return [...towns.values()]
    .map(list => {
      const spellings = groupBy(list, r => r.city!.trim())
      const [city] = [...spellings.entries()].sort(([a, x], [b, y]) => y.length - x.length || a!.localeCompare(b!, 'de'))[0]
      return { city: city as string, count: list.length }
    })
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, 'de'))
    .slice(0, TOP_CITIES)
}

export function jumpTotals(rows: StatsRow[]): JumpTotals {
  const months = Array<number>(12).fill(0)
  for (const r of rows) months[monthIndex(r.jump_date)]++
  return {
    tandems: rows.length,
    jumpDays: dayCount(rows),
    video: rows.filter(hasVideo).length,
    voucher: rows.filter(r => r.payment_method === 'voucher').length,
    months,
  }
}

export function jumpStats(
  rows: StatsRow[], masterNames: Map<number, string>, flyerNames: Map<number, string>, year: number,
): JumpStats {
  const dates = rows.map(r => r.jump_date).sort()

  const monthDays = Array<number>(12).fill(0)
  const weekdays = Array.from({ length: 7 }, () => ({ tandems: 0, days: 0 }))
  for (const [date, list] of groupBy(rows, r => r.jump_date)) {
    monthDays[monthIndex(date!)]++
    weekdays[weekdayIndex(date!)].tandems += list.length
    weekdays[weekdayIndex(date!)].days++
  }

  // An id the crew table no longer knows is treated like no id at all.
  const name = (id: number | null, names: Map<number, string>) =>
    (id != null && names.get(id)) || null

  const masters = [...groupBy(rows, r => name(r.tandem_master_id, masterNames)).entries()]
    .map(([n, list]): MasterStats => ({
      name: n, tandems: list.length, days: dayCount(list), bestDay: busiest(list)!,
      video: list.filter(hasVideo).length, previous: null,
    }))
    .sort(byCountThenName(m => m.tandems))

  const flyers = [...groupBy(rows.filter(hasVideo), r => name(r.camera_flyer_id, flyerNames)).entries()]
    .map(([n, list]): FlyerStats => ({
      name: n, jumps: list.length, days: dayCount(list), bestDay: busiest(list)!,
      videoPhoto: list.filter(r => r.extra_booking === 'video_photo').length,
    }))
    .sort(byCountThenName(f => f.jumps))

  const ageGroups = Array<number>(AGE_LIMITS.length + 1).fill(0)
  for (const r of rows) if (r.age != null && r.age > 0) ageGroups[ageGroup(r.age)]++

  const count = (test: (r: StatsRow) => boolean) => rows.filter(test).length

  return {
    ...jumpTotals(rows),
    year,
    years: [],
    firstDay: dates[0] ?? null,
    lastDay: dates[dates.length - 1] ?? null,
    busiestDay: busiest(rows),
    monthDays,
    weekdays,
    services: {
      none: count(r => !hasVideo(r)),
      video: count(r => r.extra_booking === 'video'),
      video_photo: count(r => r.extra_booking === 'video_photo'),
    },
    masters,
    flyers,
    gender: {
      female: count(r => r.gender === 'female'),
      male: count(r => r.gender === 'male'),
      diverse: count(r => r.gender === 'diverse'),
    },
    ageGroups,
    cities: topCities(rows),
    previous: null,
    comparedTo: null,
  }
}

// --- money --------------------------------------------------------------------

export interface MoneyTotals {
  /** Leistungswert: what was charged plus what the redeemed vouchers were worth. */
  value: number
  collected: number
  voucherValue: number
  /** Leistungswert per month, January first. */
  months: number[]
}

export interface MoneyStats extends MoneyTotals {
  year: number
  perTandem: number
  tills: { cash: number; card: number; unrecorded: number }
  /** Set by the route when the comparison period has registrations. */
  previous: MoneyTotals | null
  comparedTo: Comparison | null
}

// `price` is what the manifest charged, manual corrections included. A
// voucher's worth is not in it, so it is valued at the price list frozen for
// its own jump day — the same reading the manifest shows under the price.
export function moneyTotals(rows: StatsRow[], pricesFor: (date: string) => Prices): MoneyTotals {
  const months = Array<number>(12).fill(0)
  let collected = 0
  let voucherValue = 0
  for (const r of rows) {
    const charged = r.price ?? 0
    const covered = voucherCovered(r as PricedFields, pricesFor(r.jump_date))
    collected += charged
    voucherValue += covered
    months[monthIndex(r.jump_date)] += charged + covered
  }
  return { value: collected + voucherValue, collected, voucherValue, months }
}

export function moneyStats(rows: StatsRow[], pricesFor: (date: string) => Prices, year: number): MoneyStats {
  const totals = moneyTotals(rows, pricesFor)
  const tills = { cash: 0, card: 0, unrecorded: 0 }
  for (const r of rows) tills[collectedVia(r) ?? 'unrecorded'] += r.price ?? 0
  return {
    year,
    ...totals,
    perTandem: rows.length === 0 ? 0 : totals.value / rows.length,
    tills,
    previous: null,
    comparedTo: null,
  }
}
