import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderRichText } from './richText'

function show(text: string) {
  render(<p>{renderRichText(text)}</p>)
}

describe('renderRichText', () => {
  it('bolds what stands between the markers, and drops the markers', () => {
    show('Vor **Absprung:** danach')
    const bold = screen.getByText('Absprung:')
    expect(bold.tagName).toBe('STRONG')
    expect(document.body.textContent).toBe('Vor Absprung: danach')
  })

  it('bolds every passage, not only the first', () => {
    show('**eins** und **zwei**')
    expect(screen.getByText('eins').tagName).toBe('STRONG')
    expect(screen.getByText('zwei').tagName).toBe('STRONG')
  })

  it('carries bold across the line breaks of a whole paragraph', () => {
    show('**erste Zeile\nzweite Zeile**')
    expect(screen.getByText('erste Zeile zweite Zeile').tagName).toBe('STRONG')
  })

  it('leaves a lone marker on screen instead of swallowing it', () => {
    // Visible is fixable. A marker that vanished would leave the club looking
    // for a bold passage that never arrives.
    show('Ein ** ohne Partner')
    expect(document.body.textContent).toBe('Ein ** ohne Partner')
    expect(document.querySelector('strong')).toBeNull()
  })

  it('leaves an empty pair alone', () => {
    show('nichts **** dazwischen')
    expect(document.body.textContent).toBe('nichts **** dazwischen')
    expect(document.querySelector('strong')).toBeNull()
  })

  it('renders plain text unchanged', () => {
    show('Ganz ohne Auszeichnung.')
    expect(document.body.textContent).toBe('Ganz ohne Auszeichnung.')
    expect(document.querySelector('strong')).toBeNull()
  })
})
