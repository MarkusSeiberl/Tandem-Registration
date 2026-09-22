import { useEffect, useRef } from 'react'
import { getApiBase } from './api'
import type { UpdateStatus } from './api'

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
