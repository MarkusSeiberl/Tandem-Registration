import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import List from './List'
import * as api from './api'
import type { Registration } from './api'
import { today } from './date'
import { fireChangedEvent } from './setupTests'

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

    // Clicking Tagesabschluss blurs the field, and the sheet has to carry what is
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
      await user.click(screen.getByRole('button', { name: 'Tagesabschluss' }))

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
      await user.click(screen.getByRole('button', { name: 'Tagesabschluss' }))

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
    const user = userEvent.setup()
    const row = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270 })
    vi.mocked(api.list).mockResolvedValue([row])
    vi.mocked(api.patch).mockResolvedValue({
      ...row, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'cash',
    })

    renderList()
    await screen.findByText('Anna Muster')

    // The row button asks the same question the toolbar's Kassieren asks, for
    // one row: a Zahlungsart, before any money is booked.
    await user.click(within(openTable()).getByRole('button', { name: /kassiert/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('1 Tandem kassieren')).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Zahlungsart'), 'cash')
    await user.click(within(dialog).getByRole('button', { name: 'Kassieren' }))

    expect(api.patch).toHaveBeenCalledWith(1, { paid: true, payment_method: 'cash' })
    await waitFor(() => expect(within(paidTable()).getByText('Anna Muster')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  // The count each table already carries in its caption is the honest one —
  // a day total in the toolbar only invited adding the two up by hand.
  it('does not repeat the row count in the toolbar', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster' }),
      makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel' }),
    ])

    renderList()
    await screen.findByText('Anna Muster')

    expect(screen.queryByText(/^\d+ Einträge$/)).not.toBeInTheDocument()
    expect(screen.getByText('Offen (2)')).toBeInTheDocument()
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
    // A clean day with nobody named as Betriebsleiter would open the warning
    // panel instead — not what this test is checking.
    vi.mocked(api.dayManager).mockResolvedValue({ name: 'Max Muster' })
    vi.mocked(api.list).mockResolvedValue([])
    vi.mocked(api.exportDay).mockResolvedValue({
      path: 'C:/export/Tandem_2026-07-09.xlsx', count: 1,
      redemptionsWritten: 1, redemptionsPending: 0, redemptionsInvalid: 0,
    })
    renderList()
    await screen.findByText('Keine Registrierungen für dieses Datum.')

    await user.click(screen.getByRole('button', { name: 'Tagesabschluss' }))

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
    const exportButton = () => screen.getByRole('button', { name: 'Tagesabschluss' })
    // The panel's own Betriebsleiter field carries the same label as the one in
    // the toolbar, so tests that need one or the other scope the query to its
    // container instead of adding a test-only hook to the markup.
    const panel = () => document.querySelector('.export-warning') as HTMLElement
    const toolbar = () => document.querySelector('.list-toolbar') as HTMLElement

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
      // A clean day still needs its Betriebsleiter — without one, this test's
      // own point (straight-away export) would not hold any more.
      vi.mocked(api.dayManager).mockResolvedValue({ name: 'Max Muster' })
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
      expect(screen.queryByText(/Kein Betriebsleiter/)).not.toBeInTheDocument()
    })

    // The third reason the panel opens: a clean, fully paid day with nobody
    // named as Betriebsleiter still must not export silently, because the
    // sheet's BL line would come out blank.
    it('warns instead of exporting when the day has no Betriebsleiter', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'cash', price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(
        'Kein Betriebsleiter eingetragen. Die BL-Zeile im Blatt bliebe leer.'
      )).toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
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

    // A voucher row with an unpaid top-up is in both openVoucherRows and
    // noPaymentOpenRows at once (see collectedVia in pricing.ts) — the case the
    // merged sentence has to keep readable rather than letting "und haben"
    // read as continuing "davon 1 mit Gutschein".
    it('reads naturally when an open voucher row is also missing a Zahlungsart', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: null, price: 270 }),
        makeRow({
          id: 2, payment_method: 'voucher', voucher_payment_method: null,
          voucher_number: 'G-1', price: 30,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findAllByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(
        /^2 Tandems sind noch nicht kassiert und haben noch keine Zahlungsart, davon 1 mit Gutschein\.$/
      )).toBeInTheDocument()
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

    // A fresh registration is inserted with no payment_method at all, so for
    // most of the day "open" and "no Zahlungsart" are the same tandems. Two
    // independent sentences would count each of them twice.
    it('does not count the same open tandems twice as also missing a Zahlungsart', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: null, price: 270 }),
        makeRow({ id: 2, payment_method: null, price: 270 }),
        makeRow({ id: 3, payment_method: null, price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findAllByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(
        /^3 Tandems sind noch nicht kassiert und haben noch keine Zahlungsart\.$/
      )).toBeInTheDocument()
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
      // Otherwise the missing Betriebsleiter would open the panel this test is
      // not about.
      vi.mocked(api.dayManager).mockResolvedValue({ name: 'Max Muster' })
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

    // The label reads the live field, not the snapshot the panel opened on —
    // typing a name while the panel stands turns "Trotzdem exportieren" back
    // into a plain "Exportieren".
    it('drops the "Trotzdem" from the export button once a name is typed into the panel', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'cash', price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      expect(await screen.findByRole('button', { name: 'Trotzdem exportieren' })).toBeInTheDocument()

      await user.type(within(panel()).getByLabelText('Betriebsleiter'), 'Max Muster')

      expect(await screen.findByRole('button', { name: 'Exportieren' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Trotzdem exportieren' })).not.toBeInTheDocument()
    })

    // A name in the toolbar does not make the day clean — with a tandem still
    // open, "Trotzdem exportieren" is the one cue that the click skips
    // something, and that must not disappear just because the Betriebsleiter
    // field happens to be filled in.
    it('keeps saying "Trotzdem exportieren" for an open tandem even with a Betriebsleiter set', async () => {
      const user = userEvent.setup()
      vi.mocked(api.dayManager).mockResolvedValue({ name: 'Max Muster' })
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByRole('button', { name: 'Trotzdem exportieren' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Exportieren' })).not.toBeInTheDocument()
    })

    // The panel opened only because the name was missing — the override still
    // has to write the sheet once the operator says so anyway.
    it('exports anyway from a panel opened only for the missing Betriebsleiter', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'cash', price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(await screen.findByRole('button', { name: 'Trotzdem exportieren' }))

      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(api.exportDay).toHaveBeenCalledWith('2026-07-09')
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

    // The bulk PATCH only stamps paid_at, never a Zahlungsart, so "collect all"
    // can walk straight into the second problem the panel warned about. The
    // operator must be asked again, not have the sheet written silently.
    it('asks again instead of exporting when the collected rows still have no Zahlungsart', async () => {
      const user = userEvent.setup()
      const a = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', payment_method: null, price: 270 })
      const b = makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', payment_method: null, price: 270 })
      vi.mocked(api.list).mockResolvedValue([a, b])
      vi.mocked(api.patch).mockImplementation(async (id) =>
        ({ ...(id === 1 ? a : b), paid_at: '2026-07-09T12:00:00.000Z' }))
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(
        await screen.findByRole('button', { name: 'Alle kassieren und exportieren' }))

      expect(await screen.findByText(/2 Tandems haben keine Zahlungsart\./)).toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: 'Alle kassieren und exportieren' }))
        .not.toBeInTheDocument()
    })

    // The comment in handleCollectAllAndExport names the half-collected day as
    // the reason for the whole design — this is that day: one row lands, the
    // next fails.
    it('keeps a row that was collected before a later one failed', async () => {
      const user = userEvent.setup()
      const a = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', payment_method: 'cash', price: 270 })
      const b = makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', payment_method: 'card', price: 270 })
      vi.mocked(api.list).mockResolvedValue([a, b])
      vi.mocked(api.patch).mockImplementation(async (id) => {
        if (id === 1) return { ...a, paid_at: '2026-07-09T12:00:00.000Z' }
        throw new Error('Speichern fehlgeschlagen')
      })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(
        await screen.findByRole('button', { name: 'Alle kassieren und exportieren' }))

      expect(await screen.findByText('Speichern fehlgeschlagen')).toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
      await waitFor(() => expect(within(paidTable()).getByText('Anna Muster')).toBeInTheDocument())
      expect(within(openTable()).getByText('Bruno Beispiel')).toBeInTheDocument()
    })

    // Retrying after a partial failure is fine — openRows is re-derived at
    // click time and the PATCH is idempotent — but the panel must not go on
    // describing the day from before the row that already landed.
    it('updates the panel counts after a partial collect failure', async () => {
      const user = userEvent.setup()
      const a = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', payment_method: 'cash', price: 270 })
      const b = makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', payment_method: 'card', price: 270 })
      vi.mocked(api.list).mockResolvedValue([a, b])
      vi.mocked(api.patch).mockImplementation(async (id) => {
        if (id === 1) return { ...a, paid_at: '2026-07-09T12:00:00.000Z' }
        throw new Error('Speichern fehlgeschlagen')
      })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      expect(await screen.findByText(/^2 Tandems sind noch nicht kassiert\.$/)).toBeInTheDocument()

      await user.click(
        await screen.findByRole('button', { name: 'Alle kassieren und exportieren' }))

      await screen.findByText('Speichern fehlgeschlagen')
      expect(await screen.findByText(/^1 Tandem ist noch nicht kassiert\.$/)).toBeInTheDocument()
      expect(screen.queryByText(/^2 Tandems sind noch nicht kassiert\.$/)).not.toBeInTheDocument()
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

    // Counts belong to the day they were taken on. Left standing across a date
    // change, the panel would describe yesterday over today's list.
    it('drops the warning when the operator switches days', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      const { rerender } = render(
        <List onSelect={() => {}} date="2026-07-09" onDateChange={() => {}} />
      )
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      expect(await screen.findByText(/noch nicht kassiert/)).toBeInTheDocument()

      rerender(<List onSelect={() => {}} date="2026-07-10" onDateChange={() => {}} />)

      await waitFor(() =>
        expect(screen.queryByText(/noch nicht kassiert/)).not.toBeInTheDocument())
    })

    // The panel's field is bound to the same manager state as the toolbar, not
    // a copy of its own — so a letter typed in one has to show up in the other
    // immediately, without any save round-trip in between.
    it('shows the typed name in the toolbar field too', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'cash', price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.type(within(panel()).getByLabelText('Betriebsleiter'), 'Max Muster')

      expect(within(toolbar()).getByLabelText('Betriebsleiter')).toHaveValue('Max Muster')
    })

    // Pressing the panel's export button has to carry the name the operator
    // just typed there — runExport() saves through the same saveManager() the
    // toolbar's onBlur uses, so there is nothing left to write on top of it.
    it('saves the name typed in the panel before exporting', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'cash', price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.type(within(panel()).getByLabelText('Betriebsleiter'), 'Max Muster')
      await user.click(within(panel()).getByRole('button', { name: 'Exportieren' }))

      await waitFor(() =>
        expect(api.saveDayManager).toHaveBeenCalledWith('2026-07-09', 'Max Muster'))
      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(
        vi.mocked(api.saveDayManager).mock.invocationCallOrder[0]
      ).toBeLessThan(vi.mocked(api.exportDay).mock.invocationCallOrder[0])
    })

    // A panel that opened only because tandems are still open already has a
    // Betriebsleiter — offering a second field there would ask again for
    // nothing.
    it('adds no Betriebsleiter field when the panel opened only for open tandems', async () => {
      const user = userEvent.setup()
      vi.mocked(api.dayManager).mockResolvedValue({ name: 'Max Muster' })
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await screen.findByText(/noch nicht kassiert/)

      expect(within(panel()).queryAllByLabelText('Betriebsleiter')).toHaveLength(0)
    })

    // The field's presence is pinned to the snapshot the panel opened with, not
    // the live value — otherwise it would vanish under the operator's fingers
    // as soon as the warning sentence above it does.
    it('keeps the field once the warning sentence is gone', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'cash', price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.type(within(panel()).getByLabelText('Betriebsleiter'), 'Max Muster')

      expect(screen.queryByText(
        'Kein Betriebsleiter eingetragen. Die BL-Zeile im Blatt bliebe leer.'
      )).not.toBeInTheDocument()
      expect(within(panel()).getByLabelText('Betriebsleiter')).toBeInTheDocument()
    })
  })

  // The selection bar's button collects the checked rows from both tables in one
  // payment method through CollectDialog, using the same PATCH the row
  // button and "Alle kassieren und exportieren" already go through.
  describe('Sammel-Kassieren', () => {
    const checkbox = (name: string) => screen.getByLabelText(`${name} auswählen`)
    // Carries the open count — `Kassieren (3)` — which also keeps it apart from
    // the dialog's own plain `Kassieren` once that is open.
    const collectToolbarButton = () => screen.getByRole('button', { name: /^Kassieren \(/ })
    const dialog = () => screen.getByRole('dialog')

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
    })

    // It is not offered at all without a selection to spend it on, rather than
    // offered and greyed out beside the day's own controls.
    it('appears only once an open row is checked', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      expect(screen.queryByRole('button', { name: /^Kassieren \(/ })).not.toBeInTheDocument()

      await user.click(checkbox('Anna Muster'))

      expect(collectToolbarButton()).toBeEnabled()
      expect(screen.getByText('1 ausgewählt · 1 offen')).toBeInTheDocument()
    })

    it('stays away when only an already-collected row is checked, but Löschen does not', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, first_name: 'Anna', last_name: 'Muster', price: 270,
          payment_method: 'cash', paid_at: '2026-07-09T12:00:00.000Z',
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))

      expect(screen.queryByRole('button', { name: /^Kassieren \(/ })).not.toBeInTheDocument()
      expect(screen.getByText('1 ausgewählt · keine offen')).toBeInTheDocument()
      // Deleting a collected row is still allowed — the two actions of the bar
      // work on different sets.
      expect(screen.getByRole('button', { name: 'Ausgewählte löschen (1)' })).toBeEnabled()
    })

    it('counts Kassieren on the open rows and Löschen on every checked row', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270 }),
        makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 100 }),
        makeRow({
          id: 3, first_name: 'Carla', last_name: 'Muster', price: 100,
          payment_method: 'card', paid_at: '2026-07-09T12:00:00.000Z',
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(checkbox('Bruno Beispiel'))
      await user.click(checkbox('Carla Muster'))

      expect(screen.getByText('3 ausgewählt · 2 offen')).toBeInTheDocument()
      expect(collectToolbarButton()).toHaveAccessibleName('Kassieren (2)')
      expect(screen.getByRole('button', { name: 'Ausgewählte löschen (3)' })).toBeInTheDocument()
    })

    it('lets the whole selection go at once', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270 }),
        makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 100 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(checkbox('Bruno Beispiel'))
      expect(screen.getByText('2 ausgewählt · 2 offen')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Auswahl leeren' }))

      expect(screen.queryByText(/ausgewählt/)).not.toBeInTheDocument()
      expect(checkbox('Anna Muster')).not.toBeChecked()
    })

    it('names the checked-but-collected row and patches only the open one', async () => {
      const user = userEvent.setup()
      const open = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 270, payment_method: 'cash',
      })
      const paid = makeRow({
        id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 100,
        payment_method: 'card', paid_at: '2026-07-09T12:00:00.000Z',
      })
      vi.mocked(api.list).mockResolvedValue([open, paid])
      vi.mocked(api.patch).mockResolvedValue({ ...open, paid_at: '2026-07-09T12:00:00.000Z' })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(checkbox('Bruno Beispiel'))
      await user.click(collectToolbarButton())

      expect(within(dialog()).getByText('1 bereits kassierte Zeile bleibt unverändert.'))
        .toBeInTheDocument()

      await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'cash')
      await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
      expect(api.patch).toHaveBeenCalledWith(1, { paid: true, payment_method: 'cash' })
    })

    it('overwrites an existing payment method on a priced row', async () => {
      const user = userEvent.setup()
      const row = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 230, payment_method: 'cash',
      })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'card' })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(collectToolbarButton())
      await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'card')
      await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith(1, { paid: true, payment_method: 'card' }))
    })

    it('writes a voucher top-up to voucher_payment_method, not payment_method', async () => {
      const user = userEvent.setup()
      const row = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 40, payment_method: 'voucher',
      })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({
        ...row, paid_at: '2026-07-09T12:00:00.000Z', voucher_payment_method: 'card',
      })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(collectToolbarButton())
      await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'card')
      await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith(1, { paid: true, voucher_payment_method: 'card' }))
    })

    // Nothing is owed, so there is no till to name: the dialog would only ask for
    // a Zahlungsart that the loop then refuses to write. It is skipped entirely.
    it('collects fully covered vouchers without asking for a Zahlungsart', async () => {
      const user = userEvent.setup()
      const anna = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 0, payment_method: 'voucher',
      })
      const bruno = makeRow({
        id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 0, payment_method: 'voucher',
      })
      vi.mocked(api.list).mockResolvedValue([anna, bruno])
      vi.mocked(api.patch).mockImplementation(async (id) => ({
        ...(id === 1 ? anna : bruno), paid_at: '2026-07-09T12:00:00.000Z',
      }))
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(checkbox('Bruno Beispiel'))
      await user.click(collectToolbarButton())

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2))
      expect(api.patch).toHaveBeenCalledWith(1, { paid: true })
      expect(api.patch).toHaveBeenCalledWith(2, { paid: true })
      await waitFor(() =>
        expect(within(paidTable()).getByText('Anna Muster')).toBeInTheDocument())
      // Both rows left the open table and the selection with it.
      expect(screen.queryByRole('button', { name: /^Ausgewählte löschen/ }))
        .not.toBeInTheDocument()
    })

    it('still asks when one of the checked rows owes something', async () => {
      const user = userEvent.setup()
      const anna = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 0, payment_method: 'voucher',
      })
      const bruno = makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 270 })
      vi.mocked(api.list).mockResolvedValue([anna, bruno])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(checkbox('Bruno Beispiel'))
      await user.click(collectToolbarButton())

      expect(within(dialog()).getByLabelText('Zahlungsart')).toBeInTheDocument()
      expect(api.patch).not.toHaveBeenCalled()
    })

    // No dialog is open to carry the message, so it has to land on the page.
    it('reports a failed silent collect on the page', async () => {
      const user = userEvent.setup()
      const row = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 0, payment_method: 'voucher',
      })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockRejectedValue(new Error('Kassieren fehlgeschlagen'))
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(collectToolbarButton())

      expect(await screen.findByText('Kassieren fehlgeschlagen')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      // The row is still open and still checked, so a retry runs over it again.
      expect(checkbox('Anna Muster')).toBeChecked()
    })

    it('closes the dialog and clears the selection after a successful run', async () => {
      const user = userEvent.setup()
      const row = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270 })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: '2026-07-09T12:00:00.000Z' })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(collectToolbarButton())
      await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'cash')
      await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      // The row moved to the collected table, so the checkbox that carried the
      // selection is gone with it — an empty selection bar is the observable
      // proxy for "checkedIds is empty" now that nothing is left checked.
      expect(screen.queryByRole('button', { name: /^Ausgewählte löschen/ }))
        .not.toBeInTheDocument()
    })

    // Retrying has to run over exactly what is left: the row already collected
    // must not be asked for again, so checkedIds staying put after a failure
    // is what makes that possible.
    it('keeps the dialog open with the error and the selection on a failure', async () => {
      const user = userEvent.setup()
      const a = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270, payment_method: 'cash' })
      const b = makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 270, payment_method: 'card' })
      vi.mocked(api.list).mockResolvedValue([a, b])
      vi.mocked(api.patch).mockImplementation(async (id) => {
        if (id === 1) return { ...a, paid_at: '2026-07-09T12:00:00.000Z' }
        throw new Error('Kassieren fehlgeschlagen')
      })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(checkbox('Bruno Beispiel'))
      await user.click(collectToolbarButton())
      await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'cash')
      await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

      expect(await within(dialog()).findByText('Kassieren fehlgeschlagen')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      await waitFor(() => expect(within(paidTable()).getByText('Anna Muster')).toBeInTheDocument())
    })

    // The server echoes every PATCH back to the client that sent it (no sender
    // exclusion in SseHub.broadcast), so a bulk-collect loop's own writes trigger
    // the very `changed` event that refresh() listens for — on itself, mid-run.
    describe('das eigene SSE-Echo mitten im Kassieren', () => {
      it('leert den Dialog nicht und verkürzt den Lauf nicht', async () => {
        const user = userEvent.setup()
        const a = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270, payment_method: 'cash' })
        const b = makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 270, payment_method: 'cash' })
        let currentRows: Registration[] = [a, b]
        vi.mocked(api.list).mockImplementation(async () => currentRows)

        let resolveSecondPatch!: (r: Registration) => void
        const secondPatch = new Promise<Registration>((resolve) => { resolveSecondPatch = resolve })
        vi.mocked(api.patch).mockImplementationOnce(async () => ({ ...a, paid_at: '2026-07-09T12:00:00.000Z' }))
        vi.mocked(api.patch).mockImplementationOnce(() => secondPatch)

        renderList({ date: '2026-07-09' })
        await screen.findByText('Anna Muster')

        await user.click(checkbox('Anna Muster'))
        await user.click(checkbox('Bruno Beispiel'))
        await user.click(collectToolbarButton())
        await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'cash')
        await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

        // Anna's PATCH has landed and moved her to the paid table; Bruno's is
        // still in flight. The dialog should now describe exactly Bruno.
        await waitFor(() =>
          expect(within(dialog()).getByRole('heading', { name: '1 Tandem kassieren' }))
            .toBeInTheDocument())

        // Anna's own PATCH broadcasts back to this client before Bruno's resolves.
        currentRows = [{ ...a, paid_at: '2026-07-09T12:00:00.000Z' }, b]
        fireChangedEvent()
        await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))

        // The echo's refresh must not have emptied the dialog while Bruno's PATCH
        // is still outstanding.
        expect(within(dialog()).getByRole('heading', { name: '1 Tandem kassieren' }))
          .toBeInTheDocument()

        resolveSecondPatch({ ...b, paid_at: '2026-07-09T12:00:01.000Z' })

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        // Both rows got patched despite the echo — the run was not cut short.
        expect(api.patch).toHaveBeenCalledTimes(2)
      })

      it('lässt eine zweite Vorlage nur noch die nach einem Fehlschlag offene Zeile kassieren und schließt bei erneutem Fehlschlag nicht', async () => {
        const user = userEvent.setup()
        const a = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270, payment_method: 'cash' })
        const b = makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 270, payment_method: 'cash' })
        let currentRows: Registration[] = [a, b]
        vi.mocked(api.list).mockImplementation(async () => currentRows)
        // Anna always succeeds, Bruno always fails — on both the first attempt
        // and the retry, so the retry's own failure has to leave the dialog open.
        vi.mocked(api.patch).mockImplementation(async (id) => {
          if (id === 1) return { ...a, paid_at: '2026-07-09T12:00:00.000Z' }
          throw new Error('Kassieren fehlgeschlagen')
        })

        renderList({ date: '2026-07-09' })
        await screen.findByText('Anna Muster')

        await user.click(checkbox('Anna Muster'))
        await user.click(checkbox('Bruno Beispiel'))
        await user.click(collectToolbarButton())
        await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'cash')
        await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

        // Anna's PATCH lands and broadcasts back to this client while Bruno's is
        // still failing — the same self-echo as the finding describes.
        await waitFor(() => expect(api.patch).toHaveBeenCalledWith(1, expect.anything()))
        currentRows = [{ ...a, paid_at: '2026-07-09T12:00:00.000Z' }, b]
        fireChangedEvent()

        expect(await within(dialog()).findByText('Kassieren fehlgeschlagen')).toBeInTheDocument()
        expect(screen.getByRole('dialog')).toBeInTheDocument()

        vi.mocked(api.patch).mockClear()

        // Second press: only Bruno should be asked for again.
        await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

        await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
        expect(api.patch).toHaveBeenCalledWith(2, expect.anything())

        // Bruno's PATCH still throws on the retry — a silent success here would
        // close the dialog over a guest who is still unpaid.
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      it('lässt die Auswahl unangetastet, wenn vor der Bestätigung ein fremder Changed-Event eintrifft', async () => {
        const user = userEvent.setup()
        const a = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270, payment_method: 'cash' })
        const c = makeRow({ id: 3, first_name: 'Clara', last_name: 'Neu', price: 270, payment_method: 'cash' })
        let currentRows: Registration[] = [a]
        vi.mocked(api.list).mockImplementation(async () => currentRows)

        renderList({ date: '2026-07-09' })
        await screen.findByText('Anna Muster')

        await user.click(checkbox('Anna Muster'))
        await user.click(collectToolbarButton())

        expect(within(dialog()).getByRole('heading', { name: '1 Tandem kassieren' }))
          .toBeInTheDocument()

        // A guest registers on the tablet while the operator is still choosing a
        // Zahlungsart — an unrelated row, carried by the same broadcast this
        // manifest's own PATCH would trigger.
        currentRows = [a, c]
        fireChangedEvent()
        await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))

        expect(within(dialog()).getByRole('heading', { name: '1 Tandem kassieren' }))
          .toBeInTheDocument()
        expect(checkbox('Anna Muster')).toBeChecked()
        expect(api.patch).not.toHaveBeenCalled()
      })
    })
  })

  // The row's own ✓ Kassiert is the bulk action for exactly one tandem: same
  // dialog, same write rule, and it says nothing about whatever else is checked.
  describe('Zeilen-Kassieren', () => {
    const checkbox = (name: string) => screen.getByLabelText(`${name} auswählen`)
    const dialog = () => screen.getByRole('dialog')
    const rowCollectButton = (name: string) =>
      within(screen.getByText(name).closest('tr')!).getByRole('button', { name: /kassiert/i })

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
    })

    it('collects only its own row and leaves the rest of the selection checked', async () => {
      const user = userEvent.setup()
      const anna = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270 })
      const bruno = makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 270 })
      vi.mocked(api.list).mockResolvedValue([anna, bruno])
      vi.mocked(api.patch).mockResolvedValue({
        ...anna, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'card',
      })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      // Both are checked for a group payment that has not happened yet — Anna
      // pays for herself in between.
      await user.click(checkbox('Anna Muster'))
      await user.click(checkbox('Bruno Beispiel'))
      await user.click(rowCollectButton('Anna Muster'))

      expect(within(dialog()).getByRole('heading', { name: '1 Tandem kassieren' }))
        .toBeInTheDocument()
      await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'card')
      await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
      expect(api.patch).toHaveBeenCalledWith(1, { paid: true, payment_method: 'card' })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      // Bruno is still owed and still selected; only the collected row left the
      // selection, so the delete button is not armed on it.
      expect(checkbox('Bruno Beispiel')).toBeChecked()
      expect(checkbox('Anna Muster')).not.toBeChecked()
    })

    it('says nothing about checked collected rows — it is not collecting them', async () => {
      const user = userEvent.setup()
      const anna = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270 })
      const paid = makeRow({
        id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 100,
        payment_method: 'card', paid_at: '2026-07-09T12:00:00.000Z',
      })
      vi.mocked(api.list).mockResolvedValue([anna, paid])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Bruno Beispiel'))
      await user.click(rowCollectButton('Anna Muster'))

      expect(within(dialog()).queryByText(/bereits kassierte/)).not.toBeInTheDocument()
      expect(within(dialog()).getByText('Offener Betrag:').parentElement)
        .toHaveTextContent('270 €')
    })

    it('writes a voucher top-up to voucher_payment_method', async () => {
      const user = userEvent.setup()
      const row = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 40, payment_method: 'voucher',
      })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({
        ...row, paid_at: '2026-07-09T12:00:00.000Z', voucher_payment_method: 'cash',
      })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(rowCollectButton('Anna Muster'))
      await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'cash')
      await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith(1, { paid: true, voucher_payment_method: 'cash' }))
    })

    it('collects a fully covered row without asking for a Zahlungsart', async () => {
      const user = userEvent.setup()
      const anna = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 0, payment_method: 'voucher',
      })
      const bruno = makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel', price: 270 })
      vi.mocked(api.list).mockResolvedValue([anna, bruno])
      vi.mocked(api.patch).mockResolvedValue({ ...anna, paid_at: '2026-07-09T12:00:00.000Z' })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(checkbox('Anna Muster'))
      await user.click(checkbox('Bruno Beispiel'))
      await user.click(rowCollectButton('Anna Muster'))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
      expect(api.patch).toHaveBeenCalledWith(1, { paid: true })
      // Bruno still owes and stays checked; only the collected row left.
      expect(checkbox('Bruno Beispiel')).toBeChecked()
    })

    it('keeps the dialog open with the message when the PATCH fails', async () => {
      const user = userEvent.setup()
      const row = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', price: 270 })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockRejectedValue(new Error('Kassieren fehlgeschlagen'))
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(rowCollectButton('Anna Muster'))
      await user.selectOptions(within(dialog()).getByLabelText('Zahlungsart'), 'cash')
      await user.click(within(dialog()).getByRole('button', { name: 'Kassieren' }))

      expect(await within(dialog()).findByText('Kassieren fehlgeschlagen')).toBeInTheDocument()
    })

    it('sends a row back to open without asking for a Zahlungsart', async () => {
      const user = userEvent.setup()
      const row = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 270,
        payment_method: 'cash', paid_at: '2026-07-09T12:00:00.000Z',
      })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: null })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(within(paidTable()).getByRole('button', { name: 'Als offen markieren' }))

      expect(api.patch).toHaveBeenCalledWith(1, { paid: false })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
