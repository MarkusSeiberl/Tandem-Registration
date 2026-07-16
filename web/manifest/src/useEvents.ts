import { useEffect, useRef } from 'react'
import { getApiBase } from './api'

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
