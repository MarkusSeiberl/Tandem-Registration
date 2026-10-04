import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('marks today', async () => {
    render(<Overview onOpenDay={() => {}} />)
    const day = await screen.findByRole('button', { name: '4.10.2026' })
    expect(day).toHaveClass('today')
    expect(day).toHaveAttribute('aria-current', 'date')
  })

  it('marks the days tandems were jumped with their count', async () => {
    vi.mocked(api.calendar).mockResolvedValue([
      { date: '2026-10-03', count: 16 },
      { date: '2026-10-11', count: 1 },
    ])
    render(<Overview onOpenDay={() => {}} />)

    const busy = await screen.findByRole('button', { name: '3.10.2026, 16 Tandems' })
    expect(busy).toHaveClass('jumped')
    expect(busy).toHaveTextContent('16 Tandems')
    expect(screen.getByRole('button', { name: '11.10.2026, 1 Tandem' })).toHaveClass('jumped')
    expect(screen.getByRole('button', { name: '5.10.2026' })).not.toHaveClass('jumped')
  })

  it('"Neuer Tandemtag" opens today', async () => {
    const user = userEvent.setup()
    const onOpenDay = vi.fn()
    render(<Overview onOpenDay={onOpenDay} />)
    await user.click(screen.getByRole('button', { name: 'Neuer Tandemtag' }))
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-04')
  })

  it('opens the day that was clicked', async () => {
    const user = userEvent.setup()
    const onOpenDay = vi.fn()
    render(<Overview onOpenDay={onOpenDay} />)
    await user.click(await screen.findByRole('button', { name: '17.10.2026' }))
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-17')
  })

  it('browses to other months and back', async () => {
    const user = userEvent.setup()
    render(<Overview onOpenDay={() => {}} />)
    const heute = screen.getByRole('button', { name: 'Heute' })
    expect(heute).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Vorheriger Monat' }))
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    expect(api.calendar).toHaveBeenLastCalledWith('2026-09')
    expect(heute).toBeEnabled()

    await user.click(heute)
    expect(await screen.findByRole('heading', { name: 'Oktober 2026' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Nächster Monat' }))
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
  })

  it('says so when the calendar cannot be loaded', async () => {
    vi.mocked(api.calendar).mockRejectedValue(new Error('Kalender konnte nicht geladen werden'))
    render(<Overview onOpenDay={() => {}} />)
    expect(await screen.findByText('Kalender konnte nicht geladen werden')).toBeInTheDocument()
  })
})
