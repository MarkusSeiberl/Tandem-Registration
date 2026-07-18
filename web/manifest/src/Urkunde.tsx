import type { Registration } from './api'

export interface UrkundeProps {
  registration: Registration
}

/**
 * Print sheet for the pre-printed paper Urkunde (certificate). The club
 * feeds the physical, already-printed certificate paper into the printer;
 * this only overlays the guest's name and jump date on top of it.
 *
 * Rendered off-screen at all times (see `.print-only` in urkunde.css, which
 * is `display: none` on screen and `display: block` only under
 * `@media print`). Detail.tsx's "Urkunde drucken" button simply calls
 * `window.print()`; the browser's print dialog then shows exactly this
 * sheet because the rest of the app is marked `.no-print` (forced to
 * `display: none` while printing).
 *
 * Field positions are placeholders driven entirely by CSS custom properties
 * in urkunde.css (`--name-top`, `--date-top`, etc.) — see the "LAYOUT TBD"
 * comment there. The club has not yet measured the real paper; once they
 * do, only those variables need to change, not this component.
 */
export default function Urkunde({ registration }: UrkundeProps) {
  return (
    <div className="print-only urkunde-only">
      <div className="urkunde-sheet">
        <div className="urkunde-field urkunde-name">
          {registration.first_name} {registration.last_name}
        </div>
        <div className="urkunde-field urkunde-date">{registration.jump_date}</div>
      </div>
    </div>
  )
}
