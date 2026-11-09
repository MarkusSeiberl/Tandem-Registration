import type { ExportProgress } from '../api'
import CheckIcon from '../CheckIcon'

export interface ExportRunningProps {
  /** The last progress frame of this run; null until the first one arrives. */
  progress: ExportProgress | null
}

type PhaseState = 'done' | 'active' | 'pending'

function Phase({ state, label, detail, bar }: {
  state: PhaseState; label: string; detail?: string; bar?: number
}) {
  return (
    <li className={`dc-phase ${state}`}>
      <span className="dc-marker" aria-hidden="true">{state === 'done' && <CheckIcon size={14} />}</span>
      <span className="dc-phase-label">{label}</span>
      <span className="dc-phase-detail numeral">{detail}</span>
      {bar !== undefined && (
        <span className="dc-bar" aria-hidden="true"><i style={{ width: `${Math.round(bar * 100)}%` }} /></span>
      )}
    </li>
  )
}

export default function ExportRunning({ progress }: ExportRunningProps) {
  // Before the first frame the server is already in the voucher sweep (the
  // count was saved before the request went out), so that is what spins.
  const vouchers: PhaseState = progress?.phase === 'sheet' ? 'done' : 'active'
  const sheet: PhaseState = progress?.phase === 'sheet' ? 'active' : 'pending'
  const counts = progress?.phase === 'vouchers' && progress.total > 0 ? progress : null
  return (
    <>
      <h3>Tagesabschluss läuft</h3>
      <p className="dc-lede">Gutscheinliste und Excel-Blatt werden geschrieben.</p>
      <ol className="dc-phases" aria-live="polite">
        <Phase state="done" label="Kassensturz gespeichert" />
        <Phase
          state={vouchers}
          label="Gutscheinliste"
          detail={counts ? `${counts.done} von ${counts.total}` : undefined}
          bar={counts ? counts.done / counts.total : undefined}
        />
        <Phase state={sheet} label="Excel-Blatt" />
      </ol>
      <p className="dc-wait">Bitte warten, nicht schließen. Das dauert ein paar Sekunden.</p>
    </>
  )
}
