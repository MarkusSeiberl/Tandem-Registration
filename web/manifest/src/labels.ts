import type {
  CollectedVia, ExtraBooking, Gender, PaymentMethod, VoucherService, WeightSurcharge,
} from './api'

// Canonical enum values (sent to the API) mapped to their German UI labels.
// Keep the enum values themselves out of the UI — only these labels are shown.

export const GENDERS: { value: Gender; label: string }[] = [
  { value: 'female', label: 'weiblich' },
  { value: 'male', label: 'männlich' },
  { value: 'diverse', label: 'divers' },
]

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'voucher', label: 'Gutschein' },
  { value: 'cash', label: 'Bar' },
  { value: 'card', label: 'Karte' },
]

// The service the guest actually flies. Deliberately worded like the voucher
// services below, so the manifest can read the subtraction ("Gutschein deckt
// Sprung+Video, gebucht ist Sprung+Video+Foto") straight off the two fields.
export const EXTRA_BOOKINGS: { value: ExtraBooking; label: string }[] = [
  { value: 'none', label: 'nur Sprung' },
  { value: 'video', label: 'Sprung+Video' },
  { value: 'video_photo', label: 'Sprung+Video+Foto' },
]

// The tills money can land in. A voucher is not one of them — it moves no money.
export const COLLECTED_VIA: { value: CollectedVia; label: string }[] = [
  { value: 'cash', label: 'Bar' },
  { value: 'card', label: 'Karte' },
]

export const VOUCHER_SERVICES: { value: VoucherService; label: string }[] = [
  { value: 'jump', label: 'Sprung' },
  { value: 'jump_video', label: 'Sprung+Video' },
  { value: 'jump_video_photo', label: 'Sprung+Video+Foto' },
]

export const WEIGHT_SURCHARGES: { value: WeightSurcharge; label: string }[] = [
  { value: 'none', label: 'kein Zuschlag' },
  { value: 'over_90', label: 'ab 90 kg' },
  { value: 'over_100', label: 'ab 100 kg' },
]

export function genderLabel(value: Gender | null | undefined): string {
  return GENDERS.find((g) => g.value === value)?.label ?? ''
}

export function paymentLabel(value: PaymentMethod | null | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? ''
}

export function extraBookingLabel(value: ExtraBooking | null | undefined): string {
  return EXTRA_BOOKINGS.find((m) => m.value === value)?.label ?? ''
}

export function voucherServiceLabel(value: VoucherService | null | undefined): string {
  return VOUCHER_SERVICES.find((m) => m.value === value)?.label ?? ''
}

// 'none' deliberately renders as an empty string here (unlike in the select,
// where it needs a readable option): the list and the export show nothing at all
// when there is no surcharge.
export function weightSurchargeLabel(value: WeightSurcharge | null | undefined): string {
  return value && value !== 'none'
    ? WEIGHT_SURCHARGES.find((m) => m.value === value)?.label ?? ''
    : ''
}
