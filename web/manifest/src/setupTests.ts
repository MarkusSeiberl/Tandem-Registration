import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  cleanup()
})

// jsdom does not implement EventSource. useEvents.ts opens one to auto-refresh the
// manifest list, so tests need a harmless stand-in or mounting any screen would throw.
if (typeof globalThis.EventSource === 'undefined') {
  class FakeEventSource {
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  // @ts-expect-error - minimal test stub, not a full EventSource implementation
  globalThis.EventSource = FakeEventSource
}
