import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SelectionBar from './SelectionBar'

function renderBar(overrides: Partial<React.ComponentProps<typeof SelectionBar>> = {}) {
  return render(
    <SelectionBar
      selectedCount={0}
      openCount={0}
      busy={false}
      onCollect={() => {}}
      onDelete={() => {}}
      onClear={() => {}}
      {...overrides}
    />
  )
}

const collectButton = () => screen.queryByRole('button', { name: /^Kassieren/ })
const deleteButton = () => screen.queryByRole('button', { name: /^Ausgewählte löschen/ })
const clearButton = () => screen.queryByRole('button', { name: 'Auswahl leeren' })

describe('SelectionBar', () => {
  // The height is reserved whether or not anything is checked, so ticking the
  // first box cannot push the rows out from under the operator's finger. That
  // makes "is there a selection" a question about the bar's *content*, not its
  // presence, which is what these tests assert.
  describe('ohne Auswahl', () => {
    it('zeigt keine Aktion und keine Zusammenfassung', () => {
      renderBar({ selectedCount: 0, openCount: 0 })

      expect(collectButton()).not.toBeInTheDocument()
      expect(deleteButton()).not.toBeInTheDocument()
      expect(clearButton()).not.toBeInTheDocument()
      expect(screen.queryByText(/ausgewählt/)).not.toBeInTheDocument()
    })

    it('hält trotzdem seine Höhe', () => {
      const { container } = renderBar({ selectedCount: 0, openCount: 0 })

      expect(container.querySelector('.selection-bar')).toBeInTheDocument()
    })
  })

  describe('gemischte Auswahl', () => {
    it('nennt beide Mengen und schreibt jede auf ihren Button', () => {
      renderBar({ selectedCount: 5, openCount: 3 })

      expect(screen.getByText('5 ausgewählt · 3 offen')).toBeInTheDocument()
      expect(collectButton()).toHaveAccessibleName('Kassieren (3)')
      expect(deleteButton()).toHaveAccessibleName('Ausgewählte löschen (5)')
    })
  })

  describe('nur kassierte Zeilen angehakt', () => {
    // A disabled Kassieren was the weak signal this bar exists to replace — with
    // nothing open to collect the action is absent, not greyed out.
    it('bietet Kassieren nicht an, Löschen schon', () => {
      renderBar({ selectedCount: 2, openCount: 0 })

      expect(screen.getByText('2 ausgewählt · keine offen')).toBeInTheDocument()
      expect(collectButton()).not.toBeInTheDocument()
      expect(deleteButton()).toHaveAccessibleName('Ausgewählte löschen (2)')
    })
  })

  describe('eine Zeile', () => {
    it('zählt im Singular', () => {
      renderBar({ selectedCount: 1, openCount: 1 })

      expect(screen.getByText('1 ausgewählt · 1 offen')).toBeInTheDocument()
    })
  })

  it('meldet die drei Aktionen an den Aufrufer', async () => {
    const user = userEvent.setup()
    const onCollect = vi.fn()
    const onDelete = vi.fn()
    const onClear = vi.fn()
    renderBar({ selectedCount: 5, openCount: 3, onCollect, onDelete, onClear })

    await user.click(collectButton()!)
    await user.click(deleteButton()!)
    await user.click(clearButton()!)

    expect(onCollect).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onClear).toHaveBeenCalledOnce()
  })

  // A bulk run is in flight in List — pressing anything here would race it.
  it('sperrt alles, solange eine Massenaktion läuft', () => {
    renderBar({ selectedCount: 5, openCount: 3, busy: true })

    expect(collectButton()).toBeDisabled()
    expect(deleteButton()).toBeDisabled()
    expect(clearButton()).toBeDisabled()
  })

  it('sagt die Anzahl an, wenn sie sich ändert', () => {
    renderBar({ selectedCount: 5, openCount: 3 })

    expect(screen.getByText('5 ausgewählt · 3 offen')).toHaveAttribute('aria-live', 'polite')
  })

  it('ist als Region „Auswahl“ erreichbar', () => {
    renderBar({ selectedCount: 5, openCount: 3 })

    expect(screen.getByRole('region', { name: 'Auswahl' })).toBeInTheDocument()
  })
})
