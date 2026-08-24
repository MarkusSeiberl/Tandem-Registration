import { useEffect, useRef } from 'react'

export interface PrivacySheetProps {
  text: string
  onClose: () => void
}

/**
 * The full data-protection notice, over the contract screen rather than inside
 * it. Inline it was the app's largest overflow — nearly 900px of text pushed
 * into a flow that has to fit a tablet — and, worse, opening it moved the
 * signature pad the guest was about to use.
 */
export default function PrivacySheet({ text, onClose }: PrivacySheetProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // Focus starts on the way out. A guest on a tablet will tap it; a keyboard
  // user needs somewhere inside the dialog to be, or the next Tab walks the
  // page behind it.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      {/*
        The backdrop closes on tap; the sheet itself must not, or a guest
        dragging to scroll the notice would dismiss the thing they are reading.
      */}
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Datenschutzinformation"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-body">
          <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
        </div>
        <div className="sheet-actions">
          <button ref={closeRef} type="button" className="btn secondary" onClick={onClose}>
            Datenschutzinformation zuklappen
          </button>
        </div>
      </div>
    </div>
  )
}
