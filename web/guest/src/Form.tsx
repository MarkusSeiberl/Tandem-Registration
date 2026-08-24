import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import FieldNav from './FieldNav'
import { FIELD_CHAIN, firstErrorField, nextField, prevField } from './useFieldChain'
import type { FieldName } from './useFieldChain'
import { useViewportHeight } from './useViewportHeight'

// Mirrors src/server/validation.ts validateGuest() rules exactly, so the guest
// gets instant German feedback before the server ever sees the payload.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export type Gender = 'male' | 'female' | 'diverse'

// Canonical enum values go to the API; only the labels are ever shown.
// Mirrors web/manifest/src/labels.ts GENDERS.
export const GENDERS: { value: Gender; label: string }[] = [
  { value: 'female', label: 'weiblich' },
  { value: 'male', label: 'männlich' },
  { value: 'diverse', label: 'divers' },
]

export interface FormValues {
  first_name: string
  last_name: string
  gender: Gender
  age: number
  height_cm: number
  weight_kg: number
  street: string
  postal_code: string
  city: string
  email: string
  phone: string
}

export interface FormProps {
  onNext: (values: FormValues) => void
  onCancel?: () => void
}

interface RawValues {
  firstName: string
  lastName: string
  gender: Gender | ''
  age: string
  height: string
  weight: string
  street: string
  postalCode: string
  city: string
  email: string
  phone: string
}

interface Errors {
  firstName?: string
  lastName?: string
  gender?: string
  age?: string
  height?: string
  weight?: string
  street?: string
  postalCode?: string
  city?: string
  email?: string
  phone?: string
}

const LAST_FIELD: FieldName = FIELD_CHAIN[FIELD_CHAIN.length - 1]

function isInt(v: string, lo: number, hi: number): boolean {
  if (!/^\d+$/.test(v.trim())) return false
  const n = Number(v)
  return Number.isInteger(n) && n >= lo && n <= hi
}

function validate(v: RawValues): Errors {
  const e: Errors = {}
  if (v.firstName.trim().length === 0) e.firstName = 'Vorname fehlt'
  if (v.lastName.trim().length === 0) e.lastName = 'Nachname fehlt'
  if (v.gender === '') e.gender = 'Geschlecht fehlt'
  if (!isInt(v.age, 1, 120)) e.age = 'Alter ungültig (1–120)'
  if (!isInt(v.height, 100, 220)) e.height = 'Größe ungültig (100–220 cm)'
  if (!isInt(v.weight, 20, 200)) e.weight = 'Gewicht ungültig (20–200 kg)'
  if (v.street.trim().length === 0) e.street = 'Straße und Hausnummer fehlt'
  // Presence only — see the matching note in src/server/validation.ts.
  if (v.postalCode.trim().length === 0) e.postalCode = 'PLZ fehlt'
  if (v.city.trim().length === 0) e.city = 'Wohnort fehlt'
  if (!EMAIL.test(v.email.trim())) e.email = 'E-Mail ungültig'
  if (v.phone.trim().length === 0) e.phone = 'Telefon fehlt'
  return e
}

export default function Form({ onNext, onCancel }: FormProps) {
  const [values, setValues] = useState<RawValues>({
    firstName: '',
    lastName: '',
    gender: '',
    age: '',
    height: '',
    weight: '',
    street: '',
    postalCode: '',
    city: '',
    email: '',
    phone: '',
  })
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // Which field the cursor sits in. Fed by every field's onFocus rather than by
  // the arrows themselves, so that tapping straight into a field mid-form leaves
  // the arrows continuing from *there* and not from wherever they last landed.
  const [active, setActive] = useState<FieldName | null>(null)

  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({})
  const genderRadios = useRef<(HTMLInputElement | null)[]>([])

  // Keeps the arrows above the Android keyboard on engines that ignore
  // interactive-widget=resizes-content in index.html.
  useViewportHeight()

  const errors = validate(values)
  const isValid = Object.keys(errors).length === 0

  function focusField(name: FieldName) {
    if (name === 'gender') {
      // A radio group has no single element to focus: the browser's own target
      // is whichever radio is checked, and the first one when none is.
      const radios = genderRadios.current.filter((r): r is HTMLInputElement => r !== null)
      const target = radios.find((r) => r.checked) ?? radios[0]
      target?.focus()
      return
    }
    inputs.current[name]?.focus()
  }

  function goNext() {
    // From nowhere, the first field — so the arrow is a way *into* the form too.
    const target = active === null ? FIELD_CHAIN[0] : nextField(active)
    if (target) focusField(target)
  }

  function goPrev() {
    if (active === null) return
    const target = prevField(active)
    if (target) focusField(target)
  }

  // Shared by the submit button and by Enter in the last field, so the two can
  // never drift apart.
  function attemptSubmit() {
    setTouched({
      firstName: true,
      lastName: true,
      gender: true,
      age: true,
      height: true,
      weight: true,
      street: true,
      postalCode: true,
      city: true,
      email: true,
      phone: true,
    })
    if (!isValid) {
      // Send the guest to the hole they reach first, not to whichever error the
      // object happens to list first.
      const target = firstErrorField(errors)
      if (target) focusField(target)
      return
    }
    onNext({
      first_name: values.firstName.trim(),
      last_name: values.lastName.trim(),
      // isValid guarantees gender !== '', which the compiler cannot see.
      gender: values.gender as Gender,
      age: Number(values.age),
      height_cm: Number(values.height),
      weight_kg: Number(values.weight),
      street: values.street.trim(),
      postal_code: values.postalCode.trim(),
      city: values.city.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
    })
  }

  // Every field here is mandatory — there is no optional guest datum. `required`
  // and aria-required say so before the guest has left a field empty, which the
  // error messages can only do afterwards. The form keeps `noValidate`, so the
  // browser's own English bubbles stay out of the way of the German messages.
  function field(name: keyof RawValues) {
    const isLast = name === LAST_FIELD
    return {
      value: values[name],
      required: true,
      'aria-required': true,
      'aria-invalid': showError(name as keyof Errors) ? true : undefined,
      // Labels the Android Enter key before the guest presses it the first time.
      enterKeyHint: isLast ? ('done' as const) : ('next' as const),
      ref: (el: HTMLInputElement | null) => {
        inputs.current[name] = el
      },
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        setValues((prev) => ({ ...prev, [name]: e.target.value })),
      onFocus: () => setActive(name),
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== 'Enter') return
        // Always cancel the native submit: a form with a single submit button
        // submits on Enter in any field, which is precisely the behaviour that
        // made the guest's Enter key useless for moving on.
        e.preventDefault()
        if (isLast) {
          attemptSubmit()
          return
        }
        const target = nextField(name)
        if (target) focusField(target)
      },
      onBlur: () => setTouched((prev) => ({ ...prev, [name]: true })),
    }
  }

  function showError(name: keyof Errors): string | undefined {
    return touched[name] ? errors[name] : undefined
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    attemptSubmit()
  }

  return (
    <section className="screen form-screen">
      <h1>Deine Daten</h1>
      <p className="form-intro">Alle Felder sind Pflichtfelder.</p>
      <form onSubmit={handleSubmit} noValidate>
        <fieldset className="field-group">
          <legend>Person</legend>

          <div className="field">
            <label htmlFor="first_name">Vorname</label>
            <input id="first_name" type="text" autoComplete="given-name" {...field('firstName')} />
            {showError('firstName') && <p className="error">{showError('firstName')}</p>}
          </div>

          <div className="field">
            <label htmlFor="last_name">Nachname</label>
            <input id="last_name" type="text" autoComplete="family-name" {...field('lastName')} />
            {showError('lastName') && <p className="error">{showError('lastName')}</p>}
          </div>

          {/*
            Radio buttons rather than a <select>: this form is filled in on a tablet
            handed to the guest, where three visible tap targets beat a dropdown.
          */}
          <div className="field">
            <span className="label" id="gender_label">Geschlecht</span>
            <div
              className="radio-row"
              role="radiogroup"
              aria-labelledby="gender_label"
              aria-required="true"
              aria-invalid={showError('gender') ? true : undefined}
            >
              {GENDERS.map((g, i) => (
                <label key={g.value} className="radio-option">
                  <input
                    type="radio"
                    name="gender"
                    value={g.value}
                    checked={values.gender === g.value}
                    ref={(el) => {
                      genderRadios.current[i] = el
                    }}
                    onFocus={() => setActive('gender')}
                    // The radios are not built by field(), so they need their
                    // own Enter: without it Enter here reaches the form and
                    // submits, throwing every error message on the screen at a
                    // guest who is only three fields in.
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      const target = nextField('gender')
                      if (target) focusField(target)
                    }}
                    onChange={() => {
                      setValues((prev) => ({ ...prev, gender: g.value }))
                      setTouched((prev) => ({ ...prev, gender: true }))
                    }}
                  />
                  {g.label}
                </label>
              ))}
            </div>
            {showError('gender') && <p className="error">{showError('gender')}</p>}
          </div>

          <div className="field">
            <label htmlFor="age">Alter</label>
            <input id="age" type="number" inputMode="numeric" min={1} max={120} {...field('age')} />
            {showError('age') && <p className="error">{showError('age')}</p>}
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>Körperdaten</legend>

          <div className="field-row">
            <div className="field">
              <label htmlFor="height_cm">Größe (cm)</label>
              <input id="height_cm" type="number" inputMode="numeric" min={100} max={220} {...field('height')} />
              {showError('height') && <p className="error">{showError('height')}</p>}
            </div>

            <div className="field">
              <label htmlFor="weight_kg">Gewicht (kg)</label>
              <input id="weight_kg" type="number" inputMode="numeric" min={20} max={200} {...field('weight')} />
              {showError('weight') && <p className="error">{showError('weight')}</p>}
            </div>
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>Adresse</legend>

          <div className="field">
            <label htmlFor="street">Straße und Hausnummer</label>
            <input id="street" type="text" autoComplete="street-address" {...field('street')} />
            {showError('street') && <p className="error">{showError('street')}</p>}
          </div>

          {/* PLZ is narrow, Wohnort takes the rest — see .field-row in index.css. */}
          <div className="field-row">
            <div className="field field-plz">
              <label htmlFor="postal_code">PLZ</label>
              <input id="postal_code" type="text" inputMode="numeric" autoComplete="postal-code" {...field('postalCode')} />
              {showError('postalCode') && <p className="error">{showError('postalCode')}</p>}
            </div>

            <div className="field field-city">
              <label htmlFor="city">Wohnort</label>
              <input id="city" type="text" autoComplete="address-level2" {...field('city')} />
              {showError('city') && <p className="error">{showError('city')}</p>}
            </div>
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>Kontakt</legend>

          <div className="field">
            <label htmlFor="email">E-Mail</label>
            <input id="email" type="email" autoComplete="email" {...field('email')} />
            {showError('email') && <p className="error">{showError('email')}</p>}
          </div>

          <div className="field">
            <label htmlFor="phone">Telefon</label>
            <input id="phone" type="tel" autoComplete="tel" {...field('phone')} />
            {showError('phone') && <p className="error">{showError('phone')}</p>}
          </div>
        </fieldset>

        <div className="actions">
          {onCancel && (
            <button type="button" className="btn secondary" onClick={onCancel}>
              Abbrechen
            </button>
          )}
          <button type="submit" className="btn primary" disabled={!isValid}>
            Weiter
          </button>
        </div>
      </form>

      <FieldNav
        canPrev={active !== null && prevField(active) !== null}
        canNext={active === null || nextField(active) !== null}
        onPrev={goPrev}
        onNext={goNext}
      />
    </section>
  )
}
