import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import * as api from './api'
import { today } from './date'
import { fireUpdateEvent } from './setupTests'

// The whole app tree is mounted here, so the module is kept and only the calls
// this test drives are replaced — a hand-written list of exports would need a
// new line every time another screen learns to talk to the server.
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  list: vi.fn(),
  masters: vi.fn(),
  pendingRedemptions: vi.fn(),
  shutdownAllowed: vi.fn(),
  shutdownApp: vi.fn(),
  getUpdateStatus: vi.fn(),
  checkForUpdate: vi.fn(),
  startUpdateDownload: vi.fn(),
  installUpdate: vi.fn(),
  markUpdatePromptSeen: vi.fn(),
}))

const dateInput = () => screen.getByLabelText('Datum') as HTMLInputElement

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(api.list).mockResolvedValue([])
  vi.mocked(api.masters).mockResolvedValue([])
  vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 0 })
  vi.mocked(api.shutdownAllowed).mockResolvedValue({ allowed: true })
  vi.mocked(api.shutdownApp).mockResolvedValue(undefined)
  // Default: an older server with no update routes. App's own describe block
  // below overrides this per test; every other test here should behave as if
  // updates do not exist — no entry, no dialog, nothing to await.
  vi.mocked(api.getUpdateStatus).mockRejectedValue(new Error('not found'))
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})

describe('App', () => {
  it('starts on today', async () => {
    render(<App />)
    await screen.findByText('Keine Registrierungen für dieses Datum.')
    expect(dateInput().value).toBe(today())
  })

  it('keeps a chosen day across a trip to another tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Keine Registrierungen für dieses Datum.')

    await user.clear(dateInput())
    await user.type(dateInput(), '2026-07-09')
    expect(dateInput().value).toBe('2026-07-09')

    // The list is unmounted here — which is exactly what used to lose the day.
    await user.click(screen.getByRole('button', { name: 'Stammdaten' }))
    await user.click(screen.getByRole('button', { name: 'Manifest' }))

    expect(dateInput().value).toBe('2026-07-09')
    expect(api.list).toHaveBeenLastCalledWith('2026-07-09')
  })

  it('remembers the day for the next reload of the window', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await screen.findByText('Keine Registrierungen für dieses Datum.')

    await user.clear(dateInput())
    await user.type(dateInput(), '2026-07-09')

    unmount()
    render(<App />)
    await screen.findAllByText('Keine Registrierungen für dieses Datum.')
    expect(dateInput().value).toBe('2026-07-09')
  })

  // Ending the program ends it for the guest tablets too, so it is asked about
  // once and then said plainly on screen.
  describe('Programm beenden', () => {
    const button = () => screen.getByRole('button', { name: 'Programm beenden' })

    it('asks before stopping the server', async () => {
      const user = userEvent.setup()
      vi.mocked(window.confirm).mockReturnValue(false)
      render(<App />)
      await screen.findByText('Keine Registrierungen für dieses Datum.')

      await user.click(button())

      expect(window.confirm).toHaveBeenCalled()
      expect(api.shutdownApp).not.toHaveBeenCalled()
    })

    it('stops the server once the question is answered with yes', async () => {
      const user = userEvent.setup()
      vi.mocked(window.confirm).mockReturnValue(true)
      render(<App />)
      await screen.findByText('Keine Registrierungen für dieses Datum.')

      await user.click(button())

      await vi.waitFor(() => expect(api.shutdownApp).toHaveBeenCalledTimes(1))
      // The screen it was pressed on is talking to a server that is gone — it
      // has to say so rather than sit there looking alive.
      expect(await screen.findByText(/Tandem wurde beendet/)).toBeInTheDocument()
    })

    it('is not offered on a device that may not stop the server', async () => {
      vi.mocked(api.shutdownAllowed).mockResolvedValue({ allowed: false })
      render(<App />)
      await screen.findByText('Keine Registrierungen für dieses Datum.')

      await vi.waitFor(() => expect(button()).toBeDisabled())
      expect(screen.getByText(/nur an dem Rechner/i)).toBeInTheDocument()
    })

    it('says so when the server refused to stop', async () => {
      const user = userEvent.setup()
      vi.mocked(window.confirm).mockReturnValue(true)
      vi.mocked(api.shutdownApp).mockRejectedValue(new Error('Beenden fehlgeschlagen'))
      render(<App />)
      await screen.findByText('Keine Registrierungen für dieses Datum.')

      await user.click(button())

      expect(await screen.findByText('Beenden fehlgeschlagen')).toBeInTheDocument()
      expect(screen.queryByText(/Tandem wurde beendet/)).not.toBeInTheDocument()
    })
  })

  it('"Heute" brings the operator back to the running day', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Keine Registrierungen für dieses Datum.')

    await user.clear(dateInput())
    await user.type(dateInput(), '2026-07-09')
    await user.click(screen.getByRole('button', { name: 'Heute' }))

    expect(dateInput().value).toBe(today())
    expect(screen.getByRole('button', { name: 'Heute' })).toBeDisabled()
  })
})

const updateStatus = (over = {}) => ({
  phase: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0',
  notes: null, downloadedBytes: 0, totalBytes: 0, error: null,
  checkedAt: null, allowed: true, promptPending: false, openToday: 0,
  ...over,
})

describe('App und das Update', () => {
  beforeEach(() => {
    // clearAllMocks resets call history only (implementations set by the
    // outer beforeEach, e.g. api.list, survive it) — without this, a later
    // test's toHaveBeenCalledTimes(1) would also count an earlier test's call.
    vi.clearAllMocks()
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus())
    vi.mocked(api.markUpdatePromptSeen).mockResolvedValue()
    vi.mocked(api.startUpdateDownload).mockResolvedValue()
  })

  it('shows the sidebar entry once an update is available', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: /Update/ })).toBeInTheDocument()
  })

  // The manifest runs on every tablet in the club WLAN; only the machine the
  // server runs on can do anything about an update.
  it('hides the entry from a device that may not act', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus({ allowed: false }))
    render(<App />)
    await screen.findByRole('button', { name: 'Manifest' })
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  })

  it('shows no entry while everything is up to date', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(
      updateStatus({ phase: 'up-to-date', latestVersion: '1.1.0' }),
    )
    render(<App />)
    await screen.findByRole('button', { name: 'Manifest' })
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  })

  it('opens the dialog exactly when the server says it is pending', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus({ promptPending: true }))
    render(<App />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('starts the download and opens the screen on yes', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus({ promptPending: true }))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Jetzt aktualisieren' }))
    expect(api.markUpdatePromptSeen).toHaveBeenCalledTimes(1)
    expect(api.startUpdateDownload).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: 'Update' })).toBeInTheDocument()
  })

  it('only marks the dialog seen on later', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus({ promptPending: true }))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Später' }))
    expect(api.markUpdatePromptSeen).toHaveBeenCalledTimes(1)
    expect(api.startUpdateDownload).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Progress must not cost one request per percent.
  it('redraws from the pushed status', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /Update/ })
    fireUpdateEvent({ ...updateStatus({ phase: 'downloading', downloadedBytes: 5, totalBytes: 10 }) })
    await userEvent.click(screen.getByRole('button', { name: /Update/ }))
    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
  })

  // The real broadcast never carries `allowed`, `promptPending` or `openToday`
  // (see src/server/update/state.ts and src/server/routes/update.ts) — but
  // App must not rely on that by accident. These three pin the merge itself
  // against a frame that claims otherwise.
  describe('gegen eine feindliche SSE-Nachricht', () => {
    // A client whose GET said `allowed: false` never opens the SSE connection
    // at all (`useUpdateEvents(update?.allowed === true, ...)`), so a frame
    // cannot reach the merge to upgrade it from there — that direction is
    // already unreachable code, not something this test could exercise. The
    // reachable, and therefore meaningful, direction is the opposite: a
    // client that legitimately fetched `allowed: true` (and so is listening)
    // must not be downgraded by a frame that claims otherwise.
    it('lässt den Sidebar-Eintrag stehen, auch wenn die Nachricht allowed: false behauptet', async () => {
      render(<App />)
      expect(await screen.findByRole('button', { name: /Update/ })).toBeInTheDocument()

      fireUpdateEvent(updateStatus({ allowed: false }))
      // Flush the state update the frame triggers (via act, through
      // userEvent) before asserting on it — an unflushed synchronous check
      // could pass for the wrong reason, by racing the re-render instead of
      // surviving it.
      await userEvent.click(screen.getByRole('button', { name: 'Manifest' }))

      expect(screen.getByRole('button', { name: /Update/ })).toBeInTheDocument()
    })

    it('öffnet den Dialog nicht erneut, auch wenn die Nachricht promptPending: true behauptet', async () => {
      vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus({ promptPending: true }))
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: 'Später' }))
      expect(screen.queryByRole('dialog')).toBeNull()

      fireUpdateEvent(updateStatus({ promptPending: true }))

      expect(screen.queryByRole('dialog')).toBeNull()
    })

    // Control: an ordinary frame (only the state fields change) must still
    // reach the screen, so the two tests above cannot pass simply because
    // frames are being ignored outright.
    it('übernimmt trotzdem eine gewöhnliche Nachricht ohne die drei clientspezifischen Felder', async () => {
      render(<App />)
      await screen.findByRole('button', { name: /Update/ })

      fireUpdateEvent(updateStatus({ phase: 'downloading', downloadedBytes: 5, totalBytes: 10 }))
      await userEvent.click(screen.getByRole('button', { name: /Update/ }))

      expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    })
  })
})
