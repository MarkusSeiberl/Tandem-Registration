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

  it('keeps the list when one line lacks the "- " prefix (lazy continuation)', () => {
    render(<Markdown text={'- eins\nkommentar\n- zwei'} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('eins kommentar')
    expect(items[1]).toHaveTextContent('zwei')
  })

  it('ends a heading block at the next heading, even without a blank line', () => {
    const { container } = render(<Markdown text={'## A\n### B\nSome text'} />)
    expect(screen.getByRole('heading', { level: 3, name: 'A' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'B' })).toBeInTheDocument()
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]).toHaveTextContent('Some text')
    expect(container.textContent).not.toContain('### B Some text')
  })

  it('renders a heading immediately followed by body text on the next line', () => {
    const { container } = render(<Markdown text={'## Titel\nEin Satz.'} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Titel' })).toBeInTheDocument()
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]).toHaveTextContent('Ein Satz.')
  })

  it('starts a new heading block after ordinary text with no blank line before it', () => {
    const { container } = render(<Markdown text={'Intro text.\n## Heading\nMore text.'} />)
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]).toHaveTextContent('Intro text.')
    expect(paragraphs[1]).toHaveTextContent('More text.')
    expect(screen.getByRole('heading', { level: 3, name: 'Heading' })).toBeInTheDocument()
    expect(container.textContent).not.toContain('## Heading')
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
