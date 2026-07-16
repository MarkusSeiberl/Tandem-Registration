import { useEffect } from 'react'

export interface DoneProps {
  onTimeout: () => void
  timeoutMs?: number
}

export default function Done({ onTimeout, timeoutMs = 8000 }: DoneProps) {
  useEffect(() => {
    const id = setTimeout(onTimeout, timeoutMs)
    return () => clearTimeout(id)
  }, [onTimeout, timeoutMs])

  return (
    <section className="screen done-screen">
      <h1>Vielen Dank!</h1>
      <p>Deine Anmeldung wurde erfolgreich übermittelt.</p>
      <p>Bitte wende dich an das Personal für die weiteren Schritte.</p>
    </section>
  )
}
