import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from './markdown'

describe('Markdown', () => {
  it('renders ## and ### as headings', () => {
    render(<Markdown text={'## Kassieren\n\n### Details'} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Kassieren' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'Details' })).toBeInTheDocument()
  })

  it('renders - lines as a list', () => {
    render(<Markdown text={'- eins\n- zwei'} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders **bold** inside a paragraph', () => {
    const { container } = render(<Markdown text="Ein **wichtiger** Satz." />)
    expect(container.querySelector('strong')).toHaveTextContent('wichtig')
  })

  it('renders `code` as code', () => {
    const { container } = render(<Markdown text="Die Datei `tandem.exe` ist groß." />)
    expect(container.querySelector('code')).toHaveTextContent('tandem.exe')
  })

  it('keeps blank-line-separated blocks apart', () => {
    const { container } = render(<Markdown text={'Erster Absatz.\n\nZweiter Absatz.'} />)
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  // The text comes from the internet. It is rendered, never interpreted.
  it('never builds HTML out of the text', () => {
    const { container } = render(<Markdown text="<img src=x onerror=alert(1)>" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('renders nothing for an empty release body', () => {
    const { container } = render(<Markdown text="" />)
    expect(container.textContent).toBe('')
  })
})
