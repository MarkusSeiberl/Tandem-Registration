import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Crew from './Crew'
import * as api from './api'

vi.mock('./api', () => ({
  masters: vi.fn(),
  flyers: vi.fn(),
  addMaster: vi.fn(),
  addFlyer: vi.fn(),
  deleteMaster: vi.fn(),
  deleteFlyer: vi.fn(),
}))

describe('Crew', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.masters).mockResolvedValue([{ id: 1, name: 'Hans' }])
    vi.mocked(api.flyers).mockResolvedValue([{ id: 7, name: 'Peter' }])
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
})
