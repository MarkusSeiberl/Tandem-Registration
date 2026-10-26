import { useEffect, useRef } from 'react'

export interface CancelConfirmProps {
  /** What gets thrown away, said in the guest's words. */
  detail: string
  onKeep: () => void
  onDiscard: () => void
  title?: string
  keepLabel?: string
  discardLabel?: string
}

// Takes the place of the screen's button row while it is open, rather than
// floating over the screen as a dialog: the question appears exactly where the
// guest just tapped, and nothing else on the screen has to move or dim.
export default function CancelConfirm({
  detail,
  onKeep,
  onDiscard,
  title = 'Alle Eingaben verwerfen?',
  keepLabel = 'Nein, weiter ausfüllen',
  discardLabel = 'Ja, verwerfen',
}: CancelConfirmProps) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const keepRef = useRef<HTMLButtonElement | null>(null)

  // The safe answer has the focus, so a second hurried tap on the same spot or
  // an Enter does not throw the registration away. Both answers are scrolled
  // into view: the box is taller than the row it replaced.
  useEffect(() => {
    keepRef.current?.focus({ preventScroll: true })
    boxRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div
      ref={boxRef}
      className="cancel-confirm"
      role="alertdialog"
      aria-labelledby="cancel-confirm-title"
      aria-describedby="cancel-confirm-detail"
    >
      <p className="cancel-confirm-title" id="cancel-confirm-title">
        {title}
      </p>
      <p className="cancel-confirm-detail" id="cancel-confirm-detail">
        {detail}
      </p>
      {/* The safe answer is the solid one: the eye and the thumb go to the
          loudest button first, and that must not be the one that deletes. */}
      <div className="actions">
        <button ref={keepRef} type="button" className="btn primary" onClick={onKeep}>
          {keepLabel}
        </button>
        <button type="button" className="btn danger-quiet" onClick={onDiscard}>
          {discardLabel}
        </button>
      </div>
    </div>
  )
}
