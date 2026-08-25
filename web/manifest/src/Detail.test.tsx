import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Detail from './Detail'
import * as api from './api'
import type { Registration } from './api'

vi.mock('./api', () => ({
  patch: vi.fn(),
  remove: vi.fn(),
  masters: vi.fn(),
  flyers: vi.fn(),
  getSettings: vi.fn(),
  contractPdfUrl: vi.fn(() => '/api/registrations/1/contract.pdf'),
  getApiBase: vi.fn(() => ''),
  checkVoucher: vi.fn(),
  dayTables: vi.fn(),
}))

const PRICES = {
  jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60,
}

const PAYOUTS = { tandem_master: 45, video: 60, video_photo: 80 }

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1,
    first_name: 'Anna',
    last_name: 'Muster',
    gender: 'female',
    age: 30,
    height_cm: 170,
    // Below the first threshold, so the default row's 'none' is what the weight
    // calls for — the deviation hint is exercised by its own tests below.
    weight_kg: 80,
    street: 'Hauptstraße 1',
    postal_code: '5020',
    city: 'Salzburg',
    email: 'anna@example.com',
    phone: '0664 1234567',
    contract_pdf_filename: null,
    accepted_terms: 1,
    tandem_master_id: null,
    load_number: null,
    price: 270,
    payment_method: null,
    voucher_payment_method: null,
    voucher_number: null,
    voucher_service: null,
    extra_booking: 'none',
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

// The breakdown repeats the same amount as the total whenever there is only one
// line, so the total is read from its own row rather than by text alone.
function total(): string {
  return document.querySelector('.price-total .numeral')?.textContent ?? ''
}

function renderDetail(registration = makeRegistration()) {
  const onSaved = vi.fn()
  const onBack = vi.fn()
  render(<Detail registration={registration} onBack={onBack} onSaved={onSaved} />)
  return { onSaved, onBack }
}

// The voucher fields live in one labelled group, so a test can assert on the
// block as a whole rather than on three fields that happen to be near each other.
const voucherGroup = () => screen.getByRole('group', { name: 'Gutschein' })
const status = () => document.querySelector('.voucher-status')

describe('Detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.masters).mockResolvedValue([])
    vi.mocked(api.flyers).mockResolvedValue([{ id: 7, name: 'Peter' }])
    // The screen prices from the day the jump belongs to, not from the settings.
    vi.mocked(api.dayTables).mockResolvedValue({
      prices: PRICES, payouts: PAYOUTS, frozen: true,
      current: { prices: PRICES, payouts: PAYOUTS },
    })
    vi.mocked(api.patch).mockImplementation(async (_id, fields) =>
      makeRegistration(fields as Partial<Registration>))
  })

  it('shows the jump price for a guest with nothing selected', async () => {
    renderDetail()
    expect(await screen.findByText('Zu kassieren')).toBeInTheDocument()
    expect(total()).toBe('270 €')
  })

  it('reads the guest as one strip of facts above the manifest', async () => {
    renderDetail()
    await screen.findByText('Zu kassieren')

    // Nothing here is editable and nothing here changes on this screen, so it
    // reads as one line across the top rather than as a column competing for
    // width with the fields that do change.
    const guest = screen.getByRole('region', { name: 'Gastdaten' })
    expect(within(guest).getByText('Anna Muster')).toBeInTheDocument()
    expect(within(guest).getByText('weiblich')).toBeInTheDocument()
    expect(within(guest).getByText('30')).toBeInTheDocument()
    expect(within(guest).getByText('170 cm')).toBeInTheDocument()
    expect(within(guest).getByText('80 kg')).toBeInTheDocument()
    expect(within(guest).getByText('2026-07-09')).toBeInTheDocument()
    expect(within(guest).getByText('Hauptstraße 1, 5020 Salzburg')).toBeInTheDocument()
    expect(within(guest).getByText('anna@example.com')).toBeInTheDocument()
    expect(within(guest).getByText('0664 1234567')).toBeInTheDocument()

    // The strip states facts; it never asks for one.
    expect(within(guest).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(guest).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('adds the extra and the weight surcharge to the total', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video')
    await user.selectOptions(screen.getByLabelText(/Gewichtszuschlag/), 'over_90')

    expect(total()).toBe('410 €')
  })

  it('charges a voucher guest the difference to what the voucher covers', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video')

    expect(total()).toBe('100 €')
  })

  it('charges only the upgrade when a jump+video voucher becomes video+photo', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video_photo')

    expect(total()).toBe('20 €')
  })

  it('costs nothing when the voucher is used exactly as issued', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    // Picking the voucher raises the booking to what it covers, so the guest
    // is not charged for a jump the voucher already paid for.
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')

    expect((screen.getByLabelText(/Gebuchte Leistung/) as HTMLSelectElement).value).toBe('video')
    expect(total()).toBe('0 €')
  })

  it('charges a voucher guest the weight surcharge, which no voucher covers', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')
    await user.selectOptions(screen.getByLabelText(/Gewichtszuschlag/), 'over_100')

    expect(total()).toBe('60 €')
  })

  it('shows the voucher as a deduction line in the breakdown', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video_photo')

    // Scoped to the breakdown: 'Gutschein' is also a Zahlungsart option label.
    const breakdown = document.querySelector('.price-breakdown')!
    expect(breakdown.textContent).toContain('Gutschein')
    expect(breakdown.textContent).toContain('-370 €')
  })

  it('asks how a voucher top-up was paid, and sends it', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    expect(screen.queryByLabelText(/Zuzahlung bezahlt mit/)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video')

    // 100 € owed on top of the voucher, so the till matters now.
    await user.selectOptions(screen.getByLabelText(/Zuzahlung bezahlt mit/), 'cash')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      payment_method: 'voucher',
      voucher_payment_method: 'cash',
    })
  })

  it('locks the till, saying why, when the voucher covers everything', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')

    // Nothing to collect — no money changes hands, so there is no till to record.
    // The field stays in place and says so instead of vanishing.
    expect(total()).toBe('0 €')
    expect(screen.getByLabelText(/Zuzahlung bezahlt mit/)).toBeDisabled()
    expect(status()).toHaveTextContent('Gutschein deckt alles ab — nichts zu kassieren.')
  })

  it('keeps the whole voucher block together, with the till after what sets it', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    expect(screen.queryByRole('group', { name: 'Gutschein' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')

    const group = voucherGroup()
    expect(within(group).getByLabelText('Gutschein-Nr.')).toBeInTheDocument()
    // The till has to come after the fields that decide its amount — above them
    // it appeared where nobody was looking.
    const selects = within(group).getAllByRole('combobox').map((s) => s.getAttribute('name'))
    expect(selects).toEqual(['voucher_service', 'voucher_payment_method'])

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'cash')
    expect(screen.queryByRole('group', { name: 'Gutschein' })).not.toBeInTheDocument()
  })

  it('names the open amount as the reason the till is asked for', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video_photo')

    expect(status()).toHaveTextContent('Noch 20 € offen — bitte Kassa wählen.')
    expect(screen.getByLabelText(/Zuzahlung bezahlt mit/)).toBeEnabled()
  })

  it('warns while an open top-up has no till, without blocking the save', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video')

    // Money is owed and nobody said where it went — that till will not add up.
    expect(status()).toHaveClass('warn')

    // A half-finished row still has to be storable.
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(api.patch).toHaveBeenCalled()

    await user.selectOptions(screen.getByLabelText(/Zuzahlung bezahlt mit/), 'cash')
    expect(status()).not.toHaveClass('warn')
  })

  it('clears a stale till when the top-up disappears', async () => {
    const user = userEvent.setup()
    renderDetail(makeRegistration({
      payment_method: 'voucher', voucher_service: 'jump', extra_booking: 'video',
      voucher_payment_method: 'cash',
    }))
    await screen.findByText('Zu kassieren')

    // Correcting the voucher to cover the video leaves nothing to collect.
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      voucher_payment_method: null,
    })
  })

  it('offers the voucher service only when paying by voucher', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    expect(screen.queryByLabelText(/Gutschein-Leistung/)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    expect(screen.getByLabelText(/Gutschein-Leistung/)).toBeInTheDocument()
  })

  it('asks for a Kameraflieger when only the voucher covers the video', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    // Nothing booked on top — the video still gets filmed, so a flyer is needed.
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')

    expect(await screen.findByLabelText(/Kameraflieger/)).toBeEnabled()
  })

  it('locks the Kameraflieger, saying why, when no video is involved at all', async () => {
    renderDetail()
    await screen.findByText('Zu kassieren')

    // Kept in place so the form does not reflow when a video is added later.
    expect(screen.getByLabelText(/Kameraflieger/)).toBeDisabled()
    expect(screen.getByText('Kein Video gebucht.')).toBeInTheDocument()
  })

  it('shows the plain weight hint while the surcharge matches the weight', async () => {
    renderDetail(makeRegistration({ weight_kg: 104, weight_surcharge: 'over_100' }))
    await screen.findByText('Zu kassieren')

    expect(screen.getByText('Eingetragenes Gewicht: 104 kg')).toBeInTheDocument()
  })

  it('points out a surcharge that no longer matches the weight, without changing it', async () => {
    // Waived by the manifest: the screen says so, and leaves the choice alone.
    renderDetail(makeRegistration({ weight_kg: 104, weight_surcharge: 'none' }))
    await screen.findByText('Zu kassieren')

    expect(screen.getByText('104 kg — Zuschlag ab 100 kg wäre fällig.')).toBeInTheDocument()
    expect((screen.getByLabelText(/Gewichtszuschlag/) as HTMLSelectElement).value).toBe('none')
  })

  it('points out a surcharge charged to a guest light enough to be free of it', async () => {
    renderDetail(makeRegistration({ weight_kg: 72, weight_surcharge: 'over_90' }))
    await screen.findByText('Zu kassieren')

    expect(screen.getByText('72 kg — kein Zuschlag fällig.')).toBeInTheDocument()
  })

  it('loads an existing note and saves an edited one', async () => {
    const user = userEvent.setup()
    const registration = makeRegistration({ notes: 'Zahlt Rest nächste Woche' })
    vi.mocked(api.patch).mockResolvedValue({ ...registration, notes: 'Rest am Sonntag' })
    renderDetail(registration)
    await screen.findByText('Zu kassieren')

    const field = screen.getByLabelText(/Anmerkungen/) as HTMLTextAreaElement
    expect(field.value).toBe('Zahlt Rest nächste Woche')

    await user.clear(field)
    await user.type(field, '  Rest am Sonntag  ')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ notes: 'Rest am Sonntag' })
  })

  it('sends an emptied note as null so the export cell goes blank', async () => {
    const user = userEvent.setup()
    const registration = makeRegistration({ notes: 'Alte Notiz' })
    vi.mocked(api.patch).mockResolvedValue({ ...registration, notes: null })
    renderDetail(registration)
    await screen.findByText('Zu kassieren')

    await user.clear(screen.getByLabelText(/Anmerkungen/))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ notes: null })
  })

  it('lets the manifest type an exception price', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.click(screen.getByLabelText('abweichender Preis'))
    const input = screen.getByLabelText('Preis (EUR)') as HTMLInputElement
    // Prefilled from the computed amount so a small correction is a small edit.
    expect(input.value).toBe('270')

    await user.clear(input)
    await user.type(input, '250')
    expect(total()).toBe('250 €')
  })

  it('sends the typed price, and otherwise leaves the price to the server', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText(/Gewichtszuschlag/), 'over_90')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      weight_surcharge: 'over_90',
      price_override: 0,
    })
    expect(vi.mocked(api.patch).mock.calls[0][1]).not.toHaveProperty('price')

    await user.click(screen.getByLabelText('abweichender Preis'))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[1][1]).toMatchObject({ price: 310 })
  })

  it('deletes the registration after asking, and returns to the list', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.remove).mockResolvedValue(undefined)
    const { onBack } = renderDetail()
    await screen.findByText('Zu kassieren')

    await user.click(screen.getByRole('button', { name: 'Registrierung löschen' }))

    expect(confirm).toHaveBeenCalledWith('Registrierung von Anna Muster löschen?')
    expect(api.remove).toHaveBeenCalledWith(1)
    expect(onBack).toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('deletes nothing when the question is answered with no', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { onBack } = renderDetail()
    await screen.findByText('Zu kassieren')

    await user.click(screen.getByRole('button', { name: 'Registrierung löschen' }))

    expect(api.remove).not.toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('stays on the screen and reports a failed delete', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.remove).mockRejectedValue(new Error('Löschen fehlgeschlagen'))
    const { onBack } = renderDetail()
    await screen.findByText('Zu kassieren')

    await user.click(screen.getByRole('button', { name: 'Registrierung löschen' }))

    // Queried through the bar, not the document: the button that failed is
    // pinned to the viewport, so a message anywhere else can be off-screen.
    const bar = within(document.querySelector('.save-bar') as HTMLElement)
    expect(await bar.findByText('Löschen fehlgeschlagen')).toBeInTheDocument()
    expect(onBack).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('clears the voucher service when the guest no longer pays by voucher', async () => {
    const user = userEvent.setup()
    renderDetail(makeRegistration({ payment_method: 'voucher', voucher_service: 'jump' }))
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'cash')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      payment_method: 'cash',
      voucher_service: null,
      voucher_number: null,
    })
  })

  const OK_CHECK = {
    configured: true, readable: true, status: 'ok' as const, number: '26-001',
    paidAt: '2026-01-14', paidText: null, amount: 355, art: 'Tandem + Video',
    service: 'jump_video' as const, isAddOn: false, redeemedAt: null, error: null,
  }

  async function typeVoucherNumber(user: ReturnType<typeof userEvent.setup>, number: string) {
    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.type(screen.getByLabelText('Gutschein-Nr.'), number)
  }

  it('says a voucher is paid and still unused', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue(OK_CHECK)
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-001')

    expect(await screen.findByText(/Bezahlt am 14\.01\.2026/)).toBeInTheDocument()
  })

  it('warns about an unpaid voucher without locking anything', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue({ ...OK_CHECK, status: 'unpaid', paidAt: null })
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-007')

    expect(await screen.findByText(/Nicht bezahlt/)).toBeInTheDocument()
    // The operator is standing in front of the guest; the software does not decide.
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled()
  })

  it('quotes whatever text stands in EinzahlDat', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue({
      ...OK_CHECK, status: 'cancelled', paidAt: null, paidText: 'STORNO',
    })
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-009')

    expect(await screen.findByText(/STORNO/)).toBeInTheDocument()
  })

  it('says when a voucher was already redeemed', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue({
      ...OK_CHECK, status: 'redeemed', redeemedAt: '2026-07-12',
    })
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-002')

    expect(await screen.findByText(/Bereits eingelöst am 12\.07\.2026/)).toBeInTheDocument()
  })

  it('points out an Art that does not match the chosen Leistung', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue(OK_CHECK)
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-001')
    await screen.findByText(/Bezahlt am/)
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')

    expect(await screen.findByText(/Laut Liste: Tandem \+ Video/)).toBeInTheDocument()
  })

  it('shows the amount then and now, without calling the gap a problem', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue(OK_CHECK)
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-001')

    // 355 € paid then, 270 + 100 at today's table. Every older voucher is below
    // today's price; that is the club's arrangement, so it is stated, not flagged.
    const line = await screen.findByText(/355 € damals/)
    expect(line.textContent).toContain('370 € heute')
    expect(line.className).not.toContain('warn')
  })

  it('says nothing at all when no list is configured', async () => {
    const user = userEvent.setup()
    // Everything an answer could be built from is present and only `configured`
    // is false, so each of the three lines below is held back by that flag alone
    // — the one thing an empty voucherListPath is supposed to switch off.
    vi.mocked(api.checkVoucher).mockResolvedValue({ ...OK_CHECK, configured: false })
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-001')
    // A Leistung that disagrees with the list's Art, so the Art line has
    // something it *could* say — without this the assertion below would hold
    // even if the line stopped checking whether a list is configured at all.
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')
    await waitFor(() => expect(api.checkVoucher).toHaveBeenCalledWith('26-001'))
    // Let the resolved check reach the screen, so this tests silence and not
    // merely a check that has not come back yet.
    await act(async () => {})

    expect(screen.queryByText(/Gutscheinliste/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Bezahlt am/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Laut Liste/)).not.toBeInTheDocument()
    expect(screen.queryByText(/damals/)).not.toBeInTheDocument()
  })

  it('drops the previous number’s answer as soon as the number changes', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue(OK_CHECK)
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-001')
    expect(await screen.findByText(/Bezahlt am 14\.01\.2026/)).toBeInTheDocument()

    // One more keystroke and the line on screen is a statement about the club's
    // money for a number that is no longer in the field. Found by regex: the
    // status lines live inside the label, so its accessible name grows as soon
    // as an answer is on screen.
    await user.type(screen.getByLabelText(/Gutschein-Nr\./), '2')
    expect(screen.queryByText(/Bezahlt am 14\.01\.2026/)).not.toBeInTheDocument()
  })

  it('says a redemption reached the club list and stays there', async () => {
    // Put back to open, but the date is already in the club's file. The file
    // keeps it, so the screen has to say so.
    renderDetail(makeRegistration({
      payment_method: 'voucher', voucher_number: '26-001', voucher_service: 'jump',
      paid_at: null,
      voucher_redeemed_at: '2026-07-09T10:00:00.000Z',
      voucher_redeem_synced_at: '2026-07-09T10:00:00.000Z',
    }))
    await screen.findByText('Zu kassieren')

    const line = screen.getByText(/Einlösung am 09\.07\.2026 in die Gutscheinliste eingetragen/)
    expect(line.textContent).toContain('Das Datum bleibt dort stehen.')
    // A statement, not something to fix.
    expect(line.className).not.toContain('warn')
  })

  it('says a redemption is recorded but still owed to the club list', async () => {
    renderDetail(makeRegistration({
      payment_method: 'voucher', voucher_number: '26-001', voucher_service: 'jump',
      paid_at: '2026-07-09T10:00:00.000Z',
      voucher_redeemed_at: '2026-07-09T10:00:00.000Z',
      voucher_redeem_synced_at: null,
    }))
    await screen.findByText('Zu kassieren')

    const line = screen.getByText(/noch nicht in die Gutscheinliste geschrieben/)
    expect(line.textContent).toContain('Einlösung vermerkt')
    expect(line.className).not.toContain('warn')
  })

  it('says nothing about a redemption on a row that has none', async () => {
    renderDetail(makeRegistration({ payment_method: 'voucher', voucher_number: '26-001' }))
    await screen.findByText('Zu kassieren')

    expect(screen.queryByText(/Einlösung/)).not.toBeInTheDocument()
  })

  it('splits the manifest into who flies them, what they get and what they pay', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    // Who flies them, and on whose money.
    const zuteilung = screen.getByRole('region', { name: 'Zuteilung' })
    expect(within(zuteilung).getByLabelText('Tandemmaster')).toBeInTheDocument()
    expect(within(zuteilung).getByLabelText('Load-Nr.')).toBeInTheDocument()
    expect(within(zuteilung).getByLabelText('Zahlungsart')).toBeInTheDocument()

    // What they get.
    const leistung = screen.getByRole('region', { name: 'Leistung' })
    expect(within(leistung).getByLabelText(/Gebuchte Leistung/)).toBeInTheDocument()
    expect(within(leistung).getByLabelText(/Gewichtszuschlag/)).toBeInTheDocument()
    expect(within(leistung).getByLabelText(/Kameraflieger/)).toBeInTheDocument()
    expect(within(leistung).getByLabelText(/Anmerkungen/)).toBeInTheDocument()

    // What they pay.
    const kassa = screen.getByRole('region', { name: 'Kassa' })
    expect(within(kassa).getByText('Zu kassieren')).toBeInTheDocument()
    expect(within(kassa).getByLabelText('abweichender Preis')).toBeInTheDocument()

    // The voucher block still hangs off the Zahlungsart that summons it, in the
    // same panel — a block that opened in a different column would open where
    // nobody is looking.
    await user.selectOptions(within(zuteilung).getByLabelText('Zahlungsart'), 'voucher')
    expect(within(zuteilung).getByRole('group', { name: 'Gutschein' })).toBeInTheDocument()

    // A field left behind in two panels during the move would satisfy every
    // assertion above: each region would still find its own copy.
    expect(screen.getAllByLabelText('Tandemmaster')).toHaveLength(1)
    expect(screen.getAllByLabelText(/Gebuchte Leistung/)).toHaveLength(1)
    expect(screen.getAllByLabelText(/Anmerkungen/)).toHaveLength(1)
  })

  it('keeps every action that leaves this row in one bar', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    const bar = document.querySelector('.save-bar')
    expect(bar).not.toBeNull()

    const actions = within(bar as HTMLElement)
    expect(actions.getByRole('link', { name: 'Vertrag öffnen' })).toBeInTheDocument()
    expect(actions.getByRole('button', { name: 'Urkunde drucken' })).toBeInTheDocument()
    expect(actions.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
    // Set apart from the rest so it is never the button next to Speichern.
    expect(actions.getByRole('button', { name: /Registrierung löschen/ }))
      .toHaveClass('detail-delete')

    // The message the button produces has to land in the same pinned strip —
    // below it, on a screen that scrolls, an operator working at the top would
    // never see it.
    await user.click(actions.getByRole('button', { name: 'Speichern' }))
    expect(await actions.findByText('Gespeichert.')).toBeInTheDocument()
  })

  describe('a jump day older than the price list', () => {
    beforeEach(() => {
      vi.mocked(api.dayTables).mockResolvedValue({
        prices: { ...PRICES, jump: 250, video: 80 },
        payouts: PAYOUTS,
        frozen: true,
        current: { prices: PRICES, payouts: PAYOUTS },
      })
    })

    it('prices the row from the day, not from the settings', async () => {
      renderDetail()
      await screen.findByText('Zu kassieren')

      expect(total()).toBe('250 €')
    })

    it('prices an added video from that same day list', async () => {
      renderDetail()
      await screen.findByText('Zu kassieren')

      await userEvent.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video')

      // 250 + 80 from the day, not 270 + 100 from the settings.
      expect(total()).toBe('330 €')
    })

    it('says which list the day runs on, and where to change it', async () => {
      renderDetail()
      await screen.findByText('Zu kassieren')

      expect(screen.getByText(/Preisliste vom Tagesbeginn/)).toBeInTheDocument()
      // The action itself belongs to the day, so it lives in the manifest list.
      expect(
        screen.queryByRole('button', { name: /Preise für diesen Tag/ })
      ).not.toBeInTheDocument()
    })
  })
})
