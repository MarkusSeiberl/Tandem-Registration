import { useEffect, useRef } from 'react'

export interface InstallDialogProps {
  latestVersion: string
  /** Today's tandems not yet collected — they stay saved, but the operator
   *  should know the count before taking everyone offline. */
  openToday: number
  onConfirm: () => void
  onCancel: () => void
}

// The one step on this screen that takes the guest tablet and every manifest
// offline at once, so it gets the app's own dialog rather than the browser's
// grey confirm box, which a hurried operator clicks through unread. Same shape
// as CollectDialog: App-style mount-to-open, no `open` prop.
export default function InstallDialog({
  latestVersion, openToday, onConfirm, onCancel,
}: InstallDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const laterRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    ref.current?.showModal()
    // "Später" is the default: Enter on an unread dialog must not restart the
    // drop zone.
    laterRef.current?.focus()
  }, [])

  const openLine =
    openToday === 0
      ? null
      : openToday === 1
        ? 'Ein Tandem von heute ist noch offen. Es bleibt gespeichert.'
        : `${openToday} Tandems von heute sind noch offen. Sie bleiben gespeichert.`

  return (
    <dialog
      ref={ref}
      className="collect-dialog update-dialog"
      onCancel={onCancel}
      aria-labelledby="install-dialog-title"
    >
      <h2 id="install-dialog-title">Version {latestVersion} installieren?</h2>
      <p>
        Tandem startet dabei neu. Gäste-Anmeldung und Manifest sind auf allen Geräten für
        einen Moment nicht erreichbar.
      </p>
      <p className="update-dialog-warn">
        Wer gerade am Tablet die Anmeldung ausfüllt oder unterschreibt, muss danach von vorn
        beginnen.
      </p>
      {openLine && <p>{openLine}</p>}
      <p>Am ruhigsten geht es nach dem Tagesabschluss.</p>
      <div className="collect-dialog-actions">
        <button ref={laterRef} type="button" className="btn secondary" onClick={onCancel}>
          Später
        </button>
        <button type="button" className="btn danger" onClick={onConfirm}>
          Installieren und neu starten
        </button>
      </div>
    </dialog>
  )
}
