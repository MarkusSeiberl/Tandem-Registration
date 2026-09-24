import { useEffect, useRef } from 'react'

export interface UpdateDialogProps {
  currentVersion: string
  latestVersion: string
  onAccept: () => void
  onLater: () => void
}

// Same shape as CollectDialog: App decides when this should be open and only
// mounts it then, so there is no `open` prop. It also reuses CollectDialog's
// panel classes rather than adding new ones — same dark-mode-safe dialog
// chrome, no new CSS to maintain for a second modal that looks identical.
export default function UpdateDialog({
  currentVersion, latestVersion, onAccept, onLater,
}: UpdateDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  // Mount-only, like CollectDialog: App unmounts this to close it, and the
  // jsdom stub in setupTests.ts dispatches no `close` event to react to.
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="collect-dialog"
      onCancel={onLater}
      aria-labelledby="update-dialog-title"
    >
      <h2 id="update-dialog-title">Update verfügbar</h2>
      <p>
        Version {currentVersion} → {latestVersion}
      </p>
      <p>
        Jetzt herunterladen? Das Programm startet danach neu; alle Tablets
        verlieren dabei kurz die Verbindung.
      </p>
      <div className="collect-dialog-actions">
        <button type="button" className="btn secondary" onClick={onLater}>
          Später
        </button>
        <button type="button" className="btn primary" onClick={onAccept}>
          Jetzt aktualisieren
        </button>
      </div>
    </dialog>
  )
}
