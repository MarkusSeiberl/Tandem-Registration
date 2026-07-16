import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'

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

  const errors = validate(values)
  const isValid = Object.keys(errors).length === 0

  function field(name: keyof RawValues) {
    return {
      value: values[name],
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        setValues((prev) => ({ ...prev, [name]: e.target.value })),
      onBlur: () => setTouched((prev) => ({ ...prev, [name]: true })),
    }
  }

  function showError(name: keyof Errors): string | undefined {
    return touched[name] ? errors[name] : undefined
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
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
    if (!isValid) return
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

  return (
    <section className="screen form-screen">
      <h1>Deine Daten</h1>
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
            <div className="radio-row" role="radiogroup" aria-labelledby="gender_label">
              {GENDERS.map((g) => (
                <label key={g.value} className="radio-option">
                  <input
                    type="radio"
                    name="gender"
                    value={g.value}
                    checked={values.gender === g.value}
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
    </section>
  )
}
