import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Crew from './Crew'
import * as api from './api'

vi.mock('./api', () => ({
  masters: vi.fn(),
  flyers: vi.fn(),
  addMaster: vi.fn(),
  addFlyer: vi.fn(),
  updateMaster: vi.fn(),
  updateFlyer: vi.fn(),
  deleteMaster: vi.fn(),
  deleteFlyer: vi.fn(),
}))

describe('Crew', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.masters).mockResolvedValue([{ id: 1, name: 'Hans' }])
    vi.mocked(api.flyers).mockResolvedValue([{ id: 7, name: 'Peter', email: 'peter@example.at' }])
    vi.mocked(api.addFlyer).mockResolvedValue({ id: 8 })
    vi.mocked(api.updateFlyer).mockResolvedValue({ id: 7, name: 'Peter Huber', email: 'peter@example.at' })
    vi.mocked(api.updateMaster).mockResolvedValue({ id: 1, name: 'Hans Maier' })
  })

  it('lists the crew', async () => {
    render(<Crew />)

    expect(await screen.findByText('Hans')).toBeInTheDocument()
    expect(screen.getByText('Peter')).toBeInTheDocument()
  })

  it('asks for first and last name above each list', async () => {
    render(<Crew />)
    const hans = await screen.findByText('Hans')
    const peter = screen.getByText('Peter')

    const inputs = screen.getAllByPlaceholderText('Vorname Nachname')
    expect(inputs).toHaveLength(2)
    // Document order, not looks: the field comes before the names it adds to.
    expect(inputs[0].compareDocumentPosition(hans) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(inputs[1].compareDocumentPosition(peter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('carries only the crew, the amounts live on Tarife', async () => {
    render(<Crew />)
    await screen.findByText('Hans')

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Tandemmaster', 'Kameraflieger'])
    expect(screen.queryByText('Preise (EUR)')).not.toBeInTheDocument()
  })

  it('offers an email field only for camera flyers', async () => {
    render(<Crew />)
    await screen.findByText('Hans')

    const emailInputs = screen.getAllByLabelText('E-Mail (optional)')
    expect(emailInputs).toHaveLength(1)
    const flyerHeading = screen.getByRole('heading', { name: 'Kameraflieger' })
    expect(flyerHeading.compareDocumentPosition(emailInputs[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a flyer email under the name', async () => {
    render(<Crew />)

    expect(await screen.findByText('peter@example.at')).toBeInTheDocument()
  })

  it('adds a flyer with an email', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    await user.type(screen.getAllByPlaceholderText('Vorname Nachname')[1], 'Max Muster')
    await user.type(screen.getByLabelText('E-Mail (optional)'), 'max@example.at')
    await user.click(screen.getAllByRole('button', { name: 'Hinzufügen' })[1])

    expect(api.addFlyer).toHaveBeenCalledWith('Max Muster', 'max@example.at')
  })

  it('adds a flyer without an email', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    await user.type(screen.getAllByPlaceholderText('Vorname Nachname')[1], 'Max Muster')
    await user.click(screen.getAllByRole('button', { name: 'Hinzufügen' })[1])

    expect(api.addFlyer).toHaveBeenCalledWith('Max Muster', undefined)
  })

  it('adds a tandem master with Enter in the name field', async () => {
    vi.mocked(api.addMaster).mockResolvedValue({ id: 2 })
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Hans')

    const name = screen.getAllByPlaceholderText('Vorname Nachname')[0]
    await user.type(name, 'Eva Berger{Enter}')

    expect(api.addMaster).toHaveBeenCalledWith('Eva Berger', undefined)
    expect(name).toHaveValue('')
  })

  it('adds a flyer with Enter in the email field', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    await user.type(screen.getAllByPlaceholderText('Vorname Nachname')[1], 'Max Muster')
    await user.type(screen.getByLabelText('E-Mail (optional)'), 'max@example.at{Enter}')

    expect(api.addFlyer).toHaveBeenCalledWith('Max Muster', 'max@example.at')
  })

  it('ignores Enter in the add fields while the name is empty or the email malformed', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    const name = screen.getAllByPlaceholderText('Vorname Nachname')[1]
    await user.type(name, '{Enter}')
    await user.type(name, 'Max Muster')
    await user.type(screen.getByLabelText('E-Mail (optional)'), 'max@{Enter}')

    expect(api.addFlyer).not.toHaveBeenCalled()
  })

  it('edits a flyer inline and reloads the list', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    const name = screen.getByRole('textbox', { name: 'Name ändern' })
    expect(name).toHaveValue('Peter')
    expect(screen.getByRole('textbox', { name: 'E-Mail ändern' })).toHaveValue('peter@example.at')
    await user.clear(name)
    await user.type(name, 'Peter Huber')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(api.updateFlyer).toHaveBeenCalledWith(7, 'Peter Huber', 'peter@example.at')
    expect(api.flyers).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
  })

  it('swaps edit and delete for cancel and save icons in the same place', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    const cancel = screen.getByRole('button', { name: 'Abbrechen' })
    const save = screen.getByRole('button', { name: 'Speichern' })
    for (const button of [cancel, save]) {
      expect(button).toHaveClass('btn-icon')
      expect(button).toHaveTextContent('')
    }
    expect(save).toHaveClass('primary')
    // Cancel where the pencil was, save where the bin was.
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('cancelling the edit keeps the entry unchanged', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    await user.type(screen.getByRole('textbox', { name: 'Name ändern' }), ' Huber')
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(api.updateFlyer).not.toHaveBeenCalled()
    expect(screen.getByText('Peter')).toBeInTheDocument()
  })

  it('edits a tandem master name without an email field', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Hans bearbeiten' }))

    expect(screen.queryByRole('textbox', { name: 'E-Mail ändern' })).not.toBeInTheDocument()
    const name = screen.getByRole('textbox', { name: 'Name ändern' })
    await user.clear(name)
    await user.type(name, 'Hans Maier{Enter}')

    expect(api.updateMaster).toHaveBeenCalledWith(1, 'Hans Maier', '')
  })

  it('explains a malformed email when Hinzufügen is clicked instead of ignoring the click', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    await user.type(screen.getAllByPlaceholderText('Vorname Nachname')[1], 'Max Muster')
    const email = screen.getByLabelText('E-Mail (optional)')
    await user.type(email, 'peter.example.at')

    const addButton = screen.getAllByRole('button', { name: 'Hinzufügen' })[1]
    expect(addButton).toBeEnabled()
    await user.click(addButton)
    expect(api.addFlyer).not.toHaveBeenCalled()
    expect(email).toHaveAccessibleDescription('Keine gültige E-Mail-Adresse.')
    expect(email).toHaveFocus()
  })

  it('does not call an email malformed while it is still being typed', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    const email = screen.getByLabelText('E-Mail (optional)')
    await user.type(email, 'max@')

    expect(screen.queryByText('Keine gültige E-Mail-Adresse.')).not.toBeInTheDocument()
    expect(email).toHaveAttribute('aria-invalid', 'false')
  })

  it('checks the email on leaving the field and clears the message once it is fixed', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    const email = screen.getByLabelText('E-Mail (optional)')
    await user.type(email, 'test@foo')
    await user.tab()

    expect(email).toHaveAccessibleDescription('Keine gültige E-Mail-Adresse.')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    await user.type(email, '.at')
    expect(screen.queryByText('Keine gültige E-Mail-Adresse.')).not.toBeInTheDocument()
  })

  it('says why a malformed email blocks saving an edit', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    const email = screen.getByRole('textbox', { name: 'E-Mail ändern' })
    await user.clear(email)
    await user.type(email, 'kaputt')
    expect(screen.queryByText('Keine gültige E-Mail-Adresse.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(api.updateFlyer).not.toHaveBeenCalled()
    expect(email).toHaveAccessibleDescription('Keine gültige E-Mail-Adresse.')
  })

  it('refuses a name that is already in the list, whatever its case and spacing', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Hans')

    const name = screen.getAllByPlaceholderText('Vorname Nachname')[0]
    await user.type(name, '  HANS {Enter}')

    expect(api.addMaster).not.toHaveBeenCalled()
    expect(name).toHaveAccessibleDescription('„Hans“ ist schon in der Liste.')
    expect(screen.getAllByRole('button', { name: 'Hinzufügen' })[0]).toBeDisabled()
  })

  it('refuses renaming someone to a name another entry already has', async () => {
    vi.mocked(api.masters).mockResolvedValue([{ id: 1, name: 'Hans' }, { id: 2, name: 'Eva' }])
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Eva bearbeiten' }))

    const name = screen.getByRole('textbox', { name: 'Name ändern' })
    await user.clear(name)
    await user.type(name, 'HANS{Enter}')

    expect(api.updateMaster).not.toHaveBeenCalled()
    expect(name).toHaveAccessibleDescription(expect.stringContaining('„Hans“ ist schon in der Liste.'))
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('lets an entry keep its own name when only the case changes', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Hans bearbeiten' }))

    const name = screen.getByRole('textbox', { name: 'Name ändern' })
    await user.clear(name)
    await user.type(name, 'HANS{Enter}')

    expect(api.updateMaster).toHaveBeenCalledWith(1, 'HANS', '')
  })

  it('tells the editor a new name also applies to past jump days', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Hans bearbeiten' }))

    expect(screen.getByRole('textbox', { name: 'Name ändern' }))
      .toHaveAccessibleDescription('Der neue Name gilt auch für frühere Sprungtage.')
  })

  it('does not save on Enter while the edited email is malformed, and says why', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    const email = screen.getByRole('textbox', { name: 'E-Mail ändern' })
    await user.clear(email)
    await user.type(email, 'kaputt{Enter}')

    expect(api.updateFlyer).not.toHaveBeenCalled()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription('Keine gültige E-Mail-Adresse.')
  })

  it('labels the add fields visibly and names each list after its heading', async () => {
    render(<Crew />)
    await screen.findByText('Hans')

    const masters = screen.getByRole('region', { name: 'Tandemmaster' })
    expect(within(masters).getByLabelText('Name')).toHaveAttribute('placeholder', 'Vorname Nachname')
    const flyers = screen.getByRole('region', { name: 'Kameraflieger' })
    expect(within(flyers).getByLabelText('Name')).toBeInTheDocument()
    expect(within(flyers).getByLabelText('E-Mail (optional)')).toBeInTheDocument()
  })

  it('returns focus to the row after saving an edit', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Hans bearbeiten' }))

    await user.type(screen.getByRole('textbox', { name: 'Name ändern' }), ' Maier{Enter}')

    expect(api.updateMaster).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Hans bearbeiten' })).toHaveFocus()
  })

  it('returns focus to the row after cancelling with Escape', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    await user.keyboard('{Escape}')

    expect(screen.getByRole('button', { name: 'Peter bearbeiten' })).toHaveFocus()
  })

  it('moves focus to the next row after deleting, and to the add field when the list is empty', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.masters).mockResolvedValue([{ id: 1, name: 'Hans' }, { id: 2, name: 'Eva' }])
    vi.mocked(api.deleteMaster).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<Crew />)

    vi.mocked(api.masters).mockResolvedValue([{ id: 2, name: 'Eva' }])
    await user.click(await screen.findByRole('button', { name: 'Hans entfernen' }))
    expect(screen.getByRole('button', { name: 'Eva bearbeiten' })).toHaveFocus()

    vi.mocked(api.masters).mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'Eva entfernen' }))
    const masters = screen.getByRole('region', { name: 'Tandemmaster' })
    expect(within(masters).getByLabelText('Name')).toHaveFocus()
  })

  it('disables saving when the name is cleared', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    await user.clear(screen.getByRole('textbox', { name: 'Name ändern' }))

    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('closes the row on Escape without saving', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    await user.type(screen.getByRole('textbox', { name: 'Name ändern' }), '{Escape}')

    expect(api.updateFlyer).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
  })

  it('keeps the row in edit mode when saving fails', async () => {
    vi.mocked(api.updateFlyer).mockRejectedValue(new Error('E-Mail ungültig'))
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    const flyerList = screen.getByRole('heading', { name: 'Kameraflieger' }).closest('section')!
    expect(await within(flyerList).findByText('E-Mail ungültig')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
  })
})
