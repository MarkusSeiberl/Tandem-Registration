import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, UIEvent as ReactUIEvent } from 'react'
import { getContract, getPrivacyText } from './api'
import { useContractCollapse } from './useContractCollapse'
import { useScrollLock } from './useScrollLock'
import { useTouchScrollChain } from './useTouchScrollChain'

export interface ContractProps {
  onNext: (signaturePng: string) => void
  onCancel?: () => void
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

export default function Contract({ onNext, onCancel, submitting, errors }: ContractProps) {
  const [text, setText] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  // Proof-of-reading gate: the guest must scroll the contract text to the end
  // before "Weiter" unlocks (in addition to signing). A contract short enough
  // to fit without scrolling counts as read immediately (see the effect below).
  const textRef = useRef<HTMLDivElement | null>(null)
  const hintRef = useRef<HTMLParagraphElement | null>(null)
  const [scrolledToEnd, setScrolledToEnd] = useState(false)

  // The form screen is left mid-scroll, and swapping screens does not move the
  // page: without this the guest arrives at the contract already scrolled past
  // its top — with a screen-tall text box, above the box entirely.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // The text box opens as tall as the screen and gives that height back to the
  // page once the guest has read to the end — see useContractCollapse.
  const { height: textHeight, spacerHeight } = useContractCollapse(textRef, hintRef, {
    ready: !loading,
    scrolledToEnd,
  })

  // Until the contract has been read, the text box is the only thing on this
  // screen that scrolls: the page itself is held still, so no drag beside the
  // box can carry the guest past the contract to the signature.
  const releaseScrollLock = useScrollLock(!scrolledToEnd)

  // And when the text does run out mid-swipe, the rest of that swipe scrolls the
  // page instead of dying against the end of the box.
  useTouchScrollChain(textRef)

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

  // Once the FINAL text is rendered (not the "Lade…" placeholder), open the
  // gate immediately if it already fits without scrolling (short contract, load
  // error, or empty text — nothing to scroll through); otherwise keep it closed
  // until the guest scrolls to the end (handleScroll). Skipping the loading
  // render matters: the short placeholder box "fits" and would wrongly open the
  // gate before the real, scrollable contract has been measured. These deps
  // don't change after load, so a later scroll (handleScroll → true) is never
  // undone by this effect re-running.
  useEffect(() => {
    if (loading) return
    const el = textRef.current
    if (!el) return
    setScrolledToEnd(el.scrollHeight - el.clientHeight <= 2)
  }, [text, loading, loadError])

  function handleScroll(e: ReactUIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 2) return
    setScrolledToEnd(true)
    // Right now, not after the re-render: the finger that just reached the end
    // of the text is still down and already pushing the page, and every frame
    // the lock outlives this moment is a frame of that push thrown away.
    releaseScrollLock()
  }

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

  function handleNext() {
    const canvas = canvasRef.current
    if (!canvas || !hasDrawn || !privacyAccepted) return
    onNext(canvas.toDataURL('image/png'))
  }

  return (
    <section className="screen contract-screen">
      <h1>Teilnahmebedingungen</h1>
      <div className="boarding-card">
        <div
          ref={textRef}
          className="contract-text"
          role="region"
          aria-label="Teilnahmebedingungen"
          onScroll={handleScroll}
          style={textHeight === null ? undefined : { height: textHeight, maxHeight: 'none' }}
        >
          {loading && <p>Lade Vertragstext…</p>}
          {!loading && loadError && <p className="error">{loadError}</p>}
          {!loading && !loadError && text.trim().length === 0 && (
            <p>Es liegt derzeit kein Vertragstext vor. Bitte wende dich an das Personal.</p>
          )}
          {!loading && !loadError && text.trim().length > 0 && (
            <p style={{ whiteSpace: 'pre-wrap' }}>{renderWithBoldPhrases(text)}</p>
          )}
        </div>

        <div className="perforation" />

        {!scrolledToEnd && (
          <p className="scroll-hint" ref={hintRef}>
            Bitte den gesamten Vertrag lesen — nach unten scrollen, um fortzufahren.
          </p>
        )}

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

              <label className="privacy-check">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                />
                Ich habe die Datenschutzinformation gelesen und stimme der Verarbeitung meiner
                Daten zur Abwicklung des Tandemsprungs zu.
              </label>
            </>
          )}
        </div>

        <div className="sign-section">
          <h2>Unterschrift</h2>
          <p>Mit deiner Unterschrift bestätigst du, den Vertrag gelesen und akzeptiert zu haben.</p>
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="signature-pad"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrawing}
            onPointerLeave={stopDrawing}
            onPointerCancel={stopDrawing}
          />
        </div>
      </div>

      {errors && errors.length > 0 && (
        <ul className="error">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <div className="actions">
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel} disabled={submitting}>
            Abbrechen
          </button>
        )}
        <button type="button" className="btn secondary" onClick={handleClear} disabled={submitting}>
          Löschen
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!hasDrawn || !scrolledToEnd || !privacyAccepted || submitting}
          onClick={handleNext}
        >
          {submitting ? 'Wird gesendet…' : 'Weiter'}
        </button>
      </div>

      {/*
        Takes on exactly what the text box gave up. Without it the document
        shortens as fast as the guest scrolls, the browser clamps the scroll
        position, and the collapse stalls halfway.
      */}
      {spacerHeight > 0 && (
        <div className="contract-spacer" style={{ height: spacerHeight }} aria-hidden="true" />
      )}
    </section>
  )
}
