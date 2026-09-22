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

  // `dispatch` always runs its payload through JSON.stringify, so it can never
  // produce a malformed (non-JSON) frame. This bypasses that to let a test send
  // exactly the raw string a real server-sent-events frame would carry.
  static dispatchRaw(type: string, raw: string) {
    for (const instance of FakeEventSource.instances) {
      for (const listener of instance.listeners.get(type) ?? []) {
        listener({ data: raw } as MessageEvent)
      }
    }
  }

  /** Test-only: how many stubbed connections are currently open (not yet closed). */
  static openCount(): number {
    return FakeEventSource.instances.size
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

/** Simulates a raw event frame, e.g. an unparseable payload a client must not choke on. */
export function fireRawEvent(type: string, raw: string) {
  FakeEventSource.dispatchRaw(type, raw)
}

// Exported as a plain function (not the class) so it stays reachable from a test
// even though the class itself is only installed onto globalThis conditionally
// above. It reads FakeEventSource's own instance set directly, so it reports the
// real count of hook-opened connections regardless of that conditional install.
/** How many stubbed EventSource connections a test's hook(s) currently hold open. */
export function eventSourceOpenCount(): number {
  return FakeEventSource.openCount()
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
