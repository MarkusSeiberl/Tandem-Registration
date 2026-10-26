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

  // Accepting only downloads: saying so is what lets an operator say yes on a
  // busy morning without fearing a restart.
  it('says the download leaves operations running and installing comes later', () => {
    render(<UpdateDialog {...props()} />)
    expect(screen.getByText(/Betrieb geht normal weiter/)).toBeInTheDocument()
    expect(screen.getByText(/erst, wenn du es auf der Update-Seite bestätigst/)).toBeInTheDocument()
  })

  it('reports the accepted update', async () => {
    const p = props()
    render(<UpdateDialog {...p} />)
    await userEvent.click(screen.getByRole('button', { name: 'Herunterladen' }))
    expect(p.onAccept).toHaveBeenCalledTimes(1)
  })

  it('reports a postponed update', async () => {
    const p = props()
    render(<UpdateDialog {...p} />)
    await userEvent.click(screen.getByRole('button', { name: 'Später' }))
    expect(p.onLater).toHaveBeenCalledTimes(1)
  })
})
