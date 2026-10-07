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

    const emailInputs = screen.getAllByPlaceholderText('E-Mail (optional)')
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
    await user.type(screen.getByPlaceholderText('E-Mail (optional)'), 'max@example.at')
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

  it('edits a flyer inline and reloads the list', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveValue('Peter')
    expect(screen.getByRole('textbox', { name: 'E-Mail' })).toHaveValue('peter@example.at')
    await user.clear(name)
    await user.type(name, 'Peter Huber')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(api.updateFlyer).toHaveBeenCalledWith(7, 'Peter Huber', 'peter@example.at')
    expect(api.flyers).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
  })

  it('cancelling the edit keeps the entry unchanged', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' Huber')
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(api.updateFlyer).not.toHaveBeenCalled()
    expect(screen.getByText('Peter')).toBeInTheDocument()
  })

  it('edits a tandem master name without an email field', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Hans bearbeiten' }))

    expect(screen.queryByRole('textbox', { name: 'E-Mail' })).not.toBeInTheDocument()
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Hans Maier{Enter}')

    expect(api.updateMaster).toHaveBeenCalledWith(1, 'Hans Maier', '')
  })

  it('disables adding a flyer while the email is malformed', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    await user.type(screen.getAllByPlaceholderText('Vorname Nachname')[1], 'Max Muster')
    await user.type(screen.getByPlaceholderText('E-Mail (optional)'), 'peter.example.at')

    const addButton = screen.getAllByRole('button', { name: 'Hinzufügen' })[1]
    expect(addButton).toBeDisabled()
    await user.click(addButton)
    expect(api.addFlyer).not.toHaveBeenCalled()
  })

  it('disables saving and ignores Enter while the edited email is malformed', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    const email = screen.getByRole('textbox', { name: 'E-Mail' })
    await user.clear(email)
    await user.type(email, 'kaputt')

    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
    await user.type(email, '{Enter}')
    expect(api.updateFlyer).not.toHaveBeenCalled()
  })

  it('disables saving when the name is cleared', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    await user.clear(screen.getByRole('textbox', { name: 'Name' }))

    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('closes the row on Escape without saving', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Escape}')

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
