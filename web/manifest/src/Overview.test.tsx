import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Overview from './Overview'
import * as api from './api'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  calendar: vi.fn(),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 4, 10, 0))
  vi.mocked(api.calendar).mockReset()
  vi.mocked(api.calendar).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Overview', () => {
  it('shows the current month, Monday first', async () => {
    render(<Overview onOpenDay={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Oktober 2026' })).toBeInTheDocument()
    expect(api.calendar).toHaveBeenCalledWith('2026-10')
    // 1 October 2026 is a Thursday: three empty cells before it.
    const grid = document.querySelector('.calendar-grid')!
    const cells = Array.from(grid.children).slice(7)
    expect(cells.slice(0, 3).every((c) => c.classList.contains('calendar-pad'))).toBe(true)
    expect(cells[3]).toHaveTextContent('1')
  })

  it('marks today, in words as well as in colour', async () => {
    render(<Overview onOpenDay={() => {}} />)
    const day = await screen.findByRole('button', { name: 'Sonntag, 4. Oktober 2026' })
    expect(day).toHaveClass('today')
    expect(day).toHaveAttribute('aria-current', 'date')
    expect(day).toHaveTextContent('Heute')
  })

  it('marks the days tandems were jumped with their count', async () => {
    vi.mocked(api.calendar).mockResolvedValue([
      { date: '2026-10-03', count: 16, open: 0, exported: true },
      { date: '2026-10-11', count: 1, open: 0, exported: true },
    ])
    render(<Overview onOpenDay={() => {}} />)

    const busy = await screen.findByRole('button', { name: 'Samstag, 3. Oktober 2026, 16 Tandems' })
    expect(busy).toHaveClass('jumped')
    expect(busy).toHaveTextContent('16 Tandems')
    expect(screen.getByRole('button', { name: 'Sonntag, 11. Oktober 2026, 1 Tandem' }))
      .toHaveClass('jumped')
    expect(screen.getByRole('button', { name: 'Montag, 5. Oktober 2026' })).not.toHaveClass('jumped')
  })

  it('shows the money still open on a day, closed or not', async () => {
    vi.mocked(api.calendar).mockResolvedValue([
      // Exported with a guest still unpaid: the case that used to look clean.
      { date: '2026-10-02', count: 5, open: 1, exported: true },
      { date: '2026-10-03', count: 16, open: 3, exported: false },
    ])
    render(<Overview onOpenDay={() => {}} />)

    const closed = await screen.findByRole('button', {
      name: 'Freitag, 2. Oktober 2026, 5 Tandems, 1 offen',
    })
    expect(closed).toHaveTextContent('1 offen')
    expect(closed).not.toHaveTextContent('Abschluss fehlt')
    expect(screen.getByRole('button', {
      name: 'Samstag, 3. Oktober 2026, 16 Tandems, 3 offen, Abschluss fehlt',
    })).toBeInTheDocument()
  })

  it('flags a missing Tagesabschluss on past days, and calls today running', async () => {
    vi.mocked(api.calendar).mockResolvedValue([
      { date: '2026-10-02', count: 5, open: 0, exported: true },
      { date: '2026-10-03', count: 16, open: 0, exported: false },
      { date: '2026-10-04', count: 2, open: 2, exported: false },
    ])
    render(<Overview onOpenDay={() => {}} />)

    const unclosed = await screen.findByRole('button', {
      name: 'Samstag, 3. Oktober 2026, 16 Tandems, Abschluss fehlt',
    })
    expect(unclosed).toHaveTextContent('Abschluss fehlt')
    // Today's Abschluss comes at the end of today; it is not overdue yet.
    const todayCell = screen.getByRole('button', {
      name: 'Sonntag, 4. Oktober 2026, 2 Tandems, 2 offen, Tag läuft',
    })
    expect(todayCell).not.toHaveTextContent('Abschluss fehlt')
    expect(screen.getByRole('button', { name: 'Freitag, 2. Oktober 2026, 5 Tandems' }))
      .not.toHaveTextContent('Abschluss fehlt')
  })

  it('opens today, and says how far today has got', async () => {
    const user = userEvent.setup()
    const onOpenDay = vi.fn()
    vi.mocked(api.calendar).mockResolvedValue([
      { date: '2026-10-04', count: 5, open: 2, exported: false },
    ])
    render(<Overview onOpenDay={onOpenDay} />)

    // "Neu" would be wrong once the first guest has registered.
    await user.click(await screen.findByRole('button', { name: 'Heute öffnen (5 Tandems)' }))
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-04')
  })

  it('names the today button plainly while today has no guests', async () => {
    render(<Overview onOpenDay={() => {}} />)
    await screen.findByRole('heading', { name: 'Oktober 2026' })
    expect(screen.getByRole('button', { name: 'Heute öffnen' })).toBeInTheDocument()
  })

  it('keeps naming today while another month is on screen', async () => {
    const user = userEvent.setup()
    vi.mocked(api.calendar).mockImplementation(async (month) =>
      month === '2026-10' ? [{ date: '2026-10-04', count: 3, open: 0, exported: false }] : [])
    render(<Overview onOpenDay={() => {}} />)
    await screen.findByRole('button', { name: 'Heute öffnen (3 Tandems)' })

    await user.click(screen.getByRole('button', { name: 'Vorheriger Monat' }))
    await screen.findByRole('heading', { name: 'September 2026' })

    expect(screen.getByRole('button', { name: 'Heute öffnen (3 Tandems)' })).toBeInTheDocument()
  })

  it('opens the day that was clicked', async () => {
    const user = userEvent.setup()
    const onOpenDay = vi.fn()
    render(<Overview onOpenDay={onOpenDay} />)
    await user.click(await screen.findByRole('button', { name: 'Samstag, 17. Oktober 2026' }))
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-17')
  })

  it('browses to other months and back', async () => {
    const user = userEvent.setup()
    render(<Overview onOpenDay={() => {}} />)
    const heute = screen.getByRole('button', { name: 'Heute' })
    expect(heute).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Vorheriger Monat' }))
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    expect(api.calendar).toHaveBeenCalledWith('2026-09')
    expect(heute).toBeEnabled()

    await user.click(heute)
    expect(await screen.findByRole('heading', { name: 'Oktober 2026' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Nächster Monat' }))
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
  })

  it('draws a month that has not arrived as loading, not as empty', async () => {
    const user = userEvent.setup()
    render(<Overview onOpenDay={() => {}} />)
    await waitFor(() =>
      expect(document.querySelector('.calendar-grid')).toHaveAttribute('aria-busy', 'false'))

    vi.mocked(api.calendar).mockReturnValue(new Promise(() => {}))
    await user.click(screen.getByRole('button', { name: 'Vorheriger Monat' }))

    const grid = document.querySelector('.calendar-grid')!
    expect(grid).toHaveAttribute('aria-busy', 'true')
    expect(grid).toHaveClass('loading')
  })

  it('says so when the calendar cannot be loaded, in German, with a retry', async () => {
    const user = userEvent.setup()
    // What fetch throws when the server is gone.
    vi.mocked(api.calendar).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<Overview onOpenDay={() => {}} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Kalender konnte nicht geladen werden.')
    expect(alert).not.toHaveTextContent('Failed to fetch')
    expect(document.querySelector('.calendar-grid')).toHaveClass('loading')

    vi.mocked(api.calendar).mockResolvedValue([
      { date: '2026-10-03', count: 2, open: 0, exported: true },
    ])
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(await screen.findByRole('button', { name: 'Samstag, 3. Oktober 2026, 2 Tandems' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('keyboard', () => {
    it('is one stop for Tab, on today', async () => {
      render(<Overview onOpenDay={() => {}} />)
      await screen.findByRole('heading', { name: 'Oktober 2026' })
      const stops = Array.from(document.querySelectorAll('.calendar-day'))
        .filter((b) => b.getAttribute('tabindex') === '0')
      expect(stops).toHaveLength(1)
      expect(stops[0]).toHaveAccessibleName('Sonntag, 4. Oktober 2026')
    })

    it('moves by day and week with the arrow keys', async () => {
      const user = userEvent.setup()
      render(<Overview onOpenDay={() => {}} />)
      const todayCell = await screen.findByRole('button', { name: 'Sonntag, 4. Oktober 2026' })
      todayCell.focus()

      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('button', { name: 'Sonntag, 11. Oktober 2026' })).toHaveFocus()
      await user.keyboard('{ArrowLeft}')
      expect(screen.getByRole('button', { name: 'Samstag, 10. Oktober 2026' })).toHaveFocus()
      await user.keyboard('{Home}')
      expect(screen.getByRole('button', { name: 'Montag, 5. Oktober 2026' })).toHaveFocus()
      await user.keyboard('{End}')
      expect(screen.getByRole('button', { name: 'Sonntag, 11. Oktober 2026' })).toHaveFocus()
    })

    it('crosses into the next month past its last day', async () => {
      const user = userEvent.setup()
      render(<Overview onOpenDay={() => {}} />)
      ;(await screen.findByRole('button', { name: 'Samstag, 31. Oktober 2026' })).focus()

      await user.keyboard('{ArrowRight}')

      expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Sonntag, 1. November 2026' })).toHaveFocus())
    })

    it('turns the month with PageUp and PageDown, keeping the day', async () => {
      const user = userEvent.setup()
      render(<Overview onOpenDay={() => {}} />)
      ;(await screen.findByRole('button', { name: 'Samstag, 31. Oktober 2026' })).focus()

      // September has 30 days: the 31st becomes the last one there is.
      await user.keyboard('{PageUp}')

      expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Mittwoch, 30. September 2026' })).toHaveFocus())
    })

    it('announces the month when it changes', async () => {
      render(<Overview onOpenDay={() => {}} />)
      expect(await screen.findByRole('heading', { name: 'Oktober 2026' }))
        .toHaveAttribute('aria-live', 'polite')
    })
  })
})
