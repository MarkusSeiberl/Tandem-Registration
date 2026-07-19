import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, UIEvent as ReactUIEvent } from 'react'
import { getContract } from './api'

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
  const [scrolledToEnd, setScrolledToEnd] = useState(false)

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
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) setScrolledToEnd(true)
  }

  function getContext(): CanvasRenderingContext2D | null {
    return canvasRef.current?.getContext('2d') ?? null
  }

  function point(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
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
    if (!canvas || !hasDrawn) return
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
          <p className="scroll-hint">
            Bitte den gesamten Vertrag lesen — nach unten scrollen, um fortzufahren.
          </p>
        )}

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
          disabled={!hasDrawn || !scrolledToEnd || submitting}
          onClick={handleNext}
        >
          {submitting ? 'Wird gesendet…' : 'Weiter'}
        </button>
      </div>
    </section>
  )
}
