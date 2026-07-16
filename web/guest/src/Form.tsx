import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'

// Mirrors src/server/validation.ts validateGuest() rules exactly, so the guest
// gets instant German feedback before the server ever sees the payload.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface FormValues {
  first_name: string
  last_name: string
  age: number
  weight_kg: number
  address: string
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
  age: string
  weight: string
  address: string
  email: string
  phone: string
}

interface Errors {
  firstName?: string
  lastName?: string
  age?: string
  weight?: string
  address?: string
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
  if (!isInt(v.age, 1, 120)) e.age = 'Alter ungültig (1–120)'
  if (!isInt(v.weight, 20, 200)) e.weight = 'Gewicht ungültig (20–200 kg)'
  if (v.address.trim().length === 0) e.address = 'Adresse fehlt'
  if (!EMAIL.test(v.email.trim())) e.email = 'E-Mail ungültig'
  if (v.phone.trim().length === 0) e.phone = 'Telefon fehlt'
  return e
}

export default function Form({ onNext, onCancel }: FormProps) {
  const [values, setValues] = useState<RawValues>({
    firstName: '',
    lastName: '',
    age: '',
    weight: '',
    address: '',
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
      age: true,
      weight: true,
      address: true,
      email: true,
      phone: true,
    })
    if (!isValid) return
    onNext({
      first_name: values.firstName.trim(),
      last_name: values.lastName.trim(),
      age: Number(values.age),
      weight_kg: Number(values.weight),
      address: values.address.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
    })
  }

  return (
    <section className="screen form-screen">
      <h1>Deine Daten</h1>
      <form onSubmit={handleSubmit} noValidate>
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

        <div className="field">
          <label htmlFor="age">Alter</label>
          <input id="age" type="number" inputMode="numeric" min={1} max={120} {...field('age')} />
          {showError('age') && <p className="error">{showError('age')}</p>}
        </div>

        <div className="field">
          <label htmlFor="weight_kg">Gewicht (kg)</label>
          <input id="weight_kg" type="number" inputMode="numeric" min={20} max={200} {...field('weight')} />
          {showError('weight') && <p className="error">{showError('weight')}</p>}
        </div>

        <div className="field">
          <label htmlFor="address">Adresse</label>
          <input id="address" type="text" autoComplete="street-address" {...field('address')} />
          {showError('address') && <p className="error">{showError('address')}</p>}
        </div>

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
