import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Betraege from './Betraege'
import * as api from './api'
import type { Settings as SettingsType } from './api'

vi.mock('./api', () => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
}))

const CONFIG: SettingsType = {
  exportDir: 'C:/Tandem',
  contractText: '',
  privacyText: '',
  jumpLocation: 'Freistadt',
  backupDir: '',
  voucherListPath: '',
  prices: { jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60 },
  payouts: {
    tandem_master: 45, video: 60, video_photo: 80, weight_over_90: 15, weight_over_100: 25,
  },
}


const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Beträge speichern' })
const row = (name: string) => screen.getByRole('rowheader', { name }).parentElement!

describe('Beträge', () => {
  beforeEach(() => {
    // Call counts survive between tests otherwise, so a later "was never saved"
    // assertion would see the save from the test before it.
    vi.clearAllMocks()
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG })
    vi.mocked(api.putSettings).mockImplementation(async (fields) => ({ ...CONFIG, ...fields }))
  })

  it('shows the configured prices and payout rates', async () => {
    render(<Betraege />)

    expect(await screen.findByText('Preise (EUR)')).toBeInTheDocument()
    expect(screen.getByText('Vergütung (EUR)')).toBeInTheDocument()
    expect(field('Tandemsprung').value).toBe('270')
    expect(field('Tandemmaster pro Sprung').value).toBe('45')
    expect(field('Kameraflieger Video + Foto').value).toBe('80')
  })

  it('uses plain decimal text fields, so the mouse wheel and arrow keys cannot change an amount', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    const jump = field('Tandemsprung')
    expect(jump).toHaveAttribute('type', 'text')
    expect(jump).toHaveAttribute('inputmode', 'decimal')
    await user.click(jump)
    await user.keyboard('{ArrowUp}{ArrowDown}{ArrowUp}')
    expect(jump.value).toBe('270')
  })

  it('saves both blocks together', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Tandemmaster pro Sprung'))
    await user.type(field('Tandemmaster pro Sprung'), '50')
    await user.click(save())

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    const sent = vi.mocked(api.putSettings).mock.calls[0][0]
    expect(sent.payouts).toEqual({
      tandem_master: 50, video: 60, video_photo: 80, weight_over_90: 15, weight_over_100: 25,
    })
    expect(sent.prices?.jump).toBe(270)
    // The directories belong to the settings screen — sending them from here
    // would let a stale value overwrite what was saved there.
    expect(sent.exportDir).toBeUndefined()
    expect(sent.backupDir).toBeUndefined()
  })

  it('takes a comma as the decimal mark and shows cents with two digits', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Video + Foto'))
    await user.type(field('Video + Foto'), '120,5')
    expect(row('Tandem + Video + Foto')).toHaveTextContent('390,50 €')
    await user.click(save())

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    expect(vi.mocked(api.putSettings).mock.calls[0][0].prices?.video_photo).toBe(120.5)
    // Shown back the way it is written on the price list.
    expect(field('Video + Foto').value).toBe('120,50')
  })

  it('offers saving only once something changed, and says when changes are unsaved', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    expect(save()).toBeDisabled()
    expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument()

    await user.clear(field('Tandemsprung'))
    await user.type(field('Tandemsprung'), '290')

    expect(save()).toBeEnabled()
    expect(screen.getByText('Ungespeicherte Änderungen')).toBeInTheDocument()
    // Typing the old value back is no change.
    await user.clear(field('Tandemsprung'))
    await user.type(field('Tandemsprung'), '270')
    expect(save()).toBeDisabled()
  })

  it('shows the old value under a changed field', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Tandemsprung'))
    await user.type(field('Tandemsprung'), '290')

    expect(field('Tandemsprung')).toHaveAccessibleDescription('vorher 270 €')
    expect(field('Video')).not.toHaveAccessibleDescription()
  })

  it('marks the final prices a change would alter, with what they were', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Video'))
    await user.type(field('Video'), '110')

    const changed = within(row('Tandem + Video')).getAllByRole('cell')
    expect(changed[0]).toHaveClass('changed')
    expect(changed[0]).toHaveTextContent('380 €, vorher 370 €')
    // Shown, not only read out: the old amount struck through under the new one.
    expect(within(changed[0]).getByText('370 €').tagName).toBe('S')
    for (const cell of within(row('Tandem')).getAllByRole('cell')) expect(cell).not.toHaveClass('changed')
  })

  it('does not mark a final price as changed when a typo blanks it', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Video'))

    for (const cell of within(row('Tandem + Video')).getAllByRole('cell')) {
      expect(cell).not.toHaveClass('changed')
    }
  })

  it('puts the cursor back on the first changed field after Verwerfen', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.type(field('Video'), '5')
    await user.type(field('Kameraflieger Video'), '5')
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }))

    expect(field('Video')).toHaveFocus()
  })

  it('discards unsaved changes on Verwerfen', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Tandemsprung'))
    await user.type(field('Tandemsprung'), '999')
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }))

    expect(field('Tandemsprung').value).toBe('270')
    expect(save()).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).not.toBeInTheDocument()
  })

  it('reports whether there are unsaved changes, so leaving the page can ask first', async () => {
    const user = userEvent.setup()
    const onDirtyChange = vi.fn()
    render(<Betraege onDirtyChange={onDirtyChange} />)
    await screen.findByText('Preise (EUR)')

    await user.type(field('Tandemsprung'), '5')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }))
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('marks every invalid amount at its field and puts the cursor on the first', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Video'))
    await user.clear(field('Kameraflieger Video'))
    await user.type(field('Kameraflieger Video'), '-5')
    await user.click(save())

    expect(api.putSettings).not.toHaveBeenCalled()
    for (const label of ['Video', 'Kameraflieger Video']) {
      expect(field(label)).toHaveAttribute('aria-invalid', 'true')
    }
    expect(field('Video')).toHaveAccessibleDescription(expect.stringContaining('Betrag fehlt.'))
    expect(field('Kameraflieger Video'))
      .toHaveAccessibleDescription(expect.stringContaining('Kein Minus – Beträge ab 0.'))
    expect(field('Video')).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Bitte die markierten Beträge prüfen.')
  })

  it('names the rule an amount breaks', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    const cases: [string, string][] = [
      ['abc', 'Nur Ziffern, z. B. 280 oder 12,50.'],
      ['-5', 'Kein Minus – Beträge ab 0.'],
      ['12,505', 'Höchstens zwei Nachkommastellen.'],
      ['1.000', 'Höchstens zwei Nachkommastellen.'],
      ['12 €', 'Nur Ziffern, z. B. 280 oder 12,50.'],
    ]
    const bonus = field('Tandemmaster Zuschlag ab 90 kg')
    for (const [bad, message] of cases) {
      await user.clear(bonus)
      await user.type(bonus, bad)
      await user.click(save())
      expect(bonus).toHaveAttribute('aria-invalid', 'true')
      expect(bonus).toHaveAccessibleDescription(expect.stringContaining(message))
    }
    expect(api.putSettings).not.toHaveBeenCalled()
  })

  it('does not call an amount wrong while it is being typed, only once the field is left', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Video'))
    expect(field('Video')).toHaveAttribute('aria-invalid', 'false')
    await user.tab()
    expect(field('Video')).toHaveAttribute('aria-invalid', 'true')
    await user.click(field('Video'))
    await user.type(field('Video'), '100')
    expect(field('Video')).toHaveAttribute('aria-invalid', 'false')
  })

  it('announces a successful save', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.type(field('Tandemsprung'), '5')
    await user.click(save())

    expect(await screen.findByRole('status')).toHaveTextContent('Gespeichert. Gilt ab dem nächsten Sprungtag.')
    expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument()
    expect(save()).toBeDisabled()
  })

  it('shows no form when the amounts could not be loaded, and can try again', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getSettings).mockRejectedValueOnce(new Error('Netzwerkfehler'))
    render(<Betraege />)

    expect(await screen.findByText(/Tarife konnten nicht geladen werden/)).toBeInTheDocument()
    // An empty form here would save 0 € over every price.
    expect(screen.queryByLabelText('Tandemsprung')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Beträge speichern' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect((await screen.findByLabelText('Tandemsprung') as HTMLInputElement).value).toBe('270')
  })

  it('shows the final prices after the prices and the payout rates', async () => {
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Preise (EUR)', 'Vergütung (EUR)', 'Endpreise'])
    expect(row('Tandem')).toHaveTextContent('Tandem270 €310 €330 €')
    expect(screen.getByRole('table', { name: 'Endpreise' })).toBeInTheDocument()
  })

  it('puts the final prices in the third column, before the save bar', async () => {
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    // Layout is CSS; which row a block lands in is decided by the markup.
    const matrix = screen.getByRole('heading', { name: 'Endpreise' }).closest('.price-matrix')
    expect(matrix?.parentElement).toHaveClass('betraege-section')
    expect(matrix?.nextElementSibling).toHaveClass('save-bar')
  })

  it('updates the final prices while typing, before saving', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Tandemsprung'))
    await user.type(field('Tandemsprung'), '300')

    expect(row('Tandem')).toHaveTextContent('Tandem300 €')
    expect(row('Tandem')).toHaveTextContent('340 €')
    expect(api.putSettings).not.toHaveBeenCalled()
  })

  it('blanks the final prices a typo would break', async () => {
    const user = userEvent.setup()
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await user.clear(field('Video'))

    for (const cell of within(row('Tandem + Video')).getAllByRole('cell')) {
      expect(cell.textContent?.startsWith('–')).toBe(true)
    }
    expect(row('Tandem')).toHaveTextContent('Tandem270 €310 €330 €')
  })
})
