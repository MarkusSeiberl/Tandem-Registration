import type { Registration } from './api'

export interface PrintProps {
  registration: Registration
}

/**
 * A4 MANIFEST PRINT SHEET (Task 11).
 *
 * Rendered off-screen at all times (see `.print-only` in print.css, which is
 * `display: none` on screen and `display: block` only under `@media print`).
 * Detail.tsx's "Drucken" button simply calls `window.print()`; the browser's
 * print dialog then shows exactly this sheet because the rest of the app is
 * marked `.no-print` (forced to `display: none` while printing).
 *
 * Field positions (name/date/signature) are placeholders driven entirely by CSS
 * custom properties defined in print.css (`--name-top`, `--date-top`, `--sig-top`,
 * etc.) — see the "LAYOUT TBD" comment there. The club has not yet supplied the
 * real coordinates measured off their paper form; once they do, only those
 * variables need to change, not this component.
 */
export default function Print({ registration }: PrintProps) {
  return (
    <div className="print-only">
      <div className="print-sheet">
        <div className="print-field print-name">
          {registration.first_name} {registration.last_name}
        </div>
        <div className="print-field print-date">{registration.jump_date}</div>
        <div className="print-field print-signature">
          <img src={registration.signature_png} alt="Unterschrift" />
        </div>
      </div>
    </div>
  )
}
