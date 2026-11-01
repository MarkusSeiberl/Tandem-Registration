import { test, expect } from 'vitest'
import { jumpStats } from '../src/server/stats'
import type { StatsRow } from '../src/server/stats'

// One registration with only what a test sets; the rest is what an untouched row holds.
function row(overrides: Partial<StatsRow> = {}): StatsRow {
  return {
    jump_date: '2026-06-06',
    tandem_master_id: null,
    camera_flyer_id: null,
    extra_booking: null,
    payment_method: null,
    gender: null,
    age: null,
    city: null,
    price: null,
    voucher_payment_method: null,
    voucher_service: null,
    voucher_check_status: null,
    voucher_accepted: null,
    ...overrides,
  }
}

const rows = (n: number, overrides: Partial<StatsRow> = {}) =>
  Array.from({ length: n }, () => row(overrides))

const jump = (list: StatsRow[], masters = new Map<number, string>(), flyers = new Map<number, string>()) =>
  jumpStats(list, masters, flyers, 2026)

test('an empty year has zeros everywhere and no best anything', () => {
  const s = jump([])
  expect(s).toMatchObject({
    year: 2026, years: [], tandems: 0, jumpDays: 0, video: 0, voucher: 0,
    firstDay: null, lastDay: null, busiestDay: null,
    masters: [], flyers: [], cities: [], previous: null, comparedTo: null,
  })
  expect(s.months).toEqual(Array(12).fill(0))
  expect(s.monthDays).toEqual(Array(12).fill(0))
  expect(s.weekdays).toEqual(Array(7).fill({ tandems: 0, days: 0 }))
  expect(s.ageGroups).toEqual([0, 0, 0, 0, 0, 0])
})

test('counts tandems, days and the season', () => {
  const s = jump([
    row({ jump_date: '2026-04-11' }),
    ...rows(3, { jump_date: '2026-06-07' }),
    ...rows(3, { jump_date: '2026-06-06' }),
    row({ jump_date: '2026-10-24' }),
  ])
  expect(s).toMatchObject({
    tandems: 8, jumpDays: 4, firstDay: '2026-04-11', lastDay: '2026-10-24',
    // A tie goes to the earlier day, whatever order the rows came in.
    busiestDay: { date: '2026-06-06', count: 3 },
  })
})

test('months and weekdays', () => {
  // 6 June 2026 is a Saturday, 5 July a Sunday.
  const s = jump([...rows(2, { jump_date: '2026-06-06' }), row({ jump_date: '2026-07-05' })])
  expect(s.months[5]).toBe(2)
  expect(s.monthDays[5]).toBe(1)
  expect(s.months[6]).toBe(1)
  expect(s.weekdays[5]).toEqual({ tandems: 2, days: 1 })
  expect(s.weekdays[6]).toEqual({ tandems: 1, days: 1 })
})

test('ranks tandem masters, unassigned last', () => {
  const masters = new Map([[1, 'Anna'], [2, 'Bert']])
  const s = jump([
    ...rows(2, { tandem_master_id: 1 }),
    row({ tandem_master_id: 1, extra_booking: 'video' }),
    row({ tandem_master_id: 2 }),
    ...rows(5, { tandem_master_id: null }),
    // An id the crew table no longer knows reads like no master at all.
    row({ tandem_master_id: 99 }),
  ], masters)
  expect(s.masters.map(m => m.name)).toEqual(['Anna', 'Bert', null])
  expect(s.masters[0]).toEqual({
    name: 'Anna', tandems: 3, video: 1, days: 1,
    bestDay: { date: '2026-06-06', count: 3 }, previous: null,
  })
  expect(s.masters[2].tandems).toBe(6)
})

test('ranks camera flyers from video rows only', () => {
  const flyers = new Map([[1, 'Cara']])
  const s = jump([
    row({ camera_flyer_id: 1, extra_booking: 'video' }),
    ...rows(2, { camera_flyer_id: 1, extra_booking: 'video_photo' }),
    row({ camera_flyer_id: 1, extra_booking: 'none' }),
  ], new Map(), flyers)
  expect(s.flyers).toEqual([{
    name: 'Cara', jumps: 3, videoPhoto: 2, days: 1, bestDay: { date: '2026-06-06', count: 3 },
  }])
})

test('services, gender and voucher', () => {
  const s = jump([
    row({ extra_booking: 'none', gender: 'female', payment_method: 'voucher' }),
    row({ extra_booking: 'video', gender: 'male', payment_method: 'cash' }),
    row({ extra_booking: 'video_photo', gender: 'female', payment_method: 'card' }),
    row({ extra_booking: null, gender: 'diverse' }),
  ])
  expect(s.services).toEqual({ none: 2, video: 1, video_photo: 1 })
  expect(s.video).toBe(2)
  expect(s.voucher).toBe(1)
  expect(s.gender).toEqual({ female: 2, male: 1, diverse: 1 })
})

test('age groups', () => {
  const s = jump([17, 18, 25, 26, 50, 51, 66, null, 0].map(age => row({ age })))
  expect(s.ageGroups).toEqual([1, 2, 1, 1, 1, 1])
})

test('merges town spellings', () => {
  const s = jump(['Linz', 'Linz ', 'linz', 'Freistadt', '  ', null].map(city => row({ city })))
  expect(s.cities).toEqual([{ city: 'Linz', count: 3 }, { city: 'Freistadt', count: 1 }])
})

test('lists at most eight towns', () => {
  const s = jump(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map(city => row({ city })))
  expect(s.cities).toHaveLength(8)
})
