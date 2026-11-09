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
  dayClose: vi.fn(),
  saveDayClose: vi.fn(),
}))

// The day is a prop now — App owns it, so it outlives a trip to another tab.
function renderList(props: Partial<React.ComponentProps<typeof List>> = {}) {
  return render(
    <List onSelect={() => {}} date={today()} onDateChange={() => {}} {...props} />
  )
}

// One figure of the day's totals block, read off by its term.
const total = (term: string) =>
  screen.getByText(term, { selector: '.day-totals dt' }).nextElementSibling?.textContent

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
    voucher_check_status: null,
    voucher_check_detail: null,
    voucher_accepted: 0,
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

  it('marks a voucher the club list rejects, with the reason as tooltip', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster', voucher_check_status: 'unpaid' }),
      makeRow({
        id: 2, first_name: 'Bruno', last_name: 'Beispiel',
        voucher_check_status: 'redeemed', voucher_check_detail: '2026-07-12',
        paid_at: '2026-07-09T12:00:00.000Z',
      }),
      makeRow({ id: 3, first_name: 'Clara', last_name: 'Gut' }),
    ])

    renderList()

    const unpaid = await within(openTable()).findByLabelText('Nicht bezahlt — Gutschein ist nicht gültig.')
    expect(unpaid).toHaveAttribute('title', 'Nicht bezahlt — Gutschein ist nicht gültig.')
    expect(within(paidTable()).getByLabelText('Bereits eingelöst am 12.07.2026.')).toBeInTheDocument()
    expect(screen.getAllByText('⚠')).toHaveLength(2)
    expect(unpaid.closest('tr')).toHaveClass('voucher-flagged')
    expect(screen.getByText('Clara Gut').closest('tr')).not.toHaveClass('voucher-flagged')
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
    await user.click(within(openTable()).getByRole('button', { name: /kassieren$/i }))
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

    await userEvent.click(within(openTable()).getByRole('button', { name: /kassieren$/i }))

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

    expect(await screen.findByText('Video + Foto')).toBeInTheDocument()
    expect(screen.getByText('ab 100 kg')).toBeInTheDocument()
  })

  it('does not repeat the voucher service beside the flown service', async () => {
    // A jump+video voucher upgraded to video+photo is ONE jump. Rendering the
    // voucher service too printed "Sprung+Video" next to "Video + Foto",
    // which read like two bookings.
    vi.mocked(api.list).mockResolvedValue([
      makeRow({
        payment_method: 'voucher',
        voucher_service: 'jump_video',
        extra_booking: 'video_photo',
      }),
    ])

    renderList()

    expect(await screen.findByText('Video + Foto')).toBeInTheDocument()
    expect(screen.queryByText('Sprung+Video')).not.toBeInTheDocument()
  })

  it('shows which till a voucher top-up was paid into', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ payment_method: 'voucher', voucher_payment_method: 'cash' }),
    ])

    renderList()

    expect(await screen.findByText('Gutschein')).toBeInTheDocument()
    expect(within(openTable()).getByText('Bar')).toBeInTheDocument()
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

    await waitFor(() => expect(total('Offen')).toBe('510 €'))
    expect(total('Bar')).toBe('270 €')
    expect(total('Karte')).toBe('0 €')
    // The tills added up, to hold against the cash box and the card terminal.
    expect(total('Kassiert')).toBe('270 €')
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

    await waitFor(() => expect(total('Bar')).toBe('150 €'))
    expect(total('Karte')).toBe('200 €')
    // Row 4 has no till, so it is in neither sum nor in their total.
    expect(total('Kassiert')).toBe('350 €')
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

  it('says beside Kassiert how many of the day\'s vouchers the club list is missing', async () => {
    vi.mocked(api.list).mockResolvedValue([makeRow({ paid_at: '2026-07-09T10:00:00.000Z' })])
    vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 2 })
    renderList({ date: '2026-07-09' })

    const note = await screen.findByText(/2 Gutscheine noch nicht in die Gutscheinliste/)
    expect(note.closest('caption')?.textContent).toContain('Kassiert')
    expect(api.pendingRedemptions).toHaveBeenCalledWith('2026-07-09')
  })

  it('shows no voucher note when the day has nothing outstanding', async () => {
    vi.mocked(api.list).mockResolvedValue([makeRow({ paid_at: '2026-07-09T10:00:00.000Z' })])
    renderList({ date: '2026-07-09' })

    await screen.findByText(/Kassiert \(1\)/)
    expect(screen.queryByText(/noch nicht in die Gutscheinliste/)).not.toBeInTheDocument()
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

  // The day closes through a guided dialog (dayClose/DayCloseDialog). What the
  // list owns is the rows and the one write rule for collecting them, so these
  // tests check that the dialog's buttons end up in exactly that PATCH.
  describe('Tagesabschluss-Dialog', () => {
    const PAID = '2026-07-09T12:00:00.000Z'
    const closing = () => screen.getByRole('dialog', { name: 'Tagesabschluss' })
    const openClosing = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Tagesabschluss' }))
      return closing()
    }

    beforeEach(() => {
      vi.mocked(api.dayClose).mockResolvedValue({ countedCash: null, countedCard: null, note: '', exportedAt: null })
      vi.mocked(api.saveDayClose).mockImplementation(async (_d, draft) => ({ ...draft, exportedAt: null }))
    })

    it('opens the dialog instead of exporting', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Keine Registrierungen für dieses Datum.')
      expect(await openClosing(user)).toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
    })

    it('Bar in the dialog collects the row into the cash till', async () => {
      const user = userEvent.setup()
      const row = makeRow({ id: 7, first_name: 'Anna', last_name: 'Huber', price: 259 })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: PAID, payment_method: 'cash' })
      renderList({ date: '2026-07-09' })
      await within(openTable()).findByText('Anna Huber')
      const dialog = await openClosing(user)
      await user.click(within(dialog).getByRole('button', { name: 'Anna Huber: Bar' }))
      expect(api.patch).toHaveBeenCalledWith(7, { paid: true, payment_method: 'cash' })
      await waitFor(() => expect(within(paidTable()).getByText('Anna Huber')).toBeInTheDocument())
    })

    it('Karte on a voucher top-up names the top-up\'s till', async () => {
      const user = userEvent.setup()
      const row = makeRow({ id: 8, first_name: 'Lisa', last_name: 'Wagner', price: 30, payment_method: 'voucher' })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: PAID, voucher_payment_method: 'card' })
      renderList({ date: '2026-07-09' })
      await within(openTable()).findByText('Lisa Wagner')
      const dialog = await openClosing(user)
      await user.click(within(dialog).getByRole('button', { name: 'Lisa Wagner: Karte' }))
      expect(api.patch).toHaveBeenCalledWith(8, { paid: true, voucher_payment_method: 'card' })
    })

    it('a collected row without a till only gets its till', async () => {
      const user = userEvent.setup()
      const row = makeRow({ id: 9, first_name: 'Tom', last_name: 'Lang', price: 259, paid_at: PAID })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({ ...row, payment_method: 'card' })
      renderList({ date: '2026-07-09' })
      await within(paidTable()).findByText('Tom Lang')
      const dialog = await openClosing(user)
      await user.click(within(dialog).getByRole('button', { name: 'Tom Lang: Karte' }))
      expect(api.patch).toHaveBeenCalledWith(9, { payment_method: 'card' })
    })

    it('Kassieren on a fully covered voucher collects without a till', async () => {
      const user = userEvent.setup()
      const row = makeRow({ id: 5, first_name: 'Eva', last_name: 'Bauer', price: 0, payment_method: 'voucher' })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: PAID })
      renderList({ date: '2026-07-09' })
      await within(openTable()).findByText('Eva Bauer')
      const dialog = await openClosing(user)
      await user.click(within(dialog).getByRole('button', { name: 'Eva Bauer: Kassieren' }))
      expect(api.patch).toHaveBeenCalledWith(5, { paid: true })
    })

    // The manifest's own PATCH echoes back as a `changed` event and refreshes
    // the list under the dialog; the operator must not lose their place.
    it('keeps its step and the typed count through a live refresh', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Keine Registrierungen für dieses Datum.')
      const dialog = await openClosing(user)
      await user.click(within(dialog).getByRole('button', { name: 'Weiter' }))
      await within(dialog).findByRole('heading', { name: 'Kassensturz' })
      await user.type(within(dialog).getByLabelText('Gezählt Bar'), '120')
      const before = vi.mocked(api.list).mock.calls.length
      fireChangedEvent()
      await waitFor(() => expect(vi.mocked(api.list).mock.calls.length).toBeGreaterThan(before))
      expect(within(closing()).getByRole('heading', { name: 'Kassensturz' })).toBeInTheDocument()
      expect(within(closing()).getByLabelText('Gezählt Bar')).toHaveValue('120')
    })

    it('shares the Betriebsleiter with the toolbar field', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      vi.mocked(api.dayManager).mockResolvedValue({ name: 'Max Muster' })
      renderList({ date: '2026-07-09' })
      await waitFor(() => expect(screen.getAllByLabelText('Betriebsleiter')[0]).toHaveValue('Max Muster'))
      const dialog = await openClosing(user)
      await user.click(within(dialog).getByRole('button', { name: 'Weiter' }))
      await user.click(await within(dialog).findByRole('button', { name: 'Weiter' }))
      const dialogField = await within(dialog).findByLabelText('Betriebsleiter')
      expect(dialogField).toHaveValue('Max Muster')
      await user.clear(dialogField)
      await user.type(dialogField, 'Maria Berger')
      const toolbarField = screen.getAllByLabelText('Betriebsleiter').find((el) => !dialog.contains(el))!
      expect(toolbarField).toHaveValue('Maria Berger')
    })

    it('Weiter on the Betriebsleiter step writes the name', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Keine Registrierungen für dieses Datum.')
      const dialog = await openClosing(user)
      await user.click(within(dialog).getByRole('button', { name: 'Weiter' }))
      await user.click(await within(dialog).findByRole('button', { name: 'Weiter' }))
      await user.type(await within(dialog).findByLabelText('Betriebsleiter'), 'Max Muster')
      await user.click(within(dialog).getByRole('button', { name: 'Weiter' }))
      await within(dialog).findByRole('heading', { name: 'Zusammenfassung' })
      expect(api.saveDayManager).toHaveBeenCalledWith('2026-07-09', 'Max Muster')
    })

    it('closes on Abbrechen and leaves the list as it was', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Keine Registrierungen für dieses Datum.')
      const dialog = await openClosing(user)
      await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tagesabschluss' })).not.toBeInTheDocument())
    })
  })

  // The selection bar's button collects the checked rows from both tables in one
  // payment method through CollectDialog, using the same PATCH the row
  // button already goes through.
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

  // The row's own Kassieren is the bulk action for exactly one tandem: same
  // dialog, same write rule, and it says nothing about whatever else is checked.
  describe('Zeilen-Kassieren', () => {
    const checkbox = (name: string) => screen.getByLabelText(`${name} auswählen`)
    const dialog = () => screen.getByRole('dialog')
    const rowCollectButton = (name: string) =>
      within(screen.getByText(name).closest('tr')!).getByRole('button', { name: /kassieren$/i })

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

    // The Zahlungsart is already on the row, so the dialog would only ask again
    // for what the row says. The row keeps it: the PATCH carries paid alone.
    it('collects a row that already names its Zahlungsart without asking', async () => {
      const user = userEvent.setup()
      const row = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 270, payment_method: 'card',
      })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: '2026-07-09T12:00:00.000Z' })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(rowCollectButton('Anna Muster'))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith(1, { paid: true }))
    })

    it('collects a voucher top-up that already names its Zahlungsart without asking', async () => {
      const user = userEvent.setup()
      const row = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 40,
        payment_method: 'voucher', voucher_payment_method: 'cash',
      })
      vi.mocked(api.list).mockResolvedValue([row])
      vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: '2026-07-09T12:00:00.000Z' })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(rowCollectButton('Anna Muster'))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith(1, { paid: true }))
    })

    it('still asks for a voucher top-up whose Zahlungsart is missing', async () => {
      const user = userEvent.setup()
      const row = makeRow({
        id: 1, first_name: 'Anna', last_name: 'Muster', price: 40, payment_method: 'voucher',
      })
      vi.mocked(api.list).mockResolvedValue([row])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(rowCollectButton('Anna Muster'))

      expect(within(dialog()).getByLabelText('Zahlungsart')).toBeInTheDocument()
      expect(api.patch).not.toHaveBeenCalled()
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
