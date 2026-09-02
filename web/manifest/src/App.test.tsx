import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import * as api from './api'
import { today } from './date'

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
}))

const dateInput = () => screen.getByLabelText('Datum') as HTMLInputElement

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(api.list).mockResolvedValue([])
  vi.mocked(api.masters).mockResolvedValue([])
  vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 0 })
  vi.mocked(api.shutdownAllowed).mockResolvedValue({ allowed: true })
  vi.mocked(api.shutdownApp).mockResolvedValue(undefined)
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
