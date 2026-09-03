import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import List from './List'
import * as api from './api'
import type { Registration } from './api'
import { today } from './date'

vi.mock('./api', () => ({
  list: vi.fn(),
  masters: vi.fn(),
  exportDay: vi.fn(),
  patch: vi.fn(),
  getApiBase: vi.fn(() => ''),
  pendingRedemptions: vi.fn(),
  dayTables: vi.fn(),
  repriceDay: vi.fn(),
  dayManager: vi.fn(),
  saveDayManager: vi.fn(),
}))

// The day is a prop now — App owns it, so it outlives a trip to another tab.
function renderList(props: Partial<React.ComponentProps<typeof List>> = {}) {
  return render(
    <List onSelect={() => {}} date={today()} onDateChange={() => {}} {...props} />
  )
}

const openTable = () => screen.getByRole('table', { name: /^Offen/ })
const paidTable = () => screen.getByRole('table', { name: /^Kassiert/ })

function makeRow(overrides: Partial<Registration>): Registration {
  return {
    id: 1,
    first_name: 'Anna',
    last_name: 'Muster',
    gender: 'female',
    age: 30,
    height_cm: 170,
    weight_kg: 70,
    street: 'Hauptstraße 1',
    postal_code: '5020',
    city: 'Salzburg',
    email: 'anna@example.com',
    phone: '0664 1234567',
    contract_pdf_filename: null,
    accepted_terms: 1,
    tandem_master_id: null,
    load_number: null,
    price: null,
    payment_method: null,
    voucher_payment_method: null,
    voucher_number: null,
    voucher_service: null,
    voucher_topup: 0,
    voucher_amount: null,
    extra_booking: null,
    weight_surcharge: 'none',
    price_override: 0,
    camera_flyer_id: null,
    created_at: '2026-07-09T10:00:00.000Z',
    jump_date: '2026-07-09',
    paid_at: null,
    notes: null,
    privacy_ack_at: '2026-07-09T09:59:00.000Z',
    voucher_redeemed_at: null,
    voucher_redeem_synced_at: null,
    ...overrides,
  }
}

describe('List', () => {
  const PRICES = {
    jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60,
  }
  const PAYOUTS = {
    tandem_master: 45, video: 60, video_photo: 80, weight_over_90: 15, weight_over_100: 25,
  }

  beforeEach(() => {
    vi.mocked(api.masters).mockResolvedValue([])
    vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 0 })
    // A day running on exactly what the settings say: nothing to warn about.
    vi.mocked(api.dayTables).mockResolvedValue({
      prices: PRICES, payouts: PAYOUTS, frozen: true,
      current: { prices: PRICES, payouts: PAYOUTS },
    })
    vi.mocked(api.dayManager).mockResolvedValue({ name: '' })
    vi.mocked(api.saveDayManager).mockImplementation(async (_date, name) => ({ name: name.trim() }))
  })

  // The Betriebsleiter on duty. It is a fact of the day, so it is loaded with
  // the day and written back against that date — the export reads it from there.
  describe('Betriebsleiter', () => {
    const field = () => screen.getByLabelText('Betriebsleiter')

    // The suite does not reset mocks between tests, so call counts carry over —
    // and "was not saved" is exactly what a few of these assert. Implementations
    // set in the outer beforeEach survive this.
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('shows the name stored for the day', async () => {
      vi.mocked(api.list).mockResolvedValue([])
      vi.mocked(api.dayManager).mockResolvedValue({ name: 'Max Muster' })

      renderList({ date: '2026-07-09' })

      await waitFor(() => expect(field()).toHaveValue('Max Muster'))
      expect(api.dayManager).toHaveBeenCalledWith('2026-07-09')
    })

    it('starts empty on a day nobody named one for', async () => {
      vi.mocked(api.list).mockResolvedValue([])

      renderList({ date: '2026-07-09' })

      await waitFor(() => expect(field()).toHaveValue(''))
    })

    it('saves the typed name against the day when the field is left', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      renderList({ date: '2026-07-09' })
      await waitFor(() => expect(field()).toHaveValue(''))

      await user.type(field(), 'Max Muster')
      expect(api.saveDayManager).not.toHaveBeenCalled()
      await user.tab()

      await waitFor(() =>
        expect(api.saveDayManager).toHaveBeenCalledWith('2026-07-09', 'Max Muster'))
    })

    it('does not write the day again when the name was not touched', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      vi.mocked(api.dayManager).mockResolvedValue({ name: 'Max Muster' })
      renderList({ date: '2026-07-09' })
      await waitFor(() => expect(field()).toHaveValue('Max Muster'))

      await user.click(field())
      await user.tab()

      expect(api.saveDayManager).not.toHaveBeenCalled()
    })

    // Clicking Exportieren blurs the field, and the sheet has to carry what is
    // standing in it — not the name from before the last keystroke.
    it('writes a pending name before the export runs', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      const calls: string[] = []
      vi.mocked(api.saveDayManager).mockImplementation(async () => {
        calls.push('save')
        return { name: 'Max Muster' }
      })
      vi.mocked(api.exportDay).mockImplementation(async () => {
        calls.push('export')
        return {
          path: 'C:/export/Tandem_2026-07-09.xlsx', count: 0,
          redemptionsWritten: 0, redemptionsPending: 0, redemptionsInvalid: 0,
        }
      })
      renderList({ date: '2026-07-09' })
      await waitFor(() => expect(field()).toHaveValue(''))

      await user.type(field(), 'Max Muster')
      await user.click(screen.getByRole('button', { name: 'Exportieren' }))

      await screen.findByText(/Export erstellt/)
      expect(calls).toEqual(['save', 'export'])
    })

    // A sheet whose Betriebsleiter line is out of date is worse than no sheet:
    // it looks finished and names the wrong person.
    it('does not export when the name could not be saved', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      vi.mocked(api.saveDayManager).mockRejectedValue(new Error('Betriebsleiter speichern fehlgeschlagen'))
      renderList({ date: '2026-07-09' })
      await waitFor(() => expect(field()).toHaveValue(''))

      await user.type(field(), 'Max Muster')
      await user.click(screen.getByRole('button', { name: 'Exportieren' }))

      expect(await screen.findByText('Betriebsleiter speichern fehlgeschlagen')).toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
    })

    it('reports a failed save instead of dropping it silently', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      vi.mocked(api.saveDayManager).mockRejectedValue(new Error('Betriebsleiter speichern fehlgeschlagen'))
      renderList({ date: '2026-07-09' })
      await waitFor(() => expect(field()).toHaveValue(''))

      await user.type(field(), 'Max Muster')
      await user.tab()

      expect(await screen.findByText('Betriebsleiter speichern fehlgeschlagen')).toBeInTheDocument()
    })
  })

  it('renders one table row per registration', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster' }),
      makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel' }),
    ])

    renderList()

    expect(await screen.findByText('Anna Muster')).toBeInTheDocument()
    expect(screen.getByText('Bruno Beispiel')).toBeInTheDocument()

    // header row + 2 data rows
    expect(within(openTable()).getAllByRole('row')).toHaveLength(3)
  })

  it('keeps uncollected tandems above and collected ones below', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, first_name: 'Offen', last_name: 'Gast' }),
      makeRow({ id: 2, first_name: 'Bezahlt', last_name: 'Gast', paid_at: '2026-07-09T12:00:00.000Z' }),
    ])

    renderList()

    await screen.findByText('Offen Gast')
    expect(within(openTable()).getByText('Offen Gast')).toBeInTheDocument()
    expect(within(openTable()).queryByText('Bezahlt Gast')).not.toBeInTheDocument()
    expect(within(paidTable()).getByText('Bezahlt Gast')).toBeInTheDocument()
  })

  it('counts each table in its own heading', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1 }),
      makeRow({ id: 2 }),
      makeRow({ id: 3, paid_at: '2026-07-09T12:00:00.000Z' }),
    ])

    renderList()

    expect(await screen.findByText('Offen (2)')).toBeInTheDocument()
    expect(screen.getByText('Kassiert (1)')).toBeInTheDocument()
  })

  it('moves a row down when it is marked as collected', async () => {
    const row = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster' })
    vi.mocked(api.list).mockResolvedValue([row])
    vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: '2026-07-09T12:00:00.000Z' })

    renderList()
    await screen.findByText('Anna Muster')

    await userEvent.click(within(openTable()).getByRole('button', { name: /kassiert/i }))

    expect(api.patch).toHaveBeenCalledWith(1, { paid: true })
    await waitFor(() => expect(within(paidTable()).getByText('Anna Muster')).toBeInTheDocument())
  })

  it('moves a row back up when the collection is undone', async () => {
    const row = makeRow({ id: 1, paid_at: '2026-07-09T12:00:00.000Z' })
    vi.mocked(api.list).mockResolvedValue([row])
    vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: null })

    renderList()
    await screen.findByText('Anna Muster')

    await userEvent.click(within(paidTable()).getByRole('button', { name: 'Als offen markieren' }))

    expect(api.patch).toHaveBeenCalledWith(1, { paid: false })
    await waitFor(() => expect(within(openTable()).getByText('Anna Muster')).toBeInTheDocument())
  })

  it('does not open the detail screen when the collect button is used', async () => {
    const row = makeRow({ id: 1 })
    vi.mocked(api.list).mockResolvedValue([row])
    vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: '2026-07-09T12:00:00.000Z' })
    const onSelect = vi.fn()

    renderList({ onSelect })
    await screen.findByText('Anna Muster')

    await userEvent.click(within(openTable()).getByRole('button', { name: /kassiert/i }))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('tells each table apart when one side is empty', async () => {
    vi.mocked(api.list).mockResolvedValue([makeRow({ id: 1 })])

    renderList()

    expect(await screen.findByText('Noch nichts kassiert.')).toBeInTheDocument()
    expect(screen.queryByText('Keine offenen Einträge.')).not.toBeInTheDocument()
  })

  it('shows the flown service and the weight surcharge', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ extra_booking: 'video_photo', weight_surcharge: 'over_100' }),
    ])

    renderList()

    expect(await screen.findByText('Sprung+Video+Foto')).toBeInTheDocument()
    expect(screen.getByText('ab 100 kg')).toBeInTheDocument()
  })

  it('does not repeat the voucher service beside the flown service', async () => {
    // A jump+video voucher upgraded to video+photo is ONE jump. Rendering the
    // voucher service too printed "Sprung+Video" next to "Sprung+Video+Foto",
    // which read like two bookings.
    vi.mocked(api.list).mockResolvedValue([
      makeRow({
        payment_method: 'voucher',
        voucher_service: 'jump_video',
        extra_booking: 'video_photo',
      }),
    ])

    renderList()

    expect(await screen.findByText('Sprung+Video+Foto')).toBeInTheDocument()
    expect(screen.queryByText('Sprung+Video')).not.toBeInTheDocument()
  })

  it('shows which till a voucher top-up was paid into', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ payment_method: 'voucher', voucher_payment_method: 'cash' }),
    ])

    renderList()

    expect(await screen.findByText('Gutschein')).toBeInTheDocument()
    expect(screen.getByText('Bar')).toBeInTheDocument()
  })

  it('shows no surcharge pill when none is set', async () => {
    vi.mocked(api.list).mockResolvedValue([makeRow({ weight_surcharge: 'none' })])

    renderList()

    await screen.findByText('Anna Muster')
    expect(screen.queryByText('ab 90 kg')).not.toBeInTheDocument()
    expect(screen.queryByText('kein Zuschlag')).not.toBeInTheDocument()
  })

  it('sums the day’s takings in the toolbar, split by what is still open', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, price: 410 }),
      makeRow({ id: 2, price: 100 }),
      // Not manifested yet — must not break the sum.
      makeRow({ id: 3, price: null }),
      makeRow({ id: 4, price: 270, payment_method: 'cash', paid_at: '2026-07-09T12:00:00.000Z' }),
    ])

    renderList()

    expect(await screen.findByText('Offen: 510 €')).toBeInTheDocument()
    expect(screen.getByText('Kassiert Bar: 270 €')).toBeInTheDocument()
    expect(screen.getByText('Kassiert Karte: 0 €')).toBeInTheDocument()
  })

  it('splits the collected sum by till, counting a voucher row by its top-up', async () => {
    const paid = { paid_at: '2026-07-09T12:00:00.000Z' }
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, price: 100, payment_method: 'cash', ...paid }),
      makeRow({ id: 2, price: 200, payment_method: 'card', ...paid }),
      makeRow({ id: 3, price: 50, payment_method: 'voucher', voucher_payment_method: 'cash', ...paid }),
      // Collected, but nobody recorded the till: belongs to neither sum.
      makeRow({ id: 4, price: 30, ...paid }),
      // Still open cash — not collected, not counted.
      makeRow({ id: 5, price: 400, payment_method: 'cash' }),
    ])

    renderList()

    expect(await screen.findByText('Kassiert Bar: 150 €')).toBeInTheDocument()
    expect(screen.getByText('Kassiert Karte: 200 €')).toBeInTheDocument()
  })

  it('shows the day it was handed, in the format the input speaks', async () => {
    vi.mocked(api.list).mockResolvedValue([])

    renderList({ date: '2026-07-09' })

    const dateInput = screen.getByLabelText('Datum') as HTMLInputElement
    expect(dateInput.value).toBe('2026-07-09')
    expect(api.list).toHaveBeenCalledWith('2026-07-09')
    await screen.findByText('Keine Registrierungen für dieses Datum.')
  })

  it('offers "Heute" only while it would take the operator somewhere', async () => {
    const onDateChange = vi.fn()
    vi.mocked(api.list).mockResolvedValue([])

    const { unmount } = renderList({ date: '2026-07-09', onDateChange })
    await screen.findByText('Keine Registrierungen für dieses Datum.')

    const heute = screen.getByRole('button', { name: 'Heute' })
    expect(heute).toBeEnabled()
    await userEvent.click(heute)
    expect(onDateChange).toHaveBeenCalledWith(today())

    unmount()
    renderList({ date: today(), onDateChange })
    await screen.findByText('Keine Registrierungen für dieses Datum.')
    expect(screen.getByRole('button', { name: 'Heute' })).toBeDisabled()
  })

  it('counts a single written redemption the way the banner counts one', async () => {
    const user = userEvent.setup()
    vi.mocked(api.list).mockResolvedValue([])
    vi.mocked(api.exportDay).mockResolvedValue({
      path: 'C:/export/Tandem_2026-07-09.xlsx', count: 1,
      redemptionsWritten: 1, redemptionsPending: 0, redemptionsInvalid: 0,
    })
    renderList()
    await screen.findByText('Keine Registrierungen für dieses Datum.')

    await user.click(screen.getByRole('button', { name: 'Exportieren' }))

    // The banner right above gets the singular right; this line has to agree,
    // or one number reads as two.
    expect(await screen.findByText(/1 Einlösung eingetragen/)).toBeInTheDocument()
    expect(screen.queryByText(/1 Einlösungen/)).not.toBeInTheDocument()
  })

  it('says how many redemptions the club list is still missing', async () => {
    vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 2 })
    renderList({ onSelect: vi.fn() })

    expect(await screen.findByText(/2 Einlösungen noch nicht/)).toBeInTheDocument()
  })

  // A jump day runs on the price list it was started with. Editing the settings
  // afterwards is a decision about the next day — the running day can still be
  // moved deliberately, a day that is over cannot.
  describe('a day older than the price list', () => {
    const olderDay = {
      prices: { ...PRICES, jump: 250 },
      payouts: PAYOUTS,
      frozen: true,
      current: { prices: PRICES, payouts: PAYOUTS },
    }

    it('says so, and offers to move the whole day', async () => {
      vi.mocked(api.list).mockResolvedValue([makeRow({})])
      vi.mocked(api.dayTables).mockResolvedValue(olderDay)
      // The server moves the day; from then on it answers that the two agree.
      vi.mocked(api.repriceDay).mockImplementation(async () => {
        vi.mocked(api.dayTables).mockResolvedValue({
          prices: PRICES, payouts: PAYOUTS, frozen: true,
          current: { prices: PRICES, payouts: PAYOUTS },
        })
        return { updated: 1 }
      })
      renderList({ date: today() })

      await screen.findByText(/läuft auf der Preisliste von seinem Beginn/)
      await userEvent.click(
        screen.getByRole('button', { name: 'Preise für diesen Tag aktualisieren' })
      )

      expect(api.repriceDay).toHaveBeenCalledWith(today())
      // And the banner goes away by asking again, not by assuming it worked.
      await waitFor(() =>
        expect(screen.queryByText(/läuft auf der Preisliste/)).not.toBeInTheDocument()
      )
    })

    it('explains a day that is over without offering to change it', async () => {
      // Those amounts were collected from real guests and are usually already
      // exported. A price list edited afterwards does not get a say.
      vi.mocked(api.list).mockResolvedValue([makeRow({})])
      vi.mocked(api.dayTables).mockResolvedValue(olderDay)
      renderList({ date: '2026-07-09' })

      await screen.findByText(/Abgeschlossene Tage bleiben/)
      expect(
        screen.queryByRole('button', { name: 'Preise für diesen Tag aktualisieren' })
      ).not.toBeInTheDocument()
    })

    it('stays quiet while the day and the settings agree', async () => {
      vi.mocked(api.list).mockResolvedValue([])
      renderList()

      await screen.findByText('Keine Registrierungen für dieses Datum.')
      expect(screen.queryByText(/läuft auf der Preisliste/)).not.toBeInTheDocument()
    })

    it('stays quiet for a day nobody has registered on yet', async () => {
      // Not settled, only quoted: there is nothing here that a price change
      // would fail to reach.
      vi.mocked(api.list).mockResolvedValue([])
      vi.mocked(api.dayTables).mockResolvedValue({ ...olderDay, frozen: false })
      renderList({ date: '2026-12-24' })

      await screen.findByText('Keine Registrierungen für dieses Datum.')
      expect(screen.queryByText(/läuft auf der Preisliste/)).not.toBeInTheDocument()
    })
  })

  // Two things about a day can make an export misleading, and neither is
  // visible from the button: a tandem that is not collected never reaches the
  // club's Gutscheinliste, and one without a Zahlungsart lands in the sheet's
  // "Summe ohne Zahlungsart" line. The panel says so before the sheet is
  // written.
  describe('Export-Warnung', () => {
    const exportButton = () => screen.getByRole('button', { name: 'Exportieren' })

    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(api.masters).mockResolvedValue([])
      vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 0 })
      vi.mocked(api.dayTables).mockResolvedValue({
        prices: PRICES, payouts: PAYOUTS, frozen: true,
        current: { prices: PRICES, payouts: PAYOUTS },
      })
      vi.mocked(api.dayManager).mockResolvedValue({ name: '' })
      vi.mocked(api.saveDayManager).mockImplementation(async (_d, name) => ({ name: name.trim() }))
      vi.mocked(api.exportDay).mockResolvedValue({
        path: 'C:/export/Tandem_2026-07-09.xlsx', count: 1,
        redemptionsWritten: 0, redemptionsPending: 0, redemptionsInvalid: 0,
      })
    })

    it('exports straight away when the day is collected and paid for', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'cash', price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(screen.queryByText(/noch nicht kassiert/)).not.toBeInTheDocument()
    })

    it('warns instead of exporting while tandems are still open', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
        makeRow({ id: 2, payment_method: 'card', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      // Both rows default to the same name, so more than one "Anna Muster" is
      // expected here — the wait is only for the list to have rendered.
      await screen.findAllByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/2 Tandems sind noch nicht kassiert\./))
        .toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
    })

    // The voucher count is the point of the whole panel: those are the rows the
    // club's list silently never hears about.
    it('names how many of the open tandems are on a voucher', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
        makeRow({
          id: 2, payment_method: 'voucher', voucher_payment_method: 'cash',
          voucher_number: 'G-1', price: 30,
        }),
      ])
      renderList({ date: '2026-07-09' })
      // Both rows default to the same name, so more than one "Anna Muster" is
      // expected here — the wait is only for the list to have rendered.
      await screen.findAllByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(
        /2 Tandems sind noch nicht kassiert, davon 1 mit Gutschein\./
      )).toBeInTheDocument()
      expect(screen.getByText(/Nur kassierte Tandems mit Gutschein/)).toBeInTheDocument()
    })

    it('gets the singular right for a single open tandem', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/^1 Tandem ist noch nicht kassiert\./))
        .toBeInTheDocument()
    })

    // A collected row without a Zahlungsart is exactly what the sheet's
    // "Summe ohne Zahlungsart" line flags, so it is worth catching while it can
    // still be fixed.
    it('counts a collected tandem that has no Zahlungsart', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: null, price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/1 Tandem hat keine Zahlungsart\./)).toBeInTheDocument()
      expect(screen.getByText(/Summe ohne Zahlungsart/)).toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
    })

    // Nothing was paid, so there is no till the row could be missing from. The
    // export's own total ignores it for the same reason.
    it('leaves a fully covered voucher alone', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'voucher',
          voucher_payment_method: null, voucher_number: 'G-1', price: 0,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(screen.queryByText(/keine Zahlungsart/)).not.toBeInTheDocument()
    })

    it('exports anyway when the operator says so', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(await screen.findByRole('button', { name: 'Trotzdem exportieren' }))

      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(api.exportDay).toHaveBeenCalledWith('2026-07-09')
      expect(screen.queryByText(/noch nicht kassiert/)).not.toBeInTheDocument()
    })

    it('writes nothing when the operator cancels', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(await screen.findByRole('button', { name: 'Abbrechen' }))

      await waitFor(() =>
        expect(screen.queryByText(/noch nicht kassiert/)).not.toBeInTheDocument())
      expect(api.exportDay).not.toHaveBeenCalled()
      expect(api.saveDayManager).not.toHaveBeenCalled()
    })

    // The loop goes through the same PATCH as a row's own ✓ Kassiert button.
    // That handler is where a voucher row's redemption is queued for the export
    // sweep, so a bulk route of its own would have to repeat that rule to stay
    // correct.
    it('collects every open tandem and then exports', async () => {
      const user = userEvent.setup()
      const a = makeRow({ id: 1, first_name: 'Anna', payment_method: 'cash', price: 270 })
      const b = makeRow({ id: 2, first_name: 'Bruno', payment_method: 'card', price: 270 })
      vi.mocked(api.list).mockResolvedValue([a, b])
      const calls: string[] = []
      vi.mocked(api.patch).mockImplementation(async (id) => {
        calls.push(`patch:${id}`)
        return { ...(id === 1 ? a : b), paid_at: '2026-07-09T12:00:00.000Z' }
      })
      vi.mocked(api.exportDay).mockImplementation(async () => {
        calls.push('export')
        return {
          path: 'C:/export/Tandem_2026-07-09.xlsx', count: 2,
          redemptionsWritten: 0, redemptionsPending: 0, redemptionsInvalid: 0,
        }
      })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(
        await screen.findByRole('button', { name: 'Alle kassieren und exportieren' }))

      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(api.patch).toHaveBeenCalledWith(1, { paid: true })
      expect(api.patch).toHaveBeenCalledWith(2, { paid: true })
      expect(calls).toEqual(['patch:1', 'patch:2', 'export'])
    })

    // A half-collected day must not reach the club's sheet: it would look
    // finished while some of the money still shows as outstanding.
    it('does not export when one of the rows could not be collected', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      vi.mocked(api.patch).mockRejectedValue(new Error('Speichern fehlgeschlagen'))
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(
        await screen.findByRole('button', { name: 'Alle kassieren und exportieren' }))

      expect(await screen.findByText('Speichern fehlgeschlagen')).toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
    })

    // Nothing is open, so there is nothing to collect — offering the button
    // would promise an action that does nothing.
    it('offers no bulk collect when only the Zahlungsart is missing', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: null, price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/keine Zahlungsart/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Alle kassieren und exportieren' }))
        .not.toBeInTheDocument()
    })
  })
})
