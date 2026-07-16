import type { ExtraBooking, PaymentMethod } from './api'

// Canonical enum values (sent to the API) mapped to their German UI labels.
// Keep the enum values themselves out of the UI — only these labels are shown.

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'voucher', label: 'Gutschein' },
  { value: 'cash', label: 'Bar' },
  { value: 'card', label: 'Karte' },
]

export const EXTRA_BOOKINGS: { value: ExtraBooking; label: string }[] = [
  { value: 'none', label: 'nichts' },
  { value: 'video', label: 'nur Video' },
  { value: 'video_photo', label: 'Video+Foto' },
]

export function paymentLabel(value: PaymentMethod | null | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? ''
}

export function extraBookingLabel(value: ExtraBooking | null | undefined): string {
  return EXTRA_BOOKINGS.find((m) => m.value === value)?.label ?? ''
}
