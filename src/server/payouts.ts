import type { Payouts } from './config'

// What one person is owed for the day, with the arithmetic spelled out ("3 × 45,00 €")
// so the club can check the figure without recounting the rows above it.
export interface PayoutEntry {
  name: string
  calculation: string
  amount: number
}

export interface PayoutSection {
  title: string
  entries: PayoutEntry[]
  total: number
}

const UNASSIGNED_MASTER = 'ohne Tandemmaster'
const UNASSIGNED_FLYER = 'ohne Kameraflieger'

// Written here rather than via Intl so the string in the sheet is the string the
// tests pin — the packaged exe carries its own ICU data and must not drift from it.
export function formatEuro(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100)
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const frac = String(cents % 100).padStart(2, '0')
  return `${amount < 0 ? '-' : ''}${whole},${frac} €`
}

// One rate a person collected, plus how often. `order` fixes the sequence inside a
// calculation ("1 × 60,00 € + 1 × 80,00 €") independently of the row order and of
// which rate happens to be the larger amount.
interface Tally {
  order: number
  rate: number
  count: number
}

type Tallies = Map<string, Map<string, Tally>>

function record(tallies: Tallies, name: string, key: string, order: number, rate: number): void {
  let person = tallies.get(name)
  if (!person) {
    person = new Map()
    tallies.set(name, person)
  }
  const tally = person.get(key) ?? { order, rate, count: 0 }
  tally.count += 1
  person.set(key, tally)
}

// The unassigned line is a to-do, not a person, so it sits at the end regardless
// of where the alphabet would put it.
function compareNames(a: string, b: string, unassigned: string): number {
  if (a === unassigned) return 1
  if (b === unassigned) return -1
  return a.localeCompare(b, 'de')
}

function toSection(title: string, tallies: Tallies, unassigned: string): PayoutSection | null {
  if (tallies.size === 0) return null
  const entries = [...tallies.entries()]
    .sort(([a], [b]) => compareNames(a, b, unassigned))
    .map(([name, byRate]) => {
      const parts = [...byRate.values()].sort((x, y) => x.order - y.order)
      return {
        name,
        calculation: parts.map(p => `${p.count} × ${formatEuro(p.rate)}`).join(' + '),
        amount: parts.reduce((sum, p) => sum + p.count * p.rate, 0),
      }
    })
  return { title, entries, total: entries.reduce((sum, e) => sum + e.amount, 0) }
}

export interface PaidRow {
  tandem_master_id?: number | null
  camera_flyer_id?: number | null
  extra_booking?: string | null
  weight_surcharge?: string | null
}

// What the club owes its crew for a jump day. The rates are flat per jump, so this
// counts jumps — not money: a guest flying on a voucher, a row still waiting to be
// collected and a manually corrected price all earn the same as any other jump.
export function payoutSections(
  rows: PaidRow[],
  masterNames: Map<number, string>,
  flyerNames: Map<number, string>,
  payouts: Payouts
): PayoutSection[] {
  const masters: Tallies = new Map()
  const flyers: Tallies = new Map()

  for (const row of rows) {
    const master = (row.tandem_master_id != null && masterNames.get(row.tandem_master_id)) ||
      UNASSIGNED_MASTER
    record(masters, master, 'jump', 0, payouts.tandem_master)

    // The heavier guest is the master's jump to fly, so the club's surcharge for
    // it reaches the person who flew it. Read from the stored field rather than
    // from the weight: the manifest waives that field as an exception, and a
    // waiver the guest gets but the payout ignores is two answers to one question.
    // A rate of 0 records nothing — a club that pays no bonus, and every day
    // frozen before the bonus existed, would otherwise collect "× 0,00 €" lines.
    if (row.weight_surcharge === 'over_90' && payouts.weight_over_90 > 0) {
      record(masters, master, 'over_90', 1, payouts.weight_over_90)
    } else if (row.weight_surcharge === 'over_100' && payouts.weight_over_100 > 0) {
      record(masters, master, 'over_100', 2, payouts.weight_over_100)
    }

    // The rate follows the service actually flown, so a video paid for by a voucher
    // counts exactly like one booked and paid today.
    if (row.extra_booking !== 'video' && row.extra_booking !== 'video_photo') continue
    const flyer = (row.camera_flyer_id != null && flyerNames.get(row.camera_flyer_id)) ||
      UNASSIGNED_FLYER
    if (row.extra_booking === 'video') record(flyers, flyer, 'video', 0, payouts.video)
    else record(flyers, flyer, 'video_photo', 1, payouts.video_photo)
  }

  return [
    toSection('Vergütung Tandemmaster', masters, UNASSIGNED_MASTER),
    toSection('Vergütung Kameraflieger', flyers, UNASSIGNED_FLYER),
  ].filter((s): s is PayoutSection => s !== null)
}
