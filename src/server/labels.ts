// German labels for the enum values stored in the database, used to render the
// Excel export in the language the club actually reads.
//
// This intentionally duplicates web/manifest/src/labels.ts: the manifest is a
// separate Vite project with its own tsconfig and build, so the server cannot
// import from it. Keep the two in sync when an enum value is added.

import type { Gender } from './validation'
import type {
  ExtraBooking, PaymentMethod, VoucherService, WeightSurcharge,
} from './pricing'

const GENDER_LABELS: Record<Gender, string> = {
  female: 'weiblich',
  male: 'männlich',
  diverse: 'divers',
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  voucher: 'Gutschein',
  cash: 'Bar',
  card: 'Karte',
}

const EXTRA_BOOKING_LABELS: Record<ExtraBooking, string> = {
  none: 'nur Sprung',
  video: 'Sprung+Video',
  video_photo: 'Sprung+Video+Foto',
}

const VOUCHER_SERVICE_LABELS: Record<VoucherService, string> = {
  jump: 'Sprung',
  jump_video: 'Sprung+Video',
  jump_video_photo: 'Sprung+Video+Foto',
}

const WEIGHT_SURCHARGE_LABELS: Record<WeightSurcharge, string> = {
  none: '',
  over_90: 'ab 90 kg',
  over_100: 'ab 100 kg',
}

// Unknown/NULL values render as an empty cell rather than leaking a raw value.
function label<T extends string>(map: Record<T, string>, value: unknown): string {
  return typeof value === 'string' && value in map ? map[value as T] : ''
}

export const genderLabel = (v: unknown) => label(GENDER_LABELS, v)
export const paymentLabel = (v: unknown) => label(PAYMENT_LABELS, v)
export const extraBookingLabel = (v: unknown) => label(EXTRA_BOOKING_LABELS, v)
export const voucherServiceLabel = (v: unknown) => label(VOUCHER_SERVICE_LABELS, v)
export const weightSurchargeLabel = (v: unknown) => label(WEIGHT_SURCHARGE_LABELS, v)
