import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Settings from './Settings'
import * as api from './api'
import type { Settings as SettingsType } from './api'

vi.mock('./api', () => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  createBackup: vi.fn(),
  pickerAvailable: vi.fn(),
  pickPath: vi.fn(),
  checkPaths: vi.fn(),
}))

const CONFIG: SettingsType = {
  exportDir: 'C:/Tandem',
  contractText: 'Beförderungsvertrag …',
  privacyText: 'Datenschutzinformation …',
  jumpLocation: 'Freistadt',
  backupDir: '',
  voucherListPath: '',
  prices: { jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60 },
  payouts: {
    tandem_master: 45, video: 60, video_photo: 80, weight_over_90: 15, weight_over_100: 25,
  },
}

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG })
    vi.mocked(api.putSettings).mockImplementation(async (fields) => ({ ...CONFIG, ...fields }))
    vi.mocked(api.pickerAvailable).mockResolvedValue(false)
    vi.mocked(api.checkPaths).mockResolvedValue({})
  })

  it('saves the directories and the jump location', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await userEvent.clear(screen.getByLabelText('Ort (für Vertragsunterschrift)'))
    await userEvent.type(screen.getByLabelText('Ort (für Vertragsunterschrift)'), 'Linz')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    // The two texts travel back unchanged: the screen loaded them, so leaving
    // them out of the save would blank whatever it just displayed.
    expect(vi.mocked(api.putSettings).mock.calls[0][0]).toEqual({
      exportDir: 'C:/Tandem', jumpLocation: 'Linz', backupDir: '',
      contractText: 'Beförderungsvertrag …', privacyText: 'Datenschutzinformation …',
      voucherListPath: '',
    })
  })

  it('edits the texts the guest is shown before signing', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    const privacy = screen.getByLabelText(/Datenschutztext/) as HTMLTextAreaElement
    expect(privacy.value).toBe('Datenschutzinformation …')
    expect((screen.getByLabelText(/Vertragstext/) as HTMLTextAreaElement).value)
      .toBe('Beförderungsvertrag …')

    await userEvent.clear(privacy)
    await userEvent.type(privacy, 'Neue Fassung')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    expect(vi.mocked(api.putSettings).mock.calls[0][0])
      .toMatchObject({ privacyText: 'Neue Fassung' })
  })

  it('shows one guest text at a time and switches on the tab', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    // Ten rows of legal text twice over is what made this screen scroll. One at
    // a time, in the height the window actually has.
    expect(screen.getByLabelText('Datenschutztext')).toBeVisible()
    expect(screen.getByLabelText('Vertragstext')).not.toBeVisible()

    await userEvent.click(screen.getByRole('tab', { name: 'Vertragstext' }))

    expect(screen.getByLabelText('Vertragstext')).toBeVisible()
    expect(screen.getByLabelText('Datenschutztext')).not.toBeVisible()
  })

  it('keeps an edit made in the tab that is no longer showing, and saves both', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await userEvent.clear(screen.getByLabelText('Datenschutztext'))
    await userEvent.type(screen.getByLabelText('Datenschutztext'), 'Neue Datenschutzinfo')

    // Switching away is not discarding. Both fields stay mounted, so Speichern
    // still commits the text the operator cannot see at that moment.
    await userEvent.click(screen.getByRole('tab', { name: 'Vertragstext' }))
    await userEvent.clear(screen.getByLabelText('Vertragstext'))
    await userEvent.type(screen.getByLabelText('Vertragstext'), 'Neuer Vertrag')

    await userEvent.click(screen.getByRole('tab', { name: 'Datenschutztext' }))
    expect((screen.getByLabelText('Datenschutztext') as HTMLTextAreaElement).value)
      .toBe('Neue Datenschutzinfo')

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    expect(vi.mocked(api.putSettings).mock.calls[0][0]).toMatchObject({
      privacyText: 'Neue Datenschutzinfo',
      contractText: 'Neuer Vertrag',
    })
  })

  it('groups the paths and the backup into blocks of their own', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    // Everything that points at the disk, in one block: the operator sets these
    // once at the start of a season and does not read past them again.
    const paths = screen.getByRole('region', { name: 'Pfade & Ort' })
    expect(within(paths).getByLabelText('Export-Verzeichnis')).toBeInTheDocument()
    expect(within(paths).getByLabelText('Backup-Verzeichnis (leer = Export-Verzeichnis)'))
      .toBeInTheDocument()
    expect(within(paths).getByLabelText('Gutscheinliste (Excel-Datei)')).toBeInTheDocument()
    expect(within(paths).getByLabelText('Ort (für Vertragsunterschrift)')).toBeInTheDocument()

    // The backup button acts on its own; it is not part of what Speichern commits.
    const backup = screen.getByRole('region', { name: 'Datenbank-Backup' })
    expect(within(backup).getByRole('button', { name: 'Backup erstellen' })).toBeInTheDocument()
    expect(within(backup).queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()

    // The guest texts are their own block, away from the paths.
    const texts = screen.getByRole('region', { name: 'Texte' })
    expect(within(texts).getByLabelText(/Datenschutztext/)).toBeInTheDocument()
    expect(within(texts).getByLabelText(/Vertragstext/)).toBeInTheDocument()
  })

  it('offers no browse buttons where the picker is unavailable', async () => {
    // A tablet reaches the same screen, but the dialog would open on the host's
    // desktop where nobody sees it — so the button is not there at all.
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await waitFor(() => expect(api.pickerAvailable).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Export-Verzeichnis auswählen' }))
      .not.toBeInTheDocument()
  })

  it('offers a browse button for each of the three path fields', async () => {
    vi.mocked(api.pickerAvailable).mockResolvedValue(true)
    render(<Settings />)

    expect(await screen.findByRole('button', { name: 'Export-Verzeichnis auswählen' }))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Backup-Verzeichnis auswählen' }))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gutscheinliste auswählen' }))
      .toBeInTheDocument()
    // The jump location is a place name, not a path.
    expect(screen.queryByRole('button', { name: 'Ort auswählen' })).not.toBeInTheDocument()
  })

  it('puts the picked path into the field', async () => {
    vi.mocked(api.pickerAvailable).mockResolvedValue(true)
    vi.mocked(api.pickPath).mockResolvedValue('C:/Tandem/Export 2026')
    render(<Settings />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Export-Verzeichnis auswählen' })
    )

    await waitFor(() =>
      expect((screen.getByLabelText('Export-Verzeichnis') as HTMLInputElement).value)
        .toBe('C:/Tandem/Export 2026'))
    expect(api.pickPath).toHaveBeenCalledWith('directory', 'C:/Tandem')
  })

  it('asks for a file when picking the voucher list', async () => {
    vi.mocked(api.pickerAvailable).mockResolvedValue(true)
    vi.mocked(api.pickPath).mockResolvedValue('C:/Verein/Tandemliste.xlsx')
    render(<Settings />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Gutscheinliste auswählen' })
    )

    await waitFor(() => expect(api.pickPath).toHaveBeenCalledWith('excel-file', ''))
    expect((screen.getByLabelText('Gutscheinliste (Excel-Datei)') as HTMLInputElement).value)
      .toBe('C:/Verein/Tandemliste.xlsx')
  })

  it('blocks the browse buttons while a dialog is open', async () => {
    // The dialog belongs to the machine, not to the field: while one is open a
    // second click could only stack another one behind it.
    vi.mocked(api.pickerAvailable).mockResolvedValue(true)
    let release: (path: string | null) => void = () => {}
    vi.mocked(api.pickPath).mockReturnValue(new Promise((resolve) => { release = resolve }))
    render(<Settings />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Export-Verzeichnis auswählen' })
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export-Verzeichnis auswählen' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Gutscheinliste auswählen' })).toBeDisabled()

    release('C:/Tandem/Export')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export-Verzeichnis auswählen' })).toBeEnabled())
  })

  it('leaves the field alone when the dialog was cancelled', async () => {
    vi.mocked(api.pickerAvailable).mockResolvedValue(true)
    vi.mocked(api.pickPath).mockResolvedValue(null)
    render(<Settings />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Export-Verzeichnis auswählen' })
    )

    await waitFor(() => expect(api.pickPath).toHaveBeenCalled())
    expect((screen.getByLabelText('Export-Verzeichnis') as HTMLInputElement).value)
      .toBe('C:/Tandem')
  })

  it('warns about a path that is not there, without blocking the save', async () => {
    vi.mocked(api.checkPaths).mockResolvedValue({ exportDir: 'missing' })
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    expect(await screen.findByText('Verzeichnis existiert nicht')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    expect(screen.getByText('Gespeichert.')).toBeInTheDocument()
  })

  it('warns when the voucher list points at a directory', async () => {
    vi.mocked(api.checkPaths).mockResolvedValue({ voucherListPath: 'wrong-type' })
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    expect(await screen.findByText('Pfad ist keine Datei')).toBeInTheDocument()
  })

  it('names the text panel that is showing', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    // A tab panel with no accessible name announces as an unlabelled group.
    // It cannot borrow the tab's wording: the textarea inside already carries
    // that as its own label, and a label query would then match both.
    expect(screen.getByRole('tabpanel', { name: 'Datenschutz' })).toBeInTheDocument()
    expect(screen.queryByRole('tabpanel', { name: 'Vertrag' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Vertragstext' }))

    expect(screen.getByRole('tabpanel', { name: 'Vertrag' })).toBeInTheDocument()
    expect(screen.queryByRole('tabpanel', { name: 'Datenschutz' })).not.toBeInTheDocument()
  })

  it('leaves the amounts to the Stammdaten screen', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    // Prices and payout rates belong beside the crew they apply to; a second
    // editor here would let two screens overwrite each other.
    expect(screen.queryByText('Preise (EUR)')).not.toBeInTheDocument()
    expect(screen.queryByText('Vergütung (EUR)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tandemsprung')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tandemmaster pro Sprung')).not.toBeInTheDocument()
  })

  it('shows the Vertragstext with its bold passages, and can set one', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getSettings).mockResolvedValue({
      ...CONFIG,
      contractText: 'Vor **Absprung:** danach',
    })

    render(<Settings />)
    await screen.findByLabelText('Vertragstext')
    // The contract shares the panel with the privacy notice; only one is open.
    await user.click(screen.getByRole('tab', { name: 'Vertragstext' }))

    const area = screen.getByLabelText('Vertragstext') as HTMLTextAreaElement
    const panel = screen.getByRole('tabpanel', { name: 'Vertrag' })

    // The editor keeps the markers; the preview below it shows the result.
    expect(area.value).toBe('Vor **Absprung:** danach')
    expect(panel.querySelector('.text-preview strong')?.textContent).toBe('Absprung:')

    // Selecting "danach" and pressing Fett marks it up in the text.
    area.focus()
    area.setSelectionRange(18, 24)
    await user.click(within(panel).getByRole('button', { name: /Fett/ }))

    expect((screen.getByLabelText('Vertragstext') as HTMLTextAreaElement).value).toBe(
      'Vor **Absprung:** **danach**'
    )
  })

  it('marks a passage kursiv and shows it in the preview', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG, contractText: 'Vor danach' })

    render(<Settings />)
    await screen.findByLabelText('Vertragstext')
    await user.click(screen.getByRole('tab', { name: 'Vertragstext' }))

    const area = screen.getByLabelText('Vertragstext') as HTMLTextAreaElement
    const panel = screen.getByRole('tabpanel', { name: 'Vertrag' })
    area.focus()
    area.setSelectionRange(4, 10)
    await user.click(within(panel).getByRole('button', { name: /Kursiv/ }))

    expect((screen.getByLabelText('Vertragstext') as HTMLTextAreaElement).value).toBe(
      'Vor *danach*'
    )
    expect(panel.querySelector('.text-preview em')?.textContent).toBe('danach')
  })

  it('marks a passage unterstrichen and shows it in the preview', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG, contractText: 'Vor danach' })

    render(<Settings />)
    await screen.findByLabelText('Vertragstext')
    await user.click(screen.getByRole('tab', { name: 'Vertragstext' }))

    const area = screen.getByLabelText('Vertragstext') as HTMLTextAreaElement
    const panel = screen.getByRole('tabpanel', { name: 'Vertrag' })
    area.focus()
    area.setSelectionRange(4, 10)
    await user.click(within(panel).getByRole('button', { name: /Unterstrichen/ }))

    expect((screen.getByLabelText('Vertragstext') as HTMLTextAreaElement).value).toBe(
      'Vor __danach__'
    )
    expect(panel.querySelector('.text-preview u')?.textContent).toBe('danach')
  })

  it('reaches all three markers by keyboard', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG, contractText: 'Vor danach' })

    render(<Settings />)
    await screen.findByLabelText('Vertragstext')
    await user.click(screen.getByRole('tab', { name: 'Vertragstext' }))

    const area = screen.getByLabelText('Vertragstext') as HTMLTextAreaElement
    area.focus()
    area.setSelectionRange(4, 10)
    await user.keyboard('{Control>}i{/Control}')

    expect((screen.getByLabelText('Vertragstext') as HTMLTextAreaElement).value).toBe(
      'Vor *danach*'
    )
  })
})
