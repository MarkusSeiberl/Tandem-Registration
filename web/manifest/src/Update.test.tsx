import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Update from './Update'
import * as api from './api'
import type { UpdateStatus } from './api'

vi.mock('./api', () => ({
  startUpdateDownload: vi.fn(),
  installUpdate: vi.fn(),
  serverAlive: vi.fn(),
  reloadPage: vi.fn(),
}))

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  phase: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0',
  notes: '## Kassieren\n\nMehrere Tandems auf einmal.',
  downloadedBytes: 0, totalBytes: 0, error: null, checkedAt: '2026-09-21T08:00:00Z',
  allowed: true, promptPending: false, openToday: 0,
  ...over,
})

describe('Update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.startUpdateDownload).mockResolvedValue()
    vi.mocked(api.installUpdate).mockResolvedValue()
  })

  it('names both versions and shows the release notes', () => {
    render(<Update status={status()} onRefresh={vi.fn()} />)
    expect(screen.getByText('1.1.0')).toBeInTheDocument()
    expect(screen.getByText('1.2.0')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Kassieren' })).toBeInTheDocument()
  })

  it('offers the download and starts it', async () => {
    render(<Update status={status()} onRefresh={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Herunterladen' }))
    expect(api.startUpdateDownload).toHaveBeenCalledTimes(1)
  })

  it('shows progress in MB while downloading', () => {
    render(
      <Update
        status={status({ phase: 'downloading', downloadedBytes: 57_000_000, totalBytes: 116_000_000 })}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '49')
    expect(screen.getByText(/57 MB von 116 MB/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Herunterladen' })).toBeNull()
  })

  it('asks before restarting and names the open tandems', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Update status={status({ phase: 'ready', openToday: 3 })} onRefresh={vi.fn()} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Jetzt installieren und neu starten' }),
    )
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('3'))
    expect(api.installUpdate).toHaveBeenCalledTimes(1)
    confirmSpy.mockRestore()
  })

  it('installs nothing when the question is answered with no', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Update status={status({ phase: 'ready' })} onRefresh={vi.fn()} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Jetzt installieren und neu starten' }),
    )
    expect(api.installUpdate).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  // jsdom makes window.location non-configurable, so the reload goes through
  // api.reloadPage — a seam that can be mocked like every other call here.
  it('waits for the restarted server and then reloads', async () => {
    vi.mocked(api.serverAlive).mockResolvedValueOnce(false).mockResolvedValue(true)
    render(<Update status={status({ phase: 'installing' })} onRefresh={vi.fn()} />)
    expect(screen.getByText(/startet neu/)).toBeInTheDocument()
    await waitFor(() => expect(api.reloadPage).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('keeps waiting while the new server is still down', async () => {
    vi.mocked(api.serverAlive).mockResolvedValue(false)
    render(<Update status={status({ phase: 'installing' })} onRefresh={vi.fn()} />)
    await waitFor(() => expect(api.serverAlive).toHaveBeenCalled())
    expect(api.reloadPage).not.toHaveBeenCalled()
  })

  it('does not reload after unmount if the in-flight check resolves alive', async () => {
    let resolveAlive: (alive: boolean) => void = () => {}
    vi.mocked(api.serverAlive).mockReturnValue(
      new Promise((resolve) => {
        resolveAlive = resolve
      }),
    )
    const { unmount } = render(
      <Update status={status({ phase: 'installing' })} onRefresh={vi.fn()} />,
    )
    await waitFor(() => expect(api.serverAlive).toHaveBeenCalled())
    unmount()
    resolveAlive(true)
    // Flush microtasks so the (now stale) poll continuation would run if the
    // post-await guard were missing.
    await Promise.resolve()
    await Promise.resolve()
    expect(api.reloadPage).not.toHaveBeenCalled()
  })

  it('shows a failed download with a way to try again', async () => {
    render(
      <Update
        status={status({ phase: 'download-failed', error: 'Prüfsumme stimmt nicht.' })}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText('Prüfsumme stimmt nicht.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(api.startUpdateDownload).toHaveBeenCalledTimes(1)
  })

  it('says so when there is nothing to install', () => {
    render(<Update status={status({ phase: 'up-to-date', latestVersion: '1.1.0' })} onRefresh={vi.fn()} />)
    expect(screen.getByText(/aktuellste Version/)).toBeInTheDocument()
  })

  // Defence in depth: the sidebar hides this screen from a tablet and the
  // server refuses the mutating routes from a non-loopback address, but the
  // component must not rely solely on either — a third guest reaching this
  // screen by URL should still find the buttons inert.
  describe('when not the machine Tandem runs on', () => {
    const hintText = 'Updates sind nur an dem Rechner möglich, auf dem Tandem läuft.'

    it('disables the download button for an available update', () => {
      render(<Update status={status({ allowed: false })} onRefresh={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Herunterladen' })).toBeDisabled()
    })

    it('shows a visible hint next to the disabled download button', () => {
      // A title attribute alone is useless on a tablet, which has no hover
      // state — the hint paragraph is what the operator actually sees.
      render(<Update status={status({ allowed: false })} onRefresh={vi.fn()} />)
      expect(screen.getByText(hintText)).toBeInTheDocument()
    })

    it('disables the install button for a ready update', () => {
      render(<Update status={status({ phase: 'ready', allowed: false })} onRefresh={vi.fn()} />)
      expect(
        screen.getByRole('button', { name: 'Jetzt installieren und neu starten' }),
      ).toBeDisabled()
    })

    it('shows a visible hint next to the disabled install button', () => {
      render(<Update status={status({ phase: 'ready', allowed: false })} onRefresh={vi.fn()} />)
      expect(screen.getByText(hintText)).toBeInTheDocument()
    })

    it('disables the retry button for a failed download', () => {
      render(
        <Update
          status={status({ phase: 'download-failed', allowed: false, error: 'Netzwerkfehler' })}
          onRefresh={vi.fn()}
        />,
      )
      expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeDisabled()
    })

    it('shows a visible hint next to the disabled retry button', () => {
      render(
        <Update
          status={status({ phase: 'download-failed', allowed: false, error: 'Netzwerkfehler' })}
          onRefresh={vi.fn()}
        />,
      )
      expect(screen.getByText(hintText)).toBeInTheDocument()
    })

    it('still shows the versions and release notes', () => {
      render(<Update status={status({ allowed: false })} onRefresh={vi.fn()} />)
      expect(screen.getByText('1.1.0')).toBeInTheDocument()
      expect(screen.getByText('1.2.0')).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 3, name: 'Kassieren' })).toBeInTheDocument()
    })
  })

  it('keeps the buttons enabled on the machine Tandem runs on', () => {
    render(<Update status={status({ phase: 'ready', allowed: true })} onRefresh={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Jetzt installieren und neu starten' }),
    ).not.toBeDisabled()
  })

  it('shows no hint when allowed, even where a disabled button would have one', () => {
    const hintText = 'Updates sind nur an dem Rechner möglich, auf dem Tandem läuft.'
    render(<Update status={status({ phase: 'ready', allowed: true })} onRefresh={vi.fn()} />)
    expect(screen.queryByText(hintText)).toBeNull()
  })

  describe('quiet phases that used to render nothing', () => {
    it('says a check is running', () => {
      render(<Update status={status({ phase: 'checking' })} onRefresh={vi.fn()} />)
      expect(screen.getByText(/gerade nach Updates gesucht/)).toBeInTheDocument()
    })

    it('explains a failed check without alarming the operator', () => {
      // The server sets check-failed with error: null on purpose — a landing
      // site without internet is normal, not a fault to fix.
      render(<Update status={status({ phase: 'check-failed' })} onRefresh={vi.fn()} />)
      expect(screen.getByText(/Internetverbindung/)).toBeInTheDocument()
      expect(screen.getByText(/automatisch/)).toBeInTheDocument()
    })

    it('says nothing has been checked yet in the idle phase', () => {
      render(<Update status={status({ phase: 'idle' })} onRefresh={vi.fn()} />)
      expect(screen.getByText(/noch nicht auf Updates geprüft/)).toBeInTheDocument()
    })

    it('says updates are unavailable in the disabled phase', () => {
      render(<Update status={status({ phase: 'disabled' })} onRefresh={vi.fn()} />)
      expect(screen.getByText(/nicht verfügbar/)).toBeInTheDocument()
    })
  })

  it('clamps the progress percentage to 100 when bytes overshoot', () => {
    render(
      <Update
        status={status({ phase: 'downloading', downloadedBytes: 130_000_000, totalBytes: 116_000_000 })}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText(/\(100 %\)/)).toBeInTheDocument()
  })
})
