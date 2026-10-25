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
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))

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
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))

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

    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))

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
    expect(within(backup).queryByRole('button', { name: 'Einstellungen speichern' })).not.toBeInTheDocument()

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

    // Export and backup create a missing directory themselves; the warning is
    // there for the typo, not to stop anything.
    expect(await screen.findByText(/Verzeichnis existiert noch nicht/)).toBeInTheDocument()
    // Read out with the field, not only found by moving past it.
    expect(screen.getByLabelText('Export-Verzeichnis'))
      .toHaveAccessibleDescription(/Verzeichnis existiert noch nicht.*Tippfehler/)

    await userEvent.type(screen.getByLabelText('Export-Verzeichnis'), '/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    expect(screen.getByText('Gespeichert.')).toBeInTheDocument()
  })

  it('says when something is unsaved, and saves only then', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    // Nothing changed yet: a save could only rewrite what is already stored.
    const save = screen.getByRole('button', { name: 'Einstellungen speichern' })
    expect(save).toBeDisabled()
    expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Ort (für Vertragsunterschrift)'), ' Ost')

    expect(screen.getByText('Ungespeicherte Änderungen')).toBeInTheDocument()
    expect(save).toBeEnabled()

    await userEvent.click(save)

    expect(await screen.findByText('Gespeichert.')).toBeInTheDocument()
    expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument()
    expect(save).toBeDisabled()
  })

  it('goes back to what is saved on Verwerfen', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await userEvent.type(screen.getByLabelText('Datenschutztext'), ' ergänzt')
    await userEvent.click(screen.getByRole('tab', { name: 'Vertragstext' }))
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))

    // The change was in the tab that was not showing; it is opened and the
    // cursor put back where the change was.
    const privacy = screen.getByLabelText('Datenschutztext') as HTMLTextAreaElement
    expect(privacy.value).toBe('Datenschutzinformation …')
    expect(privacy).toBeVisible()
    await waitFor(() => expect(privacy).toHaveFocus())
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).not.toBeInTheDocument()
    expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument()
    expect(api.putSettings).not.toHaveBeenCalled()
  })

  it('marks the text tab that holds an unsaved edit', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    const contractTab = screen.getByRole('tab', { name: 'Vertragstext' })
    expect(contractTab.querySelector('.text-tab-dot')).toBeNull()

    await userEvent.click(contractTab)
    await userEvent.type(screen.getByLabelText('Vertragstext'), ' neu')

    expect(contractTab.querySelector('.text-tab-dot')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'Datenschutztext' }).querySelector('.text-tab-dot'))
      .toBeNull()
  })

  it('tells the app while something is unsaved', async () => {
    const onDirtyChange = vi.fn()
    const { unmount } = render(<Settings onDirtyChange={onDirtyChange} />)
    await screen.findByLabelText('Export-Verzeichnis')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    await userEvent.type(screen.getByLabelText('Ort (für Vertragsunterschrift)'), 'x')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    // Leaving the screen leaves nothing unsaved behind it.
    unmount()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('points out placeholders still in a guest text, in either tab', async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...CONFIG,
      contractText: 'Gerichtsstand [Ort eintragen] und [Datum].',
    })
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    // The contract tab is not showing, and its placeholders are still named.
    expect(screen.getByText(/^Vertragstext: 2 Angaben in eckigen Klammern/)).toBeVisible()
    expect(screen.queryByText(/^Datenschutztext:/)).not.toBeInTheDocument()

    const panel = document.querySelector('[role="tabpanel"][aria-label="Vertrag"]')!
    expect([...panel.querySelectorAll('.text-preview mark')].map((m) => m.textContent))
      .toEqual(['[Ort eintragen]', '[Datum]'])

    // Filled in, the warning goes with it.
    await userEvent.click(screen.getByRole('tab', { name: 'Vertragstext' }))
    await userEvent.clear(screen.getByLabelText('Vertragstext'))
    await userEvent.type(screen.getByLabelText('Vertragstext'), 'Gerichtsstand Linz.')
    expect(screen.queryByText(/^Vertragstext:/)).not.toBeInTheDocument()
  })

  it('marks a placeholder inside bold text without losing the bold', async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...CONFIG,
      privacyText: 'Frist: **[Dauer eintragen]** Jahre',
    })
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    const preview = screen.getByRole('tabpanel', { name: 'Datenschutz' })
      .querySelector('.text-preview p')!
    expect(preview.querySelector('strong mark')?.textContent).toBe('[Dauer eintragen]')
    expect(preview.textContent).toBe('Frist: [Dauer eintragen] Jahre')
  })

  it('refuses to save an empty guest text and opens it', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await userEvent.click(screen.getByRole('tab', { name: 'Vertragstext' }))
    await userEvent.clear(screen.getByLabelText('Vertragstext'))
    await userEvent.click(screen.getByRole('tab', { name: 'Datenschutztext' }))
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))

    expect(api.putSettings).not.toHaveBeenCalled()
    expect(screen.getByText('Nicht gespeichert: Vertragstext ist leer.')).toBeInTheDocument()
    // The reason stands at the text itself, and the text says it is the one.
    const contract = screen.getByLabelText('Vertragstext')
    expect(contract).toHaveAttribute('aria-invalid', 'true')
    expect(contract).toHaveAccessibleDescription(/Der Vertragstext ist leer/)
    await waitFor(() => expect(contract).toHaveFocus())

    // Typing the text back in is what clears the refusal.
    await userEvent.type(screen.getByLabelText('Vertragstext'), 'Vertrag')
    expect(screen.queryByText(/Vertragstext ist leer/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Vertragstext')).not.toHaveAttribute('aria-invalid')
  })

  it('asks before saving a changed text that still has a placeholder', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    const privacy = screen.getByLabelText('Datenschutztext') as HTMLTextAreaElement
    await userEvent.clear(privacy)
    await userEvent.type(privacy, 'Frist: [[Dauer eintragen]')
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(
      'Datenschutztext: 1 Angabe in eckigen Klammern noch nicht ersetzt.'))
    expect(api.putSettings).not.toHaveBeenCalled()
    // No: the placeholder is selected, ready to be typed over.
    await waitFor(() => expect(privacy).toHaveFocus())
    expect(privacy.value.slice(privacy.selectionStart, privacy.selectionEnd))
      .toBe('[Dauer eintragen]')

    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    confirm.mockRestore()
  })

  it('does not ask about a placeholder the save does not touch', async () => {
    // The shipped privacy text comes with one. Asking on every save of a
    // folder path would teach the operator to click the question away.
    const confirm = vi.spyOn(window, 'confirm')
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG, privacyText: 'Frist: [Dauer]' })
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await userEvent.type(screen.getByLabelText('Ort (für Vertragsunterschrift)'), ' Ost')
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('takes the operator to the placeholder a warning names', async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...CONFIG,
      contractText: 'Gerichtsstand [Ort eintragen].',
    })
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await userEvent.click(screen.getByRole('button', { name: /^Vertragstext: 1 Angabe/ }))

    const contract = screen.getByLabelText('Vertragstext') as HTMLTextAreaElement
    expect(contract).toBeVisible()
    await waitFor(() => expect(contract).toHaveFocus())
    expect(contract.value.slice(contract.selectionStart, contract.selectionEnd))
      .toBe('[Ort eintragen]')
  })

  it('warns while the jump location is empty, without blocking the save', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')
    expect(screen.queryByText(/Ort fehlt/)).not.toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Ort (für Vertragsunterschrift)'))
    expect(screen.getByLabelText('Ort (für Vertragsunterschrift)'))
      .toHaveAccessibleDescription(/Ort fehlt/)

    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
  })

  it('offers no form when the settings could not be loaded, only a retry', async () => {
    vi.mocked(api.getSettings).mockRejectedValueOnce(new Error('Server nicht erreichbar'))
    render(<Settings />)

    // An empty form saved from here would blank both guest texts.
    expect(await screen.findByText('Einstellungen konnten nicht geladen werden.'))
      .toBeInTheDocument()
    expect(screen.getByText('Server nicht erreichbar')).toBeInTheDocument()
    expect(screen.queryByLabelText('Export-Verzeichnis')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Einstellungen speichern' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(((await screen.findByLabelText('Export-Verzeichnis')) as HTMLInputElement).value)
      .toBe('C:/Tandem')
  })

  it('says a refused load once, not twice', async () => {
    // api.getSettings throws the same sentence the screen leads with.
    vi.mocked(api.getSettings).mockRejectedValueOnce(
      new Error('Einstellungen konnten nicht geladen werden'))
    render(<Settings />)

    expect(await screen.findByText('Einstellungen konnten nicht geladen werden.'))
      .toBeInTheDocument()
    expect(screen.getAllByText(/konnten nicht geladen werden/)).toHaveLength(1)
  })

  it('checks a typed path when the field is left, before any save', async () => {
    render(<Settings />)
    const field = await screen.findByLabelText('Export-Verzeichnis')
    vi.mocked(api.checkPaths).mockResolvedValue({ exportDir: 'missing' })

    await userEvent.type(field, '/Tipfehler')
    await userEvent.tab()

    expect(api.checkPaths).toHaveBeenLastCalledWith({ exportDir: 'C:/Tandem/Tipfehler' })
    expect(await screen.findByText(/Verzeichnis existiert noch nicht/)).toBeInTheDocument()
    expect(api.putSettings).not.toHaveBeenCalled()
  })

  it('holds the backup while its directory has unsaved changes', async () => {
    vi.mocked(api.createBackup).mockResolvedValue({ path: 'D:/Backup/tandem.db' })
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')
    const backup = screen.getByRole('button', { name: 'Backup erstellen' })
    expect(backup).toBeEnabled()

    // The server backs up into the saved directory, not the one typed here.
    await userEvent.type(screen.getByLabelText('Backup-Verzeichnis (leer = Export-Verzeichnis)'), 'D:/Backup')
    expect(backup).toBeDisabled()
    expect(backup).toHaveAccessibleDescription(/Erst speichern/)

    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }))
    await waitFor(() => expect(backup).toBeEnabled())

    vi.mocked(api.checkPaths).mockClear()
    await userEvent.click(backup)

    // Said where a screen reader hears it, and the paths looked at again: the
    // backup may just have created the directory a warning was about.
    expect(await screen.findByText('Backup erstellt: D:/Backup/tandem.db')).toBeInTheDocument()
    expect(screen.getByText('Backup erstellt: D:/Backup/tandem.db').closest('[role="status"]'))
      .not.toBeNull()
    await waitFor(() => expect(api.checkPaths).toHaveBeenCalledWith({
      exportDir: 'C:/Tandem', backupDir: 'D:/Backup',
    }))
  })

  it('does not hold the backup for an export change that does not move it', async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG, backupDir: 'D:/Backup' })
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await userEvent.type(screen.getByLabelText('Export-Verzeichnis'), '/2026')

    expect(screen.getByRole('button', { name: 'Backup erstellen' })).toBeEnabled()
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

  it('leaves the amounts to the Tarife screen', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    // Prices and payout rates have their own screen; a second editor here
    // would let two screens overwrite each other.
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
