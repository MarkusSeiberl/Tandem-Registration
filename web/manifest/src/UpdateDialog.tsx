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

  // Accepting here only downloads. Saying so is what lets an operator say yes
  // on a busy morning: the restart is a second, separate decision on the
  // Update screen, with its own warning.
  return (
    <dialog
      ref={ref}
      className="collect-dialog update-dialog"
      onCancel={onLater}
      aria-labelledby="update-dialog-title"
    >
      <h2 id="update-dialog-title">Update verfügbar</h2>
      <p className="update-dialog-versions">
        Version {currentVersion} → <strong>{latestVersion}</strong>
      </p>
      <p>
        Der Download läuft im Hintergrund, der Betrieb geht normal weiter. Installiert – mit
        einem kurzen Neustart – wird erst, wenn du es auf der Update-Seite bestätigst.
      </p>
      <div className="collect-dialog-actions">
        <button type="button" className="btn secondary" onClick={onLater}>
          Später
        </button>
        <button type="button" className="btn primary" onClick={onAccept}>
          Herunterladen
        </button>
      </div>
    </dialog>
  )
}
