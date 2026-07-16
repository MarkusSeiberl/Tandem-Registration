import { useRef } from 'react'

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
      <button type="button" className="logo-tap" onClick={handleLogoTap} aria-label="HFSC Freistadt">
        <h1>Willkommen beim HFSC Freistadt – Tandemsprung</h1>
      </button>
      <p>Bitte melde dich hier für deinen Tandemsprung an.</p>
      <button type="button" className="btn primary big" onClick={onStart}>
        Anmeldung starten
      </button>
    </section>
  )
}
