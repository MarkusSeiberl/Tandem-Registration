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

export function priceLines(fields: PricedFields, prices: Prices): PriceLine[] {
  const lines: PriceLine[] = []

  lines.push({ label: 'Sprung', amount: prices.jump })
  if (fields.extra_booking === 'video') lines.push({ label: 'Video', amount: prices.video })
  else if (fields.extra_booking === 'video_photo')
    lines.push({ label: 'Video+Foto', amount: prices.video_photo })

  if (fields.payment_method === 'voucher') {
    const service = lines.reduce((sum, l) => sum + l.amount, 0)
    const covered = Math.min(voucherValue(fields.voucher_service, prices), service)
    lines.push({ label: 'Gutschein', amount: -covered })
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
