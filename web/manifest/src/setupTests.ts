import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  cleanup()
})

// jsdom does not implement EventSource. useEvents.ts opens one to auto-refresh the
// manifest list, so tests need a stand-in or mounting any screen would throw. The
// listeners are real (not the old no-op) so a test can fire the `changed` event the
// same way SseHub.broadcast does on the server: to every connected client, including
// the one whose own PATCH caused it — that self-echo is what List.tsx has to survive.
class FakeEventSource {
  private static instances = new Set<FakeEventSource>()
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

  constructor() {
    FakeEventSource.instances.add(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  close() {
    FakeEventSource.instances.delete(this)
  }

  static dispatch(type: string, data?: unknown) {
    for (const instance of FakeEventSource.instances) {
      for (const listener of instance.listeners.get(type) ?? []) {
        listener({ data: JSON.stringify(data ?? null) } as MessageEvent)
      }
    }
  }
}

if (typeof globalThis.EventSource === 'undefined') {
  // @ts-expect-error - minimal test stub, not a full EventSource implementation
  globalThis.EventSource = FakeEventSource
}

/** Simulates the server broadcasting a `changed` event to every connected client. */
export function fireChangedEvent() {
  FakeEventSource.dispatch('changed')
}

/** Simulates the server broadcasting an `update` event with its status payload. */
export function fireUpdateEvent(status: unknown) {
  FakeEventSource.dispatch('update', status)
}

// jsdom implements <dialog> as an element but not its modal methods, so any
// component that opens one throws on mount. The stub keeps `open` truthful —
// that is what the tests assert on — without pretending to be a top layer.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
}
