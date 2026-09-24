import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UpdateDialog from './UpdateDialog'

const props = () => ({
  currentVersion: '1.1.0', latestVersion: '1.2.0',
  onAccept: vi.fn(), onLater: vi.fn(),
})

describe('UpdateDialog', () => {
  it('opens as a modal and names both versions', () => {
    render(<UpdateDialog {...props()} />)
    expect(screen.getByRole('dialog')).toHaveProperty('open', true)
    expect(screen.getByText(/1\.1\.0/)).toBeInTheDocument()
    expect(screen.getByText(/1\.2\.0/)).toBeInTheDocument()
  })

  it('says that the program restarts', () => {
    render(<UpdateDialog {...props()} />)
    expect(screen.getByText(/startet danach neu/)).toBeInTheDocument()
  })

  it('reports the accepted update', async () => {
    const p = props()
    render(<UpdateDialog {...p} />)
    await userEvent.click(screen.getByRole('button', { name: 'Jetzt aktualisieren' }))
    expect(p.onAccept).toHaveBeenCalledTimes(1)
  })

  it('reports a postponed update', async () => {
    const p = props()
    render(<UpdateDialog {...p} />)
    await userEvent.click(screen.getByRole('button', { name: 'Später' }))
    expect(p.onLater).toHaveBeenCalledTimes(1)
  })
})
