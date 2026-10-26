import { useRef } from 'react'
import BrandMark from './BrandMark'

export interface WelcomeProps {
  onStart: () => void
  onOpenSettings: () => void
}

const TAP_COUNT = 5
const TAP_WINDOW_MS = 2000

export default function Welcome({ onStart, onOpenSettings }: WelcomeProps) {
  const tapsRef = useRef<number[]>([])

  function handleLogoTap() {
    const now = Date.now()
    const taps = tapsRef.current.filter((t) => now - t < TAP_WINDOW_MS)
    taps.push(now)
    tapsRef.current = taps
    if (taps.length >= TAP_COUNT) {
      tapsRef.current = []
      onOpenSettings()
    }
  }

  return (
    <section className="screen welcome-screen">
      {/* The logo is the hidden door to the settings, so it is a button with no
          name of its own: the heading next to it is what the screen says. */}
      <button type="button" className="logo-tap" onClick={handleLogoTap} aria-hidden="true" tabIndex={-1}>
        <BrandMark size={160} className="welcome-mark" />
      </button>
      <h1>Willkommen beim HFSC Freistadt</h1>
      <p>Bitte melde dich hier für deinen Tandemsprung an.</p>

      {/* What the guest needs before they start, so the form holds no surprise. */}
      <ul className="welcome-facts">
        <li>Dauert etwa 3 Minuten</li>
        <li>Name, Adresse, Körpergröße und Gewicht</li>
        <li>Gutschein-Nr., falls du einen hast</li>
      </ul>

      <button type="button" className="btn primary big" onClick={onStart}>
        Anmeldung starten
      </button>
    </section>
  )
}
