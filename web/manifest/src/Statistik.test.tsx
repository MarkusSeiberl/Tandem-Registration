import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Statistik from './Statistik'
import * as api from './api'
import type { JumpStats, MoneyStats } from './api'
import { formatEuro } from './pricing'

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
    expect(within(tile('Mit Video (+Foto)')).getByText('40 %')).toBeInTheDocument()
    // Shares change in percentage points: 50 % then, 40 % now.
    expect(within(tile('Mit Video (+Foto)')).getByText('−10 Pp.')).toBeInTheDocument()
    expect(within(tile('Mit Gutschein')).getByText('+20 Pp.')).toBeInTheDocument()
  })

  it('first season shows no comparison', async () => {
    render(<Statistik />)
    await screen.findByRole('heading', { name: 'Jahresbericht 2026' })
    expect(screen.queryByText(/im Vorjahr|Vergleich/)).toBeNull()
    expect(document.querySelectorAll('.chart-ghost')).toHaveLength(0)
  })

  it('the subheadline names only the season start and end', async () => {
    vi.mocked(api.statistik).mockResolvedValue(stats({
      firstDay: '2026-04-11', lastDay: '2026-10-24',
      previous: { tandems: 50, jumpDays: 10, video: 10, voucher: 5, months: zeros(12) },
      comparedTo: { year: 2025, asOf: '11-01' },
    }))
    render(<Statistik />)
    const season = await screen.findByText(/^Saison/)
    expect(season).toHaveTextContent(/^Saison 11\. Apr\.? – 24\. Okt\.?$/)
    expect(screen.queryByText(/bester Monat|stärkster Tag|Vergleich/)).toBeNull()
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

  it('opens the report as a PDF in a new tab', async () => {
    render(<Statistik />)
    const link = await screen.findByRole('link', { name: 'PDF öffnen' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('href')).toMatch(/\/api\/stats\/report\.pdf\?year=2026$/)
  })

  it('the PDF carries the takings only while they are shown', async () => {
    vi.mocked(api.statistikMoney).mockResolvedValue(money())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Statistik />)
    await user.click(await screen.findByRole('button', { name: 'Umsatz anzeigen' }))
    expect(screen.getByRole('link', { name: 'PDF öffnen' }).getAttribute('href')).toMatch(/year=2026&money=1$/)
    await user.click(screen.getByRole('button', { name: 'Umsatz ausblenden' }))
    expect(screen.getByRole('link', { name: 'PDF öffnen' }).getAttribute('href')).not.toContain('money')
  })

  it('shows an empty state', async () => {
    vi.mocked(api.statistik).mockResolvedValue(stats({ tandems: 0, jumpDays: 0, busiestDay: null, firstDay: null, lastDay: null }))
    render(<Statistik />)
    expect(await screen.findByText('Keine Tandems in 2026.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('link', { name: 'PDF öffnen' })).toBeNull()
  })

  it('says when loading failed', async () => {
    vi.mocked(api.statistik).mockRejectedValue(new Error('Statistik konnte nicht geladen werden'))
    render(<Statistik />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Statistik konnte nicht geladen werden')
  })
})

function money(overrides: Partial<MoneyStats> = {}): MoneyStats {
  const months = zeros(12)
  months[5] = 5000
  months[6] = 3570
  return {
    year: 2026, collected: 6000, voucherValue: 2570, months,
    tills: { cash: 4000, card: 2000, unrecorded: 0 },
    vouchers: { count: 8, value: 2300, paid: 2000, unknown: 0 },
    previous: { collected: 5000, voucherValue: 2000, months: zeros(12) },
    comparedTo: { year: 2025, asOf: '11-01' },
    ...overrides,
  }
}

// Testing Library collapses the narrow space de-AT groups thousands with; a
// regex lets the expected text do the same.
const euro = (text: string) => new RegExp(`^${text.replace(/\s/g, '\\s')}$`)

describe('Statistik money', () => {
  it('hides money from other devices', async () => {
    render(<Statistik />)
    await screen.findByRole('heading', { name: 'Jahresbericht 2026' })
    await vi.waitFor(() => expect(api.statistikMoney).toHaveBeenCalledWith(2026))
    expect(screen.queryByRole('button', { name: 'Umsatz anzeigen' })).toBeNull()
    expect(screen.queryByText(/Umsatz/)).toBeNull()
  })

  it('money stays closed until asked', async () => {
    vi.mocked(api.statistikMoney).mockResolvedValue(money())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Statistik />)
    const open = await screen.findByRole('button', { name: 'Umsatz anzeigen' })
    expect(open).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Kassiert')).toBeNull()
    expect(screen.getByText('Nur an diesem PC sichtbar.')).toBeInTheDocument()

    await user.click(open)
    const collected = tile('Kassiert')
    expect(within(collected).getByText(euro(formatEuro(6000)))).toBeInTheDocument()
    expect(within(collected).getByText(euro(`${formatEuro(5000)} im Vorjahr`))).toBeInTheDocument()
    expect(within(collected).getByText('+20 %')).toBeInTheDocument()
    expect(within(tile('Gutscheinwert')).getByText(euro(formatEuro(2570)))).toBeInTheDocument()
    // Not decided yet whether these are the right figures to report.
    expect(screen.queryByText('Leistungswert', { selector: '.kpi-label' })).toBeNull()
    expect(screen.queryByText('Ø pro Tandem')).toBeNull()
    expect(screen.getByRole('button', { name: 'Umsatz ausblenden' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('sets the vouchers against what was paid for them', async () => {
    vi.mocked(api.statistikMoney).mockResolvedValue(money({
      vouchers: { count: 8, value: 2300, paid: 2000, unknown: 2 },
    }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Statistik />)
    await user.click(await screen.findByRole('button', { name: 'Umsatz anzeigen' }))

    const vouchers = screen.getByRole('list', { name: 'Gutscheine: Leistungswert und Kaufpreis' })
    const rows = within(vouchers).getAllByRole('listitem')
    expect(within(rows[0]).getByText('Leistungswert')).toBeInTheDocument()
    expect(within(rows[0]).getByText(euro(formatEuro(2300)))).toBeInTheDocument()
    expect(within(rows[1]).getByText('Kaufpreis')).toBeInTheDocument()
    expect(within(rows[1]).getByText(euro(formatEuro(2000)))).toBeInTheDocument()
    expect(screen.getByText(euro(`8 Gutscheine · ${formatEuro(300)} mehr Leistung als bezahlt`))).toBeInTheDocument()
    expect(screen.getByText('2 Gutscheine ohne bekannten Kaufpreis sind nicht enthalten.')).toBeInTheDocument()
  })

  it('leaves out a till nobody used', async () => {
    vi.mocked(api.statistikMoney).mockResolvedValue(money())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Statistik />)
    await user.click(await screen.findByRole('button', { name: 'Umsatz anzeigen' }))
    const tills = screen.getByRole('img', { name: /^Kasse/ })
    expect(tills).toHaveAccessibleName(expect.stringContaining('Bar'))
    expect(tills).not.toHaveAccessibleName(expect.stringContaining('nicht erfasst'))
  })

  it('keeps money open across years', async () => {
    vi.mocked(api.statistik).mockImplementation(async (year) => stats({ year, years: [2025, 2026] }))
    vi.mocked(api.statistikMoney).mockImplementation(async (year) => money({ year }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Statistik />)
    await user.click(await screen.findByRole('button', { name: 'Umsatz anzeigen' }))
    await user.click(screen.getByRole('button', { name: 'Vorheriges Jahr' }))

    await screen.findByRole('heading', { name: 'Jahresbericht 2025' })
    await vi.waitFor(() => expect(api.statistikMoney).toHaveBeenLastCalledWith(2025))
    expect(await screen.findByRole('button', { name: 'Umsatz ausblenden' })).toBeInTheDocument()
  })

  // Printing must not carry money nobody opened: absent, not just hidden by CSS.
  it('closed money is left out of the page', async () => {
    vi.mocked(api.statistikMoney).mockResolvedValue(money())
    render(<Statistik />)
    await screen.findByRole('button', { name: 'Umsatz anzeigen' })
    expect(document.querySelector('.money-figures')).toBeNull()
  })
})

describe('Statistik reloads', () => {
  // A retry still in flight must not overwrite the year the user moved on to.
  it('a late retry does not blank a newer year', async () => {
    let finishRetry: (s: JumpStats) => void = () => {}
    let call = 0
    vi.mocked(api.statistik).mockImplementation((year) => {
      call++
      if (call === 1) return Promise.resolve(stats({ year, years: [2025, 2026] }))
      if (call === 2) return Promise.reject(new Error('Statistik konnte nicht geladen werden'))
      if (call === 3) return new Promise((resolve) => { finishRetry = resolve })
      return Promise.resolve(stats({ year, years: [2025, 2026] }))
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Statistik />)
    await screen.findByText(/^Saison/)

    await user.click(screen.getByRole('button', { name: 'Vorheriges Jahr' }))
    await user.click(await screen.findByRole('button', { name: 'Erneut versuchen' }))
    await user.click(screen.getByRole('button', { name: 'Nächstes Jahr' }))
    await screen.findByRole('heading', { name: 'Jahresbericht 2026' })
    await screen.findByText(/^Saison/)

    expect(call).toBe(4)
    await act(async () => { finishRetry(stats({ year: 2025, years: [2025, 2026] })) })
    expect(screen.getByText(/^Saison/)).toBeInTheDocument()
  })

  // On the PC a failed load is not the same as "not allowed here".
  it('says when money could not be loaded, and retries', async () => {
    vi.mocked(api.statistikMoney).mockRejectedValueOnce(new Error('Umsatz konnte nicht geladen werden'))
    vi.mocked(api.statistikMoney).mockResolvedValueOnce(money())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Statistik />)
    const alert = await screen.findByText('Umsatz konnte nicht geladen werden')
    expect(alert.closest('[role="alert"]')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Umsatz erneut laden' }))
    expect(await screen.findByRole('button', { name: 'Umsatz anzeigen' })).toBeInTheDocument()
  })
})
