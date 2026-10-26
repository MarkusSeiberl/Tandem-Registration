import { useEffect, useState } from 'react'
import BrandMark from './BrandMark'

export interface DoneProps {
  onTimeout: () => void
  timeoutMs?: number
  /** Thanked by name: the guest has just signed with it. */
  firstName?: string
}

export default function Done({ onTimeout, timeoutMs = 15000, firstName }: DoneProps) {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(timeoutMs / 1000))

  useEffect(() => {
    const id = setTimeout(onTimeout, timeoutMs)
    return () => clearTimeout(id)
  }, [onTimeout, timeoutMs])

  // Only the readout counts down; the timeout above is what actually ends the
  // screen, so a slow tick can never keep a guest's name on the tablet longer.
  useEffect(() => {
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <section className="screen done-screen">
      <BrandMark size={96} className="done-mark" />
      <h1>{firstName ? `Vielen Dank, ${firstName}!` : 'Vielen Dank!'}</h1>
      <p className="done-lead">Deine Anmeldung ist angekommen.</p>
      <p className="done-handback">Bitte gib das Tablet jetzt dem Personal zurück.</p>
      {/* What the rest of the day holds, so the guest does not walk off with
          the question of what to do now or when to pay. */}
      <p className="done-next">
        Als Nächstes erklärt dir dein Tandemmaster den Sprung. Bezahlt wird nach der Landung.
      </p>
      <button type="button" className="btn secondary done-close" onClick={onTimeout}>
        Fertig
      </button>
      <p className="done-countdown" aria-live="off">
        Schließt sich in {secondsLeft} s
      </p>
    </section>
  )
}
