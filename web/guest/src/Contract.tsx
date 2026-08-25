import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { getContract, getPrivacyText } from './api'
import { useReachedEnd } from './useReachedEnd'

export interface ContractProps {
  onNext: (signaturePng: string) => void
  onCancel?: () => void
  /** Back to the form, with what the guest already typed still in it. */
  onBack?: () => void
  submitting?: boolean
  errors?: string[] | null
}

const CANVAS_WIDTH = 700
const CANVAS_HEIGHT = 280

// Mirrors the bold formatting of the original Befoerderungsvertrag PDF, where
// these labels/passage are printed bold — the plain-text vertragstext from
// the server has no markup of its own to carry that.
const BOLD_PHRASES = [
  'Absprung:',
  'Freier Fall:',
  'Offener Schirm:',
  'Unmittelbar vor der Landung (Landehaltung): beide Oberschenkel samt Knie 90° anheben, wenn notwendig durch Griff in beide Kniekehlen unterstützen; zusätzlich Unterschenkel mind. 45° nach vorne anheben; Anweisungen des TM befolgen.',
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const BOLD_PATTERN = new RegExp(`(${BOLD_PHRASES.map(escapeRegExp).join('|')})`, 'g')

function renderWithBoldPhrases(text: string): ReactNode[] {
  return text
    .split(BOLD_PATTERN)
    .map((part, i) => (BOLD_PHRASES.includes(part) ? <strong key={i}>{part}</strong> : part))
}

export default function Contract({
  onNext,
  onCancel,
  onBack,
  submitting,
  errors,
}: ContractProps) {
  const [text, setText] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  const privacyCheckRef = useRef<HTMLInputElement | null>(null)
  const signSectionRef = useRef<HTMLDivElement | null>(null)

  // Set by an attempt to send that could not go through. It is what turns the
  // three conditions from silent facts into marks on the screen: a disabled
  // button says that something is missing, but never which.
  const [attempted, setAttempted] = useState(false)

  // Proof-of-reading gate: the contract text is not a scroll box of its own —
  // it lies at full length on the page, and the page is the only thing that
  // scrolls. Reaching the marker at the end of the text is what unlocks
  // "Anmeldung abschicken" (in addition to signing). A contract short enough to
  // fit on the screen has its marker in view from the start and counts as read
  // immediately, which is the same rule as before by a simpler road.
  const endRef = useRef<HTMLDivElement | null>(null)
  const scrolledToEnd = useReachedEnd(endRef, !loading)

  // The form screen is left mid-scroll, and swapping screens does not move the
  // page: without this the guest arrives at the contract already scrolled past
  // the top of the text.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // The data-protection notice is its own act, not a line buried in the contract:
  // an acknowledgement bundled into a wall of other text is the packaging Art. 7
  // Abs. 2 DSGVO does not accept. Loaded separately so the club can reword it
  // without touching the contract.
  const [privacyText, setPrivacyText] = useState<string>('')
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)

  useEffect(() => {
    let cancelled = false
    getContract()
      .then((t) => {
        if (!cancelled) setText(t)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Vertragstext konnte nicht geladen werden.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A failure here leaves the text empty; the block below then says so instead of
  // presenting an empty box to tick. It never blocks the contract from loading.
  useEffect(() => {
    let cancelled = false
    getPrivacyText()
      .then((t) => {
        if (!cancelled) setPrivacyText(t)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function getContext(): CanvasRenderingContext2D | null {
    return canvasRef.current?.getContext('2d') ?? null
  }

  function point(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    // Map the touch/pointer from displayed (CSS) pixels to the canvas'
    // backing-store coordinates. On narrow screens (e.g. iPhone) CSS scales the
    // 700x280 canvas down, so without this scale the drawn point lands shifted
    // toward the left/top. On a full-size canvas rect matches width/height and
    // the scale is 1.
    const scaleX = rect.width ? canvas.width / rect.width : 1
    const scaleY = rect.height ? canvas.height / rect.height : 1
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const ctx = getContext()
    if (!ctx) return
    drawingRef.current = true
    const { x, y } = point(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = getContext()
    if (!ctx) return
    const { x, y } = point(e)
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#111'
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasDrawn(true)
  }

  function stopDrawing() {
    drawingRef.current = false
  }

  // Paint the white background exactly once, on mount — see Sign.tsx's original
  // note (now merged here): this must NOT depend on `hasDrawn`, or the re-render
  // it causes on the first pointermove would wipe the stroke just drawn.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d') ?? null
    if (!canvas || !ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  function handleClear() {
    const canvas = canvasRef.current
    const ctx = getContext()
    if (!canvas || !ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const missingRead = !scrolledToEnd
  const missingPrivacy = !privacyAccepted
  const missingSignature = !hasDrawn

  function handleNext() {
    const canvas = canvasRef.current
    if (!canvas) return

    if (missingRead || missingPrivacy || missingSignature) {
      setAttempted(true)
      // Take the guest to the first thing they can act on. Not to the end of
      // the contract when that is what is missing — scrolling there for them
      // would open the read gate on their behalf, which is the one thing it
      // exists to prevent. The pinned hint already says what to do.
      if (!missingRead) {
        const target = missingPrivacy ? privacyCheckRef.current : signSectionRef.current
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        if (missingPrivacy) privacyCheckRef.current?.focus()
      }
      return
    }

    onNext(canvas.toDataURL('image/png'))
  }

  return (
    <section className="screen contract-screen">
      <h1>Teilnahmebedingungen</h1>
      <div className="boarding-card">
        <div className="contract-text" role="region" aria-label="Teilnahmebedingungen">
          {loading && <p>Lade Vertragstext…</p>}
          {!loading && loadError && <p className="error">{loadError}</p>}
          {!loading && !loadError && text.trim().length === 0 && (
            <p>Es liegt derzeit kein Vertragstext vor. Bitte wende dich an das Personal.</p>
          )}
          {!loading && !loadError && text.trim().length > 0 && (
            <p style={{ whiteSpace: 'pre-wrap' }}>{renderWithBoldPhrases(text)}</p>
          )}

          {/* The end of the contract, as an element rather than a scroll
              offset: whatever the text does when it reflows, this stays the
              place the guest has to have reached. */}
          <div ref={endRef} className="contract-end" aria-hidden="true" />
        </div>

        <div className="perforation" />

        {/*
          Above the signature, because it has to be read before signing — and
          separate from the contract text above it, because that is the whole
          point of pulling it out of the contract.
        */}
        <div className="privacy-section">
          <h2>Datenschutz</h2>
          <p>
            Wir verarbeiten deine Daten, um deinen Tandemsprung durchzuführen und abzurechnen.
            Die vollständige Datenschutzinformation kannst du hier aufklappen.
          </p>

          {privacyText.trim().length === 0 ? (
            <p className="error">
              Die Datenschutzinformation konnte nicht geladen werden. Bitte wende dich an das
              Personal.
            </p>
          ) : (
            <>
              <button
                type="button"
                className="btn secondary privacy-toggle"
                aria-expanded={privacyOpen}
                onClick={() => setPrivacyOpen((open) => !open)}
              >
                {privacyOpen ? 'Datenschutzinformation zuklappen' : 'Datenschutzinformation lesen'}
              </button>

              {privacyOpen && (
                <div className="privacy-text" role="region" aria-label="Datenschutzinformation">
                  <p style={{ whiteSpace: 'pre-wrap' }}>{privacyText}</p>
                </div>
              )}

              <label className={`privacy-check${attempted && missingPrivacy ? ' missing' : ''}`}>
                <input
                  ref={privacyCheckRef}
                  type="checkbox"
                  checked={privacyAccepted}
                  aria-invalid={attempted && missingPrivacy}
                  aria-describedby={attempted && missingPrivacy ? 'privacy-missing' : undefined}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                />
                Ich habe die Datenschutzinformation gelesen und stimme der Verarbeitung meiner
                Daten zur Abwicklung des Tandemsprungs zu.
              </label>

              {attempted && missingPrivacy && (
                <p className="missing-note" id="privacy-missing" role="alert">
                  Bitte bestätige die Datenschutzinformation, um fortzufahren.
                </p>
              )}
            </>
          )}
        </div>

        <div className="sign-section" ref={signSectionRef}>
          <h2>Unterschrift</h2>
          <p>Mit deiner Unterschrift bestätigst du, den Vertrag gelesen und akzeptiert zu haben.</p>
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className={`signature-pad${attempted && missingSignature ? ' missing' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrawing}
            onPointerLeave={stopDrawing}
            onPointerCancel={stopDrawing}
          />

          {/* Directly under the pad it clears, not down in the row of buttons
              that leave the screen: there, "Löschen" reads like it might throw
              away the whole registration. */}
          <div className="sign-actions">
            <button
              type="button"
              className="btn secondary btn-small"
              onClick={handleClear}
              disabled={!hasDrawn || submitting}
            >
              Unterschrift löschen
            </button>
          </div>

          {attempted && missingSignature && (
            <p className="missing-note" role="alert">
              Bitte unterschreibe im Feld oben.
            </p>
          )}
        </div>
      </div>

      {!scrolledToEnd && (
        // Pinned to the bottom edge rather than sitting under the text: below a
        // full-length contract it would be a screenful of reading away from the
        // guest who needs to read it.
        <p className="scroll-hint" role="status">
          Bitte den gesamten Vertrag lesen — nach unten scrollen, um fortzufahren.
        </p>
      )}

      {errors && errors.length > 0 && (
        <ul className="error">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      {attempted && missingRead && (
        <p className="missing-note" role="alert">
          Bitte lies zuerst den gesamten Vertrag.
        </p>
      )}

      <div className="actions">
        {onBack && (
          <button type="button" className="btn secondary" onClick={onBack} disabled={submitting}>
            Zurück
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel} disabled={submitting}>
            Abbrechen
          </button>
        )}
        {/* Not disabled while something is missing: a grey button tells the
            guest that they may not send, never what to fix. Pressing it says
            both. */}
        <button type="button" className="btn primary" disabled={submitting} onClick={handleNext}>
          {submitting ? 'Wird gesendet…' : 'Anmeldung abschicken'}
        </button>
      </div>
    </section>
  )
}
