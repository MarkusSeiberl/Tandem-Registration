import { useEffect, useRef } from 'react'
import { getApiBase } from './api'
import type { ExportProgress, UpdateStatus } from './api'

/**
 * Opens an EventSource on /api/events (absolute root path — see api.ts) and calls
 * onChanged whenever the server emits a "changed" event. Used by List.tsx to auto-refresh
 * when the guest app submits a new registration, or another manifest client saves an edit.
 */
export function useEvents(onChanged: () => void): void {
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  useEffect(() => {
    const source = new EventSource(`${getApiBase()}/api/events`)
    const handleChanged = () => onChangedRef.current()
    source.addEventListener('changed', handleChanged)
    return () => {
      source.removeEventListener('changed', handleChanged)
      source.close()
    }
  }, [])
}

/**
 * The update status, pushed. Opened ONLY when the server said this client may
 * act on updates: the manifest runs on every tablet in the club WLAN, and none
 * of them should hold a second connection open for a screen they never see.
 */
export function useUpdateEvents(
  enabled: boolean,
  onStatus: (status: UpdateStatus) => void,
): void {
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    if (!enabled) return
    const source = new EventSource(`${getApiBase()}/api/events`)
    const handle = (event: MessageEvent) => {
      try {
        onStatusRef.current(JSON.parse(event.data) as UpdateStatus)
      } catch {
        // A frame we cannot read changes nothing on screen; the next one will.
      }
    }
    source.addEventListener('update', handle)
    return () => {
      source.removeEventListener('update', handle)
      source.close()
    }
  }, [enabled])
}

/**
 * Progress of one Tagesabschluss this client started. Every manifest gets the
 * events of every export, so they are matched on the run id the closing dialog
 * chose; the connection only stands while that run does.
 */
export function useExportProgress(
  runId: string | null,
  onProgress: (progress: ExportProgress) => void,
): void {
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  useEffect(() => {
    if (runId === null) return
    const source = new EventSource(`${getApiBase()}/api/events`)
    const handle = (event: MessageEvent) => {
      try {
        const progress = JSON.parse(event.data) as ExportProgress
        if (progress.run === runId) onProgressRef.current(progress)
      } catch {
        // A frame we cannot read moves nothing on screen; the answer of the
        // export itself still decides how the run ends.
      }
    }
    source.addEventListener('export-progress', handle)
    return () => {
      source.removeEventListener('export-progress', handle)
      source.close()
    }
  }, [runId])
}
