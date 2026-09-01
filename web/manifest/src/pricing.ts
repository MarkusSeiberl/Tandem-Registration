import type {
  ExtraBooking, PaymentMethod, Prices, VoucherService, WeightSurcharge,
} from './api'

// Mirror of src/server/pricing.ts. The server stays the single authority — it
// recomputes and stores the price on every PATCH — but the manifest needs the
// same rule to show the breakdown while the user is still choosing. Keep the two
// in sync, same as web/manifest/src/labels.ts and src/server/labels.ts.

export interface PricedFields {
  payment_method?: PaymentMethod | '' | null
  voucher_service?: VoucherService | '' | null
  extra_booking?: ExtraBooking | null
  weight_surcharge?: WeightSurcharge | null
  // Whether the club charges this guest the rise since the voucher was bought,
  // and what the club's list says was paid for it.
  voucher_topup?: number | boolean | null
  voucher_amount?: number | null
}

export interface PriceLine {
  label: string
  amount: number
}

export function voucherValue(service: VoucherService | '' | null | undefined, prices: Prices): number {
  if (service === 'jump') return prices.jump
  if (service === 'jump_video') return prices.jump + prices.video
  if (service === 'jump_video_photo') return prices.jump + prices.video_photo
  return 0
}

// What the voucher actually takes off this bill, capped at the service flown.
// The detail screen shows the difference to what the guest once paid for the
// voucher, and that difference is about this number.
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
// Zero unless the manifest ticked the box, and never negative.
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

// Mirror of surchargeForWeight() in src/server/pricing.ts. The server applies it
// once, when the registration is created; here it only feeds the hint that tells
// the operator when the selected surcharge no longer matches the guest's weight.
export function surchargeForWeight(kg: number): WeightSurcharge {
  if (!Number.isFinite(kg)) return 'none'
  if (kg >= 100) return 'over_100'
  if (kg >= 90) return 'over_90'
  return 'none'
}

export function formatEuro(amount: number): string {
  return `${amount.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`
}

// Rank of the service levels, used to keep the flown service at least as high as
// what the voucher already covers.
const SERVICE_RANK: Record<ExtraBooking, number> = { none: 0, video: 1, video_photo: 2 }

// The service a voucher already entitles the guest to. Picking a voucher must
// never leave the booking below it — that would price the jump as a downgrade.
export function serviceOfVoucher(service: VoucherService | '' | null | undefined): ExtraBooking {
  if (service === 'jump_video') return 'video'
  if (service === 'jump_video_photo') return 'video_photo'
  return 'none'
}

export function atLeast(booking: ExtraBooking, minimum: ExtraBooking): ExtraBooking {
  return SERVICE_RANK[booking] >= SERVICE_RANK[minimum] ? booking : minimum
}

// Mirror of collectedVia() in src/server/pricing.ts. Which till a row's money
// landed in: a voucher row is only ever cash or card through its top-up, so the
// answer comes from voucher_payment_method there. null means nobody recorded
// it — that money is unaccounted for at closing.
export function collectedVia(
  row: { payment_method?: string | null; voucher_payment_method?: string | null }
): 'cash' | 'card' | null {
  const method = row.payment_method === 'voucher' ? row.voucher_payment_method : row.payment_method
  return method === 'cash' || method === 'card' ? method : null
}
