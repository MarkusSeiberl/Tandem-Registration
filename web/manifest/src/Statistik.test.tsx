import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Statistik from './Statistik'
import * as api from './api'
import type { JumpStats } from './api'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  statistik: vi.fn(),
  statistikMoney: vi.fn(),
}))

const zeros = (n: number) => Array<number>(n).fill(0)

function stats(overrides: Partial<JumpStats> = {}): JumpStats {
  const months = zeros(12)
  months[5] = 42
  months[6] = 30
  return {
    year: 2026, years: [2026],
    tandems: 72, jumpDays: 12, video: 36, voucher: 18, months,
    firstDay: '2026-06-06', lastDay: '2026-07-25',
    busiestDay: { date: '2026-06-06', count: 14 },
    monthDays: zeros(12),
    weekdays: Array.from({ length: 7 }, () => ({ tandems: 0, days: 0 })),
    services: { none: 36, video: 24, video_photo: 12 },
    masters: [], flyers: [],
    gender: { female: 30, male: 40, diverse: 2 },
    ageGroups: [0, 20, 30, 15, 6, 1],
    cities: [{ city: 'Linz', count: 12 }],
    previous: null, comparedTo: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 1, 10, 0))
  vi.mocked(api.statistik).mockReset()
  vi.mocked(api.statistik).mockImplementation(async (year) => stats({ year }))
  vi.mocked(api.statistikMoney).mockReset()
  vi.mocked(api.statistikMoney).mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

const tile = (label: string) => screen.getByText(label, { selector: '.kpi-label' }).closest('.kpi') as HTMLElement

describe('Statistik', () => {
  it('opens on the current year', async () => {
    render(<Statistik />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Jahresbericht 2026' })).toBeInTheDocument()
    expect(api.statistik).toHaveBeenCalledWith(2026)
  })

  it('shows the key figures against last year', async () => {
    vi.mocked(api.statistik).mockResolvedValue(stats({
      tandems: 125, jumpDays: 20, video: 50, voucher: 25,
      previous: { tandems: 100, jumpDays: 20, video: 50, voucher: 0, months: zeros(12) },
      comparedTo: { year: 2025, asOf: '11-01' },
    }))
    render(<Statistik />)
    await screen.findByRole('heading', { name: 'Jahresbericht 2026' })

    expect(within(tile('Tandems')).getByText('125')).toBeInTheDocument()
    expect(within(tile('Tandems')).getByText('100 im Vorjahr')).toBeInTheDocument()
    expect(within(tile('Tandems')).getByText('+25 %')).toBeInTheDocument()
    expect(within(tile('Sprungtage')).getByText('20')).toBeInTheDocument()
    expect(within(tile('Sprungtage')).getByText('±0 %')).toBeInTheDocument()
    expect(within(tile('Ø pro Sprungtag')).getByText('6,3')).toBeInTheDocument()
    expect(within(tile('Mit Video')).getByText('40 %')).toBeInTheDocument()
    // Shares change in percentage points: 50 % then, 40 % now.
    expect(within(tile('Mit Video')).getByText('−10 Pp.')).toBeInTheDocument()
    expect(within(tile('Mit Gutschein')).getByText('+20 Pp.')).toBeInTheDocument()
    expect(screen.getByText('Vergleich: 2025 bis 1. November')).toBeInTheDocument()
  })

  it('first season shows no comparison', async () => {
    render(<Statistik />)
    await screen.findByRole('heading', { name: 'Jahresbericht 2026' })
    expect(screen.queryByText(/im Vorjahr|Vergleich/)).toBeNull()
    expect(document.querySelectorAll('.chart-ghost')).toHaveLength(0)
  })

  it('shows the season facts', async () => {
    vi.mocked(api.statistik).mockResolvedValue(stats({ firstDay: '2026-04-11', lastDay: '2026-10-24' }))
    render(<Statistik />)
    const season = await screen.findByText(/^Saison/)
    expect(season).toHaveTextContent('11. Apr')
    expect(season).toHaveTextContent('24. Okt')
    expect(season).toHaveTextContent('Juni (42)')
    expect(season).toHaveTextContent('(14)')
  })

  it('steps between years with data', async () => {
    vi.mocked(api.statistik).mockImplementation(async (year) => stats({ year, years: [2025, 2026] }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Statistik />)
    await screen.findByRole('heading', { name: 'Jahresbericht 2026' })
    expect(screen.getByRole('button', { name: 'Nächstes Jahr' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Vorheriges Jahr' }))
    expect(await screen.findByRole('heading', { name: 'Jahresbericht 2025' })).toBeInTheDocument()
    expect(api.statistik).toHaveBeenLastCalledWith(2025)
    expect(screen.getByRole('button', { name: 'Vorheriges Jahr' })).toBeDisabled()
  })

  it('ranks tandem masters, unassigned last, with their change', async () => {
    const best = { date: '2026-06-06', count: 4 }
    vi.mocked(api.statistik).mockResolvedValue(stats({
      masters: [
        { name: 'Anna', tandems: 30, days: 10, bestDay: best, video: 12, previous: 20 },
        { name: null, tandems: 2, days: 1, bestDay: best, video: 0, previous: 0 },
      ],
      previous: { tandems: 50, jumpDays: 10, video: 10, voucher: 5, months: zeros(12) },
      comparedTo: { year: 2025, asOf: null },
    }))
    render(<Statistik />)
    const list = await screen.findByRole('list', { name: 'Tandemmaster' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Anna')
    expect(items[0]).toHaveTextContent('+50 %')
    expect(items[1]).toHaveTextContent('ohne Tandemmaster')
  })

  it('prints the report', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Statistik />)
    await user.click(await screen.findByRole('button', { name: 'Drucken' }))
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state', async () => {
    vi.mocked(api.statistik).mockResolvedValue(stats({ tandems: 0, jumpDays: 0, busiestDay: null, firstDay: null, lastDay: null }))
    render(<Statistik />)
    expect(await screen.findByText('Keine Tandems in 2026.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Drucken' })).toBeNull()
  })

  it('says when loading failed', async () => {
    vi.mocked(api.statistik).mockRejectedValue(new Error('Statistik konnte nicht geladen werden'))
    render(<Statistik />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Statistik konnte nicht geladen werden')
  })
})
