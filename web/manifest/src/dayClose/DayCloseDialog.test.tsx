import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DayCloseDialog from './DayCloseDialog'
import * as api from '../api'
import { makeRow } from './testRows'
import { fireRawEvent } from '../setupTests'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  dayClose: vi.fn(),
  saveDayClose: vi.fn(),
  exportDay: vi.fn(),
}))

const DATE = '2026-11-08'
const PAID = '2026-11-08T12:00:00.000Z'
const EMPTY = { countedCash: null, countedCard: null, note: '', exportedAt: null }

// 1 295 € cash and 548 € card already in the tills.
const collected = [
  makeRow({ id: 10, first_name: 'Bar', last_name: 'Gast', price: 1295, paid_at: PAID, payment_method: 'cash' }),
  makeRow({ id: 11, first_name: 'Karten', last_name: 'Gast', price: 548, paid_at: PAID, payment_method: 'card' }),
]
const anna = makeRow({ id: 1, first_name: 'Anna', last_name: 'Huber', price: 259, load_number: 7, tandem_master_id: 1 })
const eva = makeRow({ id: 3, first_name: 'Eva', last_name: 'Bauer', price: 0, payment_method: 'voucher' })
const tom = makeRow({ id: 4, first_name: 'Tom', last_name: 'Lang', price: 259, paid_at: PAID })

type Props = React.ComponentProps<typeof DayCloseDialog>

function renderDialog(overrides: Partial<Props> = {}) {
  const props: Props = {
    date: DATE,
    rows: [...collected],
    masterNames: new Map([[1, 'Gruber']]),
    manager: 'Max Muster',
    onManagerChange: vi.fn(),
    saveManager: vi.fn(async () => true),
    settleRow: vi.fn(async () => {}),
    onClose: vi.fn(),
    ...overrides,
  }
  const utils = render(<DayCloseDialog {...props} />)
  return { ...utils, props, rerenderWith: (next: Partial<Props>) => utils.rerender(<DayCloseDialog {...props} {...next} />) }
}

const dialog = () => screen.getByRole('dialog', { name: 'Tagesabschluss' })
const rail = () => screen.getByRole('list', { name: 'Schritte' })
const railStep = (name: RegExp) => within(rail()).getByRole('button', { name })
const next = () => screen.getByRole('button', { name: 'Weiter' })
const heading = () => within(dialog()).getByRole('heading', { level: 3 })

async function goToCash(user = userEvent.setup()) {
  await user.click(next())
  await screen.findByRole('heading', { name: 'Kassensturz' })
  return user
}

beforeEach(() => {
  vi.mocked(api.exportDay).mockReset()
  vi.mocked(api.dayClose).mockResolvedValue({ ...EMPTY })
  vi.mocked(api.saveDayClose).mockImplementation(async (_d, draft) => ({ ...draft, exportedAt: null }))
})

describe('DayCloseDialog shell', () => {
  it('opens on Tandems with four steps and no Zurück', async () => {
    renderDialog()
    expect(dialog()).toBeInTheDocument()
    expect(within(rail()).getAllByRole('listitem')).toHaveLength(4)
    expect(heading()).toHaveTextContent('Offene Tandems')
    expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
    expect(screen.getByText('Sonntag, 8. November 2026')).toBeInTheDocument()
  })

  it('says when the day was closed before', async () => {
    vi.mocked(api.dayClose).mockResolvedValue({ ...EMPTY, exportedAt: new Date(2026, 10, 8, 18, 42).toISOString() })
    renderDialog()
    expect(await screen.findByText(
      'Bereits abgeschlossen am 8.11., 18:42 · erneut abschließen überschreibt das Blatt. Die Werte von damals sind eingesetzt.',
    )).toBeInTheDocument()
  })

  it('only lets the rail go back, never ahead', async () => {
    renderDialog()
    const user = await goToCash()
    expect(railStep(/Betriebsleiter/)).toBeDisabled()
    expect(railStep(/Tandems/)).toBeEnabled()
    await user.click(railStep(/Tandems/))
    expect(heading()).toHaveTextContent('Offene Tandems')
    expect(railStep(/Kasse/)).toBeDisabled()
  })

  it('Abbrechen keeps a typed count as a draft, then closes', async () => {
    const { props } = renderDialog()
    const user = await goToCash()
    await user.type(screen.getByLabelText('Gezählt Bar'), '1295')
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    expect(api.saveDayClose).toHaveBeenLastCalledWith(DATE, { countedCash: 1295, countedCard: null, note: '' })
  })

  it('Escape closes too', async () => {
    const { props } = renderDialog()
    fireEvent(dialog(), new Event('cancel', { cancelable: true }))
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })
})

describe('step Tandems', () => {
  it('lists open, method-less and fully covered tandems in their groups', () => {
    renderDialog({ rows: [...collected, anna, eva, tom] })
    const open = screen.getByRole('list', { name: 'Noch nicht kassiert' })
    expect(within(open).getByText('Anna Huber')).toBeInTheDocument()
    expect(within(open).getByText('Load 7 · TM Gruber')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Kassiert, ohne Zahlungsart' })).getByText('Tom Lang'))
      .toBeInTheDocument()
    const free = screen.getByRole('list', { name: 'Gutschein, nichts zu zahlen' })
    expect(within(free).getByRole('button', { name: 'Eva Bauer: Kassieren' })).toBeInTheDocument()
  })

  it('Bar collects the row into the cash till, Kassieren a covered voucher with no till', async () => {
    const user = userEvent.setup()
    const { props } = renderDialog({ rows: [...collected, anna, eva] })
    await user.click(screen.getByRole('button', { name: 'Anna Huber: Bar' }))
    expect(props.settleRow).toHaveBeenCalledWith(anna, 'cash')
    await user.click(screen.getByRole('button', { name: 'Eva Bauer: Kassieren' }))
    expect(props.settleRow).toHaveBeenCalledWith(eva, null)
  })

  it('keeps a failed row with its message', async () => {
    const user = userEvent.setup()
    renderDialog({ rows: [...collected, anna], settleRow: vi.fn(async () => { throw new Error('Speichern fehlgeschlagen') }) })
    await user.click(screen.getByRole('button', { name: 'Anna Huber: Karte' }))
    const open = screen.getByRole('list', { name: 'Noch nicht kassiert' })
    expect(await within(open).findByText('Speichern fehlgeschlagen')).toBeInTheDocument()
    expect(within(open).getByText('Anna Huber')).toBeInTheDocument()
  })

  it('says Alles erledigt when nothing is left', () => {
    renderDialog()
    expect(screen.getByText('Alles erledigt')).toBeInTheDocument()
  })

  it('lets the operator go on with a tandem left open, and marks the step', async () => {
    renderDialog({ rows: [...collected, anna] })
    await goToCash()
    expect(railStep(/Tandems/)).toHaveTextContent('1 bleibt offen')
    expect(rail().querySelector('li.warn')).not.toBeNull()
  })
})

describe('step Kasse', () => {
  it('shows what the tills should hold and how far the count is off', async () => {
    renderDialog()
    const user = await goToCash()
    expect(screen.getByTestId('expected-cash')).toHaveTextContent('1.295,00 €')
    expect(screen.getByTestId('expected-card')).toHaveTextContent('548,00 €')
    await user.type(screen.getByLabelText('Gezählt Bar'), '1.300,00')
    expect(screen.getByTestId('diff-cash')).toHaveTextContent('+5,00 €')
    expect(screen.getByTestId('diff-cash')).toHaveTextContent('zu viel')
    await user.type(screen.getByLabelText('Gezählt Karte'), '548')
    expect(screen.getByTestId('diff-card')).toHaveTextContent('stimmt')
  })

  it('asks for a reason as soon as a till differs, and waits for it', async () => {
    renderDialog()
    const user = await goToCash()
    expect(screen.queryByLabelText(/Begründung/)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Gezählt Bar'), '1300')
    expect(screen.getByText('· nötig, weil Bar abweicht')).toBeInTheDocument()
    expect(next()).toBeDisabled()
    await user.type(screen.getByLabelText(/Begründung/), 'Trinkgeld')
    expect(next()).toBeEnabled()
  })

  it('refuses something that is not an amount', async () => {
    renderDialog()
    const user = await goToCash()
    await user.type(screen.getByLabelText('Gezählt Bar'), 'abc')
    expect(screen.getByText('Betrag ungültig')).toBeInTheDocument()
    expect(next()).toBeDisabled()
  })

  it('may stay uncounted', async () => {
    renderDialog()
    await goToCash()
    expect(next()).toBeEnabled()
  })

  it('fills in the draft from before and saves it on blur and on leaving', async () => {
    vi.mocked(api.dayClose).mockResolvedValue({ countedCash: 1300, countedCard: null, note: 'Trinkgeld', exportedAt: null })
    renderDialog()
    const user = await goToCash()
    await waitFor(() => expect(screen.getByLabelText('Gezählt Bar')).toHaveValue('1.300,00'))
    expect(screen.getByLabelText(/Begründung/)).toHaveValue('Trinkgeld')
    await user.type(screen.getByLabelText('Gezählt Karte'), '548')
    await user.tab()
    await waitFor(() => expect(api.saveDayClose).toHaveBeenCalledWith(
      DATE, { countedCash: 1300, countedCard: 548, note: 'Trinkgeld' }))
    vi.mocked(api.saveDayClose).mockClear()
    await user.click(next())
    await waitFor(() => expect(api.saveDayClose).toHaveBeenCalledTimes(1))
  })

  it('stays usable when the draft cannot be loaded', async () => {
    vi.mocked(api.dayClose).mockRejectedValue(new Error('Kassensturz konnte nicht geladen werden'))
    renderDialog()
    await goToCash()
    expect(await screen.findByText('Kassensturz konnte nicht geladen werden')).toBeInTheDocument()
    expect(screen.getByLabelText('Gezählt Bar')).toHaveValue('')
    expect(next()).toBeEnabled()
  })

  it('recounts the difference when a tandem is collected after counting', async () => {
    const { rerenderWith } = renderDialog({ rows: [...collected, anna] })
    const user = await goToCash()
    await user.type(screen.getByLabelText('Gezählt Bar'), '1295')
    expect(screen.getByTestId('diff-cash')).toHaveTextContent('stimmt')
    await user.click(railStep(/Tandems/))
    rerenderWith({ rows: [...collected, { ...anna, paid_at: PAID, payment_method: 'cash' }] })
    await goToCash(user)
    expect(screen.getByTestId('diff-cash')).toHaveTextContent('−259,00 €')
    expect(screen.getByTestId('diff-cash')).toHaveTextContent('zu wenig')
    expect(next()).toBeDisabled()
  })
})

describe('step Betriebsleiter', () => {
  async function goToManager(props: Partial<Props> = {}) {
    const utils = renderDialog(props)
    const user = await goToCash()
    await user.click(next())
    await screen.findByRole('heading', { name: 'Betriebsleiter' })
    return { ...utils, user }
  }

  it('cannot be left without a name', async () => {
    await goToManager({ manager: '  ' })
    expect(next()).toBeDisabled()
    expect(screen.getByText('Name fehlt')).toBeInTheDocument()
  })

  it('types into the day\'s one Betriebsleiter field', async () => {
    const { props, user } = await goToManager({ manager: '' })
    await user.type(screen.getByLabelText('Betriebsleiter'), 'M')
    expect(props.onManagerChange).toHaveBeenCalledWith('M')
  })

  it('saves the name on Weiter and stays when that fails', async () => {
    const saveManager = vi.fn(async () => false)
    const { user } = await goToManager({ saveManager })
    await user.click(next())
    expect(saveManager).toHaveBeenCalled()
    expect(await screen.findByText('Betriebsleiter konnte nicht gespeichert werden.')).toBeInTheDocument()
    expect(heading()).toHaveTextContent('Betriebsleiter')
  })
})

describe('step Abschluss', () => {
  async function goToSummary(props: Partial<Props> = {}) {
    const utils = renderDialog(props)
    const user = await goToCash()
    await user.type(screen.getByLabelText('Gezählt Bar'), '1300')
    await user.type(screen.getByLabelText(/Begründung/), 'Trinkgeld')
    await user.click(next())
    await screen.findByRole('heading', { name: 'Betriebsleiter' })
    await user.click(next())
    await screen.findByRole('heading', { name: 'Zusammenfassung' })
    return { ...utils, user }
  }

  it('sums up what the sheet will say', async () => {
    await goToSummary({ rows: [...collected, anna] })
    const summary = screen.getByRole('definition', { name: 'Betriebsleiter' })
    expect(summary).toHaveTextContent('Max Muster')
    expect(screen.getByRole('definition', { name: 'Tandems' })).toHaveTextContent('3')
    expect(screen.getByRole('definition', { name: 'Tandems' })).toHaveTextContent('2 kassiert · 1 offen')
    expect(screen.getByRole('definition', { name: 'Bar' })).toHaveTextContent('1.300,00 €')
    expect(screen.getByRole('definition', { name: 'Bar' })).toHaveTextContent('+5,00 €')
    expect(screen.getByRole('definition', { name: 'Karte' })).toHaveTextContent('nicht gezählt')
    expect(screen.getByRole('definition', { name: 'Begründung' })).toHaveTextContent('Trinkgeld')
    expect(screen.getByRole('button', { name: 'Tagesabschluss durchführen' })).toBeInTheDocument()
  })

  it('points back to what is still open', async () => {
    const { user } = await goToSummary({ rows: [...collected, anna] })
    expect(screen.getByText('1 Tandem ist noch nicht kassiert.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Zu Tandems' }))
    expect(heading()).toHaveTextContent('Offene Tandems')
  })
})


describe('running the Tagesabschluss', () => {
  const RESULT = {
    path: 'C:\\Export\\Tandem_2026-11-08.xlsx', count: 2,
    redemptionsWritten: 3, redemptionsPending: 1, redemptionsInvalid: 0,
  }

  async function goToSummary(props: Partial<Props> = {}) {
    const utils = renderDialog(props)
    const user = await goToCash()
    await user.click(next())
    await screen.findByRole('heading', { name: 'Betriebsleiter' })
    await user.click(next())
    await screen.findByRole('heading', { name: 'Zusammenfassung' })
    return { ...utils, user }
  }
  const run = () => screen.getByRole('button', { name: 'Tagesabschluss durchführen' })

  function pendingExport() {
    let resolve!: (r: typeof RESULT) => void
    let reject!: (e: Error) => void
    vi.mocked(api.exportDay).mockImplementation(() => new Promise((res, rej) => { resolve = res; reject = rej }))
    return { resolve: (r = RESULT) => resolve(r), reject: (e: Error) => reject(e) }
  }

  it('saves the count first, then exports with its own run id, locked while it runs', async () => {
    const pending = pendingExport()
    const { user, props } = await goToSummary()
    await user.click(run())
    await waitFor(() => expect(api.exportDay).toHaveBeenCalledTimes(1))
    const saveOrder = vi.mocked(api.saveDayClose).mock.invocationCallOrder.at(-1)!
    expect(saveOrder).toBeLessThan(vi.mocked(api.exportDay).mock.invocationCallOrder[0])
    const [date, runId] = vi.mocked(api.exportDay).mock.calls[0]
    expect(date).toBe(DATE)
    expect(runId).toMatch(/^[A-Za-z0-9-]{1,64}$/)

    expect(await screen.findByRole('heading', { name: 'Tagesabschluss läuft' })).toBeInTheDocument()
    expect(screen.getByText('Kassensturz gespeichert')).toBeInTheDocument()
    expect(screen.getByText('Gutscheinliste')).toBeInTheDocument()
    expect(screen.getByText('Excel-Blatt')).toBeInTheDocument()
    expect(screen.getByText('Bitte warten, nicht schließen. Das dauert ein paar Sekunden.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeDisabled()
    expect(railStep(/Tandems/)).toBeDisabled()
    fireEvent(dialog(), new Event('cancel', { cancelable: true }))
    expect(props.onClose).not.toHaveBeenCalled()
    pending.resolve()
    await screen.findByRole('heading', { name: 'Tag abgeschlossen' })
  })

  it('shows its own run\'s progress and ignores another PC\'s', async () => {
    pendingExport()
    const { user } = await goToSummary()
    await user.click(run())
    await screen.findByRole('heading', { name: 'Tagesabschluss läuft' })
    const runId = vi.mocked(api.exportDay).mock.calls[0][1]!
    fireRawEvent('export-progress', JSON.stringify({ run: 'other', date: DATE, phase: 'vouchers', done: 1, total: 9 }))
    expect(screen.queryByText('1 von 9')).not.toBeInTheDocument()
    fireRawEvent('export-progress', JSON.stringify({ run: runId, date: DATE, phase: 'vouchers', done: 2, total: 3 }))
    expect(await screen.findByText('2 von 3')).toBeInTheDocument()
  })

  it('starts one export however fast it is pressed twice', async () => {
    pendingExport()
    const { user } = await goToSummary()
    const button = run()
    await user.dblClick(button)
    await waitFor(() => expect(api.exportDay).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(api.exportDay).toHaveBeenCalledTimes(1)
  })

  it('shows Fertig only once the export answered, with what it wrote', async () => {
    const pending = pendingExport()
    const { user, props } = await goToSummary({ rows: [...collected, anna] })
    await user.click(run())
    await screen.findByRole('heading', { name: 'Tagesabschluss läuft' })
    expect(screen.queryByRole('heading', { name: 'Tag abgeschlossen' })).not.toBeInTheDocument()
    pending.resolve()
    expect(await screen.findByRole('heading', { name: 'Tag abgeschlossen' })).toBeInTheDocument()
    expect(screen.getByText('C:\\Export\\Tandem_2026-11-08.xlsx')).toBeInTheDocument()
    expect(screen.getByRole('definition', { name: 'Gutscheinliste' })).toHaveTextContent('3 eingetragen')
    expect(screen.getByRole('definition', { name: 'Gutscheinliste' })).toHaveTextContent('1 noch offen')
    expect(screen.getByRole('definition', { name: 'Offen geblieben' }))
      .toHaveTextContent('1 Tandem wird beim nächsten Export nachgetragen, sobald kassiert')
    // One way out of a finished dialog, not two buttons of the same name.
    expect(screen.getAllByRole('button', { name: 'Schließen' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument()
    const closeButtons = within(screen.getByRole('contentinfo')).getAllByRole('button')
    expect(closeButtons.map((b) => b.textContent)).toEqual(['Schließen'])
    await user.click(closeButtons[0])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('does not export when the count cannot be saved', async () => {
    const { user } = await goToSummary()
    vi.mocked(api.saveDayClose).mockRejectedValue(new Error('Kassensturz speichern fehlgeschlagen'))
    await user.click(run())
    expect(await screen.findByText(/Kassensturz speichern fehlgeschlagen/)).toBeInTheDocument()
    expect(api.exportDay).not.toHaveBeenCalled()
  })

  it('goes back to the summary on failure and can try again', async () => {
    const pending = pendingExport()
    const { user } = await goToSummary()
    await user.click(run())
    await screen.findByRole('heading', { name: 'Tagesabschluss läuft' })
    pending.reject(new Error('Export-Ordner nicht erreichbar.'))
    expect(await screen.findByText('Tagesabschluss fehlgeschlagen')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Export-Ordner nicht erreichbar.')
    expect(screen.getByRole('alert')).toHaveTextContent('Der Tag ist noch nicht abgeschlossen.')
    expect(railStep(/Abschluss/)).toHaveTextContent('Fehlgeschlagen')
    vi.mocked(api.exportDay).mockResolvedValue(RESULT)
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(await screen.findByRole('heading', { name: 'Tag abgeschlossen' })).toBeInTheDocument()
  })

  it('names the other PC when the day is already being closed', async () => {
    vi.mocked(api.exportDay).mockRejectedValue(new Error('Tagesabschluss läuft bereits'))
    const { user } = await goToSummary()
    await user.click(run())
    expect(await screen.findByText(/Tagesabschluss läuft bereits \(anderer Rechner\)/)).toBeInTheDocument()
  })
})
