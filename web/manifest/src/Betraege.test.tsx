import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  payouts: { tandem_master: 45, video: 60, video_photo: 80 },
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Beträge speichern' })

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

  it('saves both blocks together', async () => {
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await userEvent.clear(field('Tandemmaster pro Sprung'))
    await userEvent.type(field('Tandemmaster pro Sprung'), '50')
    await userEvent.click(save())

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    const sent = vi.mocked(api.putSettings).mock.calls[0][0]
    expect(sent.payouts).toEqual({ tandem_master: 50, video: 60, video_photo: 80 })
    expect(sent.prices?.jump).toBe(270)
    // The directories belong to the settings screen — sending them from here
    // would let a stale value overwrite what was saved there.
    expect(sent.exportDir).toBeUndefined()
    expect(sent.backupDir).toBeUndefined()
  })

  it('refuses to save an empty price', async () => {
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await userEvent.clear(field('Video'))
    await userEvent.click(save())

    expect(await screen.findByText('Preis „Video" ungültig')).toBeInTheDocument()
    expect(api.putSettings).not.toHaveBeenCalled()
  })

  it('refuses to save an empty payout rate', async () => {
    render(<Betraege />)
    await screen.findByText('Vergütung (EUR)')

    await userEvent.clear(field('Kameraflieger Video'))
    await userEvent.click(save())

    expect(await screen.findByText('Vergütung „Kameraflieger Video" ungültig')).toBeInTheDocument()
    expect(api.putSettings).not.toHaveBeenCalled()
  })
})
