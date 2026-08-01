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

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getSettings).mockResolvedValue({ ...CONFIG })
    vi.mocked(api.putSettings).mockImplementation(async (fields) => ({ ...CONFIG, ...fields }))
  })

  it('saves the directories and the jump location', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await userEvent.clear(screen.getByLabelText('Ort (für Vertragsunterschrift)'))
    await userEvent.type(screen.getByLabelText('Ort (für Vertragsunterschrift)'), 'Linz')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    expect(vi.mocked(api.putSettings).mock.calls[0][0]).toEqual({
      exportDir: 'C:/Tandem', jumpLocation: 'Linz', backupDir: '',
    })
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
})
