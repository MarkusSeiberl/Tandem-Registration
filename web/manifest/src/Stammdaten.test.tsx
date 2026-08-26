import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Stammdaten from './Stammdaten'
import * as api from './api'
import type { Settings as SettingsType } from './api'

vi.mock('./api', () => ({
  masters: vi.fn(),
  flyers: vi.fn(),
  addMaster: vi.fn(),
  addFlyer: vi.fn(),
  deleteMaster: vi.fn(),
  deleteFlyer: vi.fn(),
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
  payouts: { tandem_master: 45, video: 60, video_photo: 80 },
}

describe('Stammdaten', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.masters).mockResolvedValue([{ id: 1, name: 'Hans' }])
    vi.mocked(api.flyers).mockResolvedValue([{ id: 7, name: 'Peter' }])
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG })
  })

  it('lists the crew', async () => {
    render(<Stammdaten />)

    expect(await screen.findByText('Hans')).toBeInTheDocument()
    expect(screen.getByText('Peter')).toBeInTheDocument()
  })

  it('carries the prices and payout rates, next to the people they apply to', async () => {
    render(<Stammdaten />)

    expect(await screen.findByText('Preise (EUR)')).toBeInTheDocument()
    expect(screen.getByText('Vergütung (EUR)')).toBeInTheDocument()
    expect((screen.getByLabelText('Tandemmaster pro Sprung') as HTMLInputElement).value).toBe('45')
  })

  it('puts the amounts above the crew lists', async () => {
    render(<Stammdaten />)
    await screen.findByText('Preise (EUR)')

    // What the screen is opened for on a normal day comes first. Asserted by
    // document order rather than by looks, which is the part a test can know.
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual([
      'Preise (EUR)', 'Vergütung (EUR)', 'Tandemmaster', 'Kameraflieger',
    ])
  })
})
