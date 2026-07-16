import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface SignProps {
  onNext: (signaturePng: string) => void
  onCancel?: () => void
  submitting?: boolean
  errors?: string[] | null
}

const CANVAS_WIDTH = 700
const CANVAS_HEIGHT = 280

export default function Sign({ onNext, onCancel, submitting, errors }: SignProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)

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

  // Paint the white background exactly once, on mount. This must NOT depend
  // on component state (e.g. hasDrawn): a callback ref that repaints on every
  // render would re-fire whenever hasDrawn changes (e.g. after the first
  // pointermove) and wipe out the stroke that was just drawn.
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
    <section className="screen sign-screen">
      <h1>Unterschrift</h1>
      <p>Bitte unterschreibe im Feld unten.</p>
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
          disabled={!hasDrawn || submitting}
          onClick={handleNext}
        >
          {submitting ? 'Wird gesendet…' : 'Weiter'}
        </button>
      </div>
    </section>
  )
}
