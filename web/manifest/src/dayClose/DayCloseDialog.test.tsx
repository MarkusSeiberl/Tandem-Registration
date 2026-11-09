import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DayCloseDialog from './DayCloseDialog'
import * as api from '../api'
import { makeRow } from './testRows'

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

