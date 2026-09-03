// The order the cursor travels through the form. Written out here rather than
// read back out of the DOM: a chain derived from document order would reshuffle
// itself silently the next time the layout moves a field, and nothing would
// fail until a guest noticed the cursor jumping about.
//
// `gender` is a radio group, not a text input, but it occupies one station in
// the chain like everything else — skipping it would leave the one field that
// cannot be reached with an Enter key unreachable by the arrows too.
//
// `voucherNumber` is the one optional field of the form and sits last. Being in
// the chain is what makes Enter on `phone` move on instead of submitting, and
// what makes the arrows reach it; `validate()` never puts an error on it, so
// `firstErrorField` can never send the guest here.
export const FIELD_CHAIN = [
  'firstName',
  'lastName',
  'gender',
  'age',
  'height',
  'weight',
  'street',
  'postalCode',
  'city',
  'email',
  'phone',
  'voucherNumber',
] as const

export type FieldName = (typeof FIELD_CHAIN)[number]

export function nextField(name: FieldName): FieldName | null {
  const i = FIELD_CHAIN.indexOf(name)
  return FIELD_CHAIN[i + 1] ?? null
}

export function prevField(name: FieldName): FieldName | null {
  const i = FIELD_CHAIN.indexOf(name)
  return i <= 0 ? null : FIELD_CHAIN[i - 1]
}

// Chain order, not object order: `Object.keys()` on the error object follows
// insertion, which would send the guest to whichever field happens to be listed
// first rather than to the one they reach first.
export function firstErrorField(errors: Partial<Record<FieldName, string>>): FieldName | null {
  return FIELD_CHAIN.find((name) => errors[name] !== undefined) ?? null
}
