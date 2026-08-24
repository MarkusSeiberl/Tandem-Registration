export interface FieldNavProps {
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}

/**
 * The two arrows that walk the cursor through the form.
 *
 * Arrows rather than words on purpose: the form already ends in a button
 * labelled „Weiter", which leaves the whole screen for the contract. A second
 * „Weiter" that only moved one field would be a trap.
 */
export default function FieldNav({ canPrev, canNext, onPrev, onNext }: FieldNavProps) {
  // The whole reason this works on a tablet. Tapping a button normally takes
  // the focus off the input, and Android answers a lost focus by sliding the
  // keyboard away — before the click handler has moved the cursor on. The
  // keyboard would then close and reopen on every single jump.
  //
  // Cancelling `pointerdown` keeps the focus where it is. `click` still fires
  // afterwards, so the move happens there and a keyboard user pressing Space
  // on the button (which produces a click but no pointer event) is served too.
  const hold = (e: React.PointerEvent) => e.preventDefault()

  return (
    <div className="field-nav" role="group" aria-label="Feldnavigation">
      <button
        type="button"
        className="field-nav-btn"
        aria-label="Vorheriges Feld"
        disabled={!canPrev}
        onPointerDown={hold}
        onClick={onPrev}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="field-nav-btn"
        aria-label="Nächstes Feld"
        disabled={!canNext}
        onPointerDown={hold}
        onClick={onNext}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
