import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Settings from './Settings'
import * as api from './api'
import type { Settings as SettingsType } from './api'

vi.mock('./api', () => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  createBackup: vi.fn(),
}))

const CONFIG: SettingsType = {
  exportDir: 'C:/Tandem',
  contractText: '',
  jumpLocation: 'Freistadt',
  backupDir: '',
  prices: { jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60 },
  payouts: { tandem_master: 45, video: 60, video_photo: 80 },
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

describe('Settings', () => {
  beforeEach(() => {
    // Call counts survive between tests otherwise, so a later "was never saved"
    // assertion would see the save from the test before it.
    vi.clearAllMocks()
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG })
    vi.mocked(api.putSettings).mockImplementation(async (fields) => ({ ...CONFIG, ...fields }))
  })

  it('shows the configured payout rates', async () => {
    render(<Settings />)

    expect(await screen.findByText('Vergütung (EUR)')).toBeInTheDocument()
    expect(field('Tandemmaster pro Sprung').value).toBe('45')
    expect(field('Videoflieger Video').value).toBe('60')
    expect(field('Videoflieger Video + Foto').value).toBe('80')
  })

  it('saves a changed rate without touching the prices', async () => {
    render(<Settings />)
    await screen.findByText('Vergütung (EUR)')

    await userEvent.clear(field('Tandemmaster pro Sprung'))
    await userEvent.type(field('Tandemmaster pro Sprung'), '50')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    const sent = vi.mocked(api.putSettings).mock.calls[0][0]
    expect(sent.payouts).toEqual({ tandem_master: 50, video: 60, video_photo: 80 })
    expect(sent.prices?.jump).toBe(270)
  })

  it('refuses to save an empty or negative rate', async () => {
    render(<Settings />)
    await screen.findByText('Vergütung (EUR)')

    await userEvent.clear(field('Videoflieger Video'))
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(await screen.findByText('Vergütung „Videoflieger Video" ungültig')).toBeInTheDocument()
    expect(api.putSettings).not.toHaveBeenCalled()
  })
})
