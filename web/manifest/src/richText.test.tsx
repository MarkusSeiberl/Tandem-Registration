import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderRichText, toggleBold } from './richText'

describe('renderRichText', () => {
  it('draws the markers as bold, exactly as the guest app does', () => {
    render(<p>{renderRichText('Vor **Absprung:** danach')}</p>)
    expect(screen.getByText('Absprung:').tagName).toBe('STRONG')
    expect(document.body.textContent).toBe('Vor Absprung: danach')
  })
})

describe('toggleBold', () => {
  it('wraps the selected words and keeps them selected', () => {
    const result = toggleBold('Absprung: Hohlkreuz', 0, 9)
    expect(result.value).toBe('**Absprung:** Hohlkreuz')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('Absprung:')
  })

  it('takes the markers away again when the selection carries them', () => {
    const result = toggleBold('**Absprung:** Hohlkreuz', 0, 13)
    expect(result.value).toBe('Absprung: Hohlkreuz')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('Absprung:')
  })

  it('takes them away for a selection made inside the markers', () => {
    // What a finger on a tablet actually selects: the words, not the stars.
    const result = toggleBold('**Absprung:** Hohlkreuz', 2, 11)
    expect(result.value).toBe('Absprung: Hohlkreuz')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('Absprung:')
  })

  it('opens an empty pair with the cursor inside when nothing is selected', () => {
    const result = toggleBold('Text ', 5, 5)
    expect(result.value).toBe('Text ****')
    expect(result.selectionStart).toBe(7)
    expect(result.selectionEnd).toBe(7)
  })

  it('leaves the rest of the text alone', () => {
    const result = toggleBold('eins zwei drei', 5, 9)
    expect(result.value).toBe('eins **zwei** drei')
  })
})
