import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderRichText, toggleMarker } from './richText'

describe('renderRichText', () => {
  it('draws the markers as bold, exactly as the guest app does', () => {
    render(<p>{renderRichText('Vor **Absprung:** danach')}</p>)
    expect(screen.getByText('Absprung:').tagName).toBe('STRONG')
    expect(document.body.textContent).toBe('Vor Absprung: danach')
  })

  it('draws kursiv and unterstrichen too', () => {
    render(<p>{renderRichText('*leise* und __wichtig__')}</p>)
    expect(screen.getByText('leise').tagName).toBe('EM')
    expect(screen.getByText('wichtig').tagName).toBe('U')
  })
})

describe('toggleMarker', () => {
  it('wraps the selected words and keeps them selected', () => {
    const result = toggleMarker('Absprung: Hohlkreuz', 0, 9, '**')
    expect(result.value).toBe('**Absprung:** Hohlkreuz')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('Absprung:')
  })

  it('takes the markers away again when the selection carries them', () => {
    const result = toggleMarker('**Absprung:** Hohlkreuz', 0, 13, '**')
    expect(result.value).toBe('Absprung: Hohlkreuz')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('Absprung:')
  })

  it('takes them away for a selection made inside the markers', () => {
    // What a finger on a tablet actually selects: the words, not the stars.
    const result = toggleMarker('**Absprung:** Hohlkreuz', 2, 11, '**')
    expect(result.value).toBe('Absprung: Hohlkreuz')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('Absprung:')
  })

  it('opens an empty pair with the cursor inside when nothing is selected', () => {
    const result = toggleMarker('Text ', 5, 5, '**')
    expect(result.value).toBe('Text ****')
    expect(result.selectionStart).toBe(7)
    expect(result.selectionEnd).toBe(7)
  })

  it('leaves the rest of the text alone', () => {
    const result = toggleMarker('eins zwei drei', 5, 9, '**')
    expect(result.value).toBe('eins **zwei** drei')
  })

  it('wraps and unwraps kursiv with a single star', () => {
    const on = toggleMarker('eins zwei drei', 5, 9, '*')
    expect(on.value).toBe('eins *zwei* drei')
    const off = toggleMarker(on.value, on.selectionStart, on.selectionEnd, '*')
    expect(off.value).toBe('eins zwei drei')
  })

  it('wraps and unwraps unterstrichen with two underscores', () => {
    const on = toggleMarker('eins zwei drei', 5, 9, '__')
    expect(on.value).toBe('eins __zwei__ drei')
    const off = toggleMarker(on.value, on.selectionStart, on.selectionEnd, '__')
    expect(off.value).toBe('eins zwei drei')
  })

  it('adds kursiv to bold text instead of peeling a star off it', () => {
    // The dangerous case: '**fett**' starts and ends with the kursiv marker, so
    // a naive unwrap would silently downgrade fett to kursiv.
    const result = toggleMarker('**fett**', 0, 8, '*')
    expect(result.value).toBe('***fett***')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('**fett**')
  })

  it('adds kursiv from inside the bold markers too', () => {
    const result = toggleMarker('**fett**', 2, 6, '*')
    expect(result.value).toBe('***fett***')
  })

  it('takes only the kursiv star off text that is both', () => {
    const result = toggleMarker('***beides***', 0, 12, '*')
    expect(result.value).toBe('**beides**')
  })

  it('takes only the bold stars off text that is both', () => {
    const result = toggleMarker('***beides***', 0, 12, '**')
    expect(result.value).toBe('*beides*')
  })
})
