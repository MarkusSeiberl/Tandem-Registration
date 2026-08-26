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

  it('italicises what stands between single stars', () => {
    show('Vor *leise* danach')
    expect(screen.getByText('leise').tagName).toBe('EM')
    expect(document.body.textContent).toBe('Vor leise danach')
  })

  it('underlines what stands between double underscores', () => {
    show('Vor __wichtig__ danach')
    expect(screen.getByText('wichtig').tagName).toBe('U')
    expect(document.body.textContent).toBe('Vor wichtig danach')
  })

  it('keeps bold bold when a single star stands right beside it', () => {
    // The star that opens kursiv must never be read as half of a fett marker.
    show('**fett** und *kursiv*')
    expect(screen.getByText('fett').tagName).toBe('STRONG')
    expect(screen.getByText('kursiv').tagName).toBe('EM')
  })

  it('lets the markers combine', () => {
    show('***beides***')
    const em = screen.getByText('beides')
    expect(em.tagName).toBe('EM')
    expect(em.parentElement?.tagName).toBe('STRONG')
  })

  it('lets an underline sit inside bold', () => {
    show('**fett __und__ unterstrichen**')
    expect(screen.getByText('und').tagName).toBe('U')
    expect(document.body.textContent).toBe('fett und unterstrichen')
  })

  it('leaves a lone underscore pair alone', () => {
    show('snake_case __ ohne Partner')
    expect(document.body.textContent).toBe('snake_case __ ohne Partner')
    expect(document.querySelector('u')).toBeNull()
  })

  it('leaves a single underscore in a word alone', () => {
    // The texts are prose, not code, but a file name in them must survive.
    show('Datei tandem_export_2026.xlsx')
    expect(document.body.textContent).toBe('Datei tandem_export_2026.xlsx')
    expect(document.querySelector('u')).toBeNull()
    expect(document.querySelector('em')).toBeNull()
  })

  it('renders plain text unchanged', () => {
    show('Ganz ohne Auszeichnung.')
    expect(document.body.textContent).toBe('Ganz ohne Auszeichnung.')
    expect(document.querySelector('strong')).toBeNull()
  })
})
