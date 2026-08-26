import type { Prices } from './config'

export type PaymentMethod = 'voucher' | 'cash' | 'card'
export type ExtraBooking = 'none' | 'video' | 'video_photo'
export type VoucherService = 'jump' | 'jump_video' | 'jump_video_photo'
export type WeightSurcharge = 'none' | 'over_90' | 'over_100'

export const PAYMENT_METHODS: PaymentMethod[] = ['voucher', 'cash', 'card']
// A voucher itself moves no money today, so when the guest owes something on top
// of it the manifest records separately how that difference was collected.
export type CollectedVia = 'cash' | 'card'
export const COLLECTED_VIA: CollectedVia[] = ['cash', 'card']
export const EXTRA_BOOKINGS: ExtraBooking[] = ['none', 'video', 'video_photo']
export const VOUCHER_SERVICES: VoucherService[] = ['jump', 'jump_video', 'jump_video_photo']
export const WEIGHT_SURCHARGES: WeightSurcharge[] = ['none', 'over_90', 'over_100']

// The surcharge a weight calls for at the club's thresholds. Applied once, when
// the registration is created, so the row reaches the manifest with the right
// surcharge and the right price instead of a 'none' nobody thought about. It is
// deliberately never re-derived on update: the manifest waives the surcharge as
// an exception, and a waiver that reappears on the next save is not a waiver.
export function surchargeForWeight(kg: number): WeightSurcharge {
  if (!Number.isFinite(kg)) return 'none'
  // "ab 90 kg" on the price list means 90 counts, not 91.
  if (kg >= 100) return 'over_100'
  if (kg >= 90) return 'over_90'
  return 'none'
}

export interface PricedFields {
  payment_method?: PaymentMethod | null
  voucher_service?: VoucherService | null
  extra_booking?: ExtraBooking | null
  weight_surcharge?: WeightSurcharge | null
  // Whether the club charges this guest the rise since the voucher was bought,
  // and what the club's list says was paid for it. The amount is stored on the
  // row rather than looked up here: the price has to be reproducible from the
  // row alone, on a day the club's Excel file is unreachable or has been edited.
  voucher_topup?: number | boolean | null
  voucher_amount?: number | null
}

export interface PriceLine {
  label: string
  amount: number
}

// What a voucher is worth at today's list prices. A voucher stands for a service,
// not an amount, so an old voucher is honoured at the current price — and a guest
// who upgrades pays only the difference.
export function voucherValue(service: VoucherService | null | undefined, prices: Prices): number {
  if (service === 'jump') return prices.jump
  if (service === 'jump_video') return prices.jump + prices.video
  if (service === 'jump_video_photo') return prices.jump + prices.video_photo
  return 0
}

// The amount to collect today, split into the lines the manifest shows under the
// price field. `extra_booking` is the service the guest actually flies; a voucher
// is subtracted from it at list price, so an upgrade costs the difference and a
// voucher used as-is costs nothing. The weight surcharge is never covered by a
// voucher and is always added on top.
// What the voucher actually takes off this bill. Capped at the service flown: a
// voucher worth more than what the guest takes is not paid out in cash, and the
// lines always add up to the total.
//
// Exported because the manifest shows the difference to what the guest once paid
// for the voucher, and that difference is about this number — not about the
// voucher's value in the abstract.
export function voucherCovered(fields: PricedFields, prices: Prices): number {
  if (fields.payment_method !== 'voucher') return 0
  const service = prices.jump +
    (fields.extra_booking === 'video'
      ? prices.video
      : fields.extra_booking === 'video_photo'
        ? prices.video_photo
        : 0)
  return Math.min(voucherValue(fields.voucher_service, prices), service)
}

// What the guest is charged for the price rise since the voucher was bought.
// Zero unless the manifest ticked the box: honouring an old voucher at today's
// price is the club's default, and turning that into money is a decision someone
// has to make in front of the guest. Never negative — a voucher bought above
// today's price is not refunded.
export function voucherTopup(fields: PricedFields, prices: Prices): number {
  if (!fields.voucher_topup || fields.voucher_amount == null) return 0
  return Math.max(0, voucherCovered(fields, prices) - fields.voucher_amount)
}

export function priceLines(fields: PricedFields, prices: Prices): PriceLine[] {
  const lines: PriceLine[] = []

  lines.push({ label: 'Sprung', amount: prices.jump })
  if (fields.extra_booking === 'video') lines.push({ label: 'Video', amount: prices.video })
  else if (fields.extra_booking === 'video_photo')
    lines.push({ label: 'Video+Foto', amount: prices.video_photo })

  if (fields.payment_method === 'voucher') {
    lines.push({ label: 'Gutschein', amount: -voucherCovered(fields, prices) })
    const topup = voucherTopup(fields, prices)
    if (topup > 0) lines.push({ label: 'Gutschein-Differenz', amount: topup })
  }

  if (fields.weight_surcharge === 'over_90')
    lines.push({ label: 'ab 90 kg', amount: prices.weight_over_90 })
  else if (fields.weight_surcharge === 'over_100')
    lines.push({ label: 'ab 100 kg', amount: prices.weight_over_100 })

  return lines
}

export function computePrice(fields: PricedFields, prices: Prices): number {
  return priceLines(fields, prices).reduce((sum, l) => sum + l.amount, 0)
}

// Which till a row's money landed in. A voucher row is only ever cash or card
// through its top-up, so the answer comes from `voucher_payment_method` there.
// `null` means nobody recorded it — that money is unaccounted for at closing.
export function collectedVia(
  row: { payment_method?: string | null; voucher_payment_method?: string | null }
): CollectedVia | null {
  const method = row.payment_method === 'voucher' ? row.voucher_payment_method : row.payment_method
  return method === 'cash' || method === 'card' ? method : null
}
