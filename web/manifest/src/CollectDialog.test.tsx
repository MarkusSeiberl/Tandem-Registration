import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollectDialog from './CollectDialog'
import type { Registration } from './api'

// Local to this file on purpose — see List.test.tsx line 33 for the sibling copy.
// Two call sites are not yet a pattern worth a shared module.
function makeRow(overrides: Partial<Registration>): Registration {
  return {
    id: 1,
    first_name: 'Anna',
    last_name: 'Muster',
    gender: 'female',
    age: 30,
    height_cm: 170,
    weight_kg: 70,
    street: 'Hauptstraße 1',
    postal_code: '5020',
    city: 'Salzburg',
    email: 'anna@example.com',
    phone: '0664 1234567',
    contract_pdf_filename: null,
    accepted_terms: 1,
    tandem_master_id: null,
    load_number: null,
    price: null,
    payment_method: null,
    voucher_payment_method: null,
    voucher_number: null,
    voucher_service: null,
    voucher_topup: 0,
    voucher_amount: null,
    extra_booking: null,
    weight_surcharge: 'none',
    price_override: 0,
    camera_flyer_id: null,
    created_at: '2026-07-09T10:00:00.000Z',
    jump_date: '2026-07-09',
    paid_at: null,
    notes: null,
    privacy_ack_at: '2026-07-09T09:59:00.000Z',
    voucher_redeemed_at: null,
    voucher_redeem_synced_at: null,
    voucher_check_status: null,
    voucher_check_detail: null,
    ...overrides,
  }
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof CollectDialog>> = {}) {
  return render(
    <CollectDialog
      rows={[makeRow({ price: 100 })]}
      skippedCount={0}
      busy={false}
      error={null}
      onConfirm={() => {}}
      onCancel={() => {}}
      {...overrides}
    />
  )
}

describe('CollectDialog', () => {
  it('summiert den Preis der Zeilen und nennt die Anzahl im Plural', () => {
    renderDialog({ rows: [makeRow({ id: 1, price: 300 }), makeRow({ id: 2, price: 390 })] })
    expect(screen.getByRole('heading', { name: '2 Tandems kassieren' })).toBeInTheDocument()
    expect(screen.getByText('690 €')).toBeInTheDocument()
  })

  it('zeigt den Singular bei genau einer Zeile', () => {
    renderDialog({ rows: [makeRow({ id: 1, price: 100 })] })
    expect(screen.getByRole('heading', { name: '1 Tandem kassieren' })).toBeInTheDocument()
  })

  it('zeigt die übersprungenen Zeilen nur, wenn es welche gibt', () => {
    const { rerender } = renderDialog({ skippedCount: 1 })
    expect(screen.getByText('1 bereits kassierte Zeile bleibt unverändert.')).toBeInTheDocument()

    rerender(
      <CollectDialog
        rows={[makeRow({ price: 100 })]}
        skippedCount={2}
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByText('2 bereits kassierte Zeilen bleiben unverändert.')).toBeInTheDocument()

    rerender(
      <CollectDialog
        rows={[makeRow({ price: 100 })]}
        skippedCount={0}
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.queryByText(/bereits kassierte Zeile/)).not.toBeInTheDocument()
  })

  // The run is named row by row, so the operator sees who is about to be
  // booked rather than only how many.
  it('lists every tandem in the run by name with its amount', () => {
    renderDialog({
      rows: [
        makeRow({ id: 1, first_name: 'Anna', last_name: 'Huber', price: 300 }),
        makeRow({ id: 2, first_name: 'Bruno', last_name: 'Bauer', price: 390 }),
      ],
    })
    const list = screen.getByRole('list', { name: 'Tandems in diesem Lauf' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Anna Huber')
    expect(items[0]).toHaveTextContent('300 €')
    expect(items[1]).toHaveTextContent('Bruno Bauer')
  })

  // A fully covered voucher moves no money, so the chosen method does not
  // reach it — the row says so where it stands.
  it('marks a tandem without anything left to pay', () => {
    renderDialog({
      rows: [
        makeRow({ id: 1, first_name: 'Anna', last_name: 'Huber', price: 0 }),
        makeRow({ id: 2, first_name: 'Bruno', last_name: 'Bauer', price: 100 }),
      ],
    })
    const [covered, owing] = screen.getAllByRole('listitem')
    expect(covered).toHaveTextContent('ohne Restbetrag')
    expect(owing).not.toHaveTextContent('ohne Restbetrag')
  })

  // The chosen method is written to every row that owes money, including one
  // that already names its till. That overwrite is deliberate, but it must be
  // visible before Kassieren is pressed, not discovered at closing.
  it('shows which recorded tills the chosen method overwrites', async () => {
    const user = userEvent.setup()
    renderDialog({
      rows: [
        makeRow({ id: 1, first_name: 'Anna', last_name: 'Huber', price: 370, payment_method: 'cash' }),
        makeRow({ id: 2, first_name: 'Bruno', last_name: 'Bauer', price: 270, payment_method: 'card' }),
        makeRow({ id: 3, first_name: 'Clara', last_name: 'Berg', price: 270 }),
      ],
    })
    expect(screen.queryByText(/geändert/)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'Karte')

    const [anna, bruno, clara] = screen.getAllByRole('listitem')
    expect(anna).toHaveTextContent('Bar → Karte')
    expect(bruno).not.toHaveTextContent('→')
    expect(clara).not.toHaveTextContent('→')
    expect(screen.getByText('1 Zahlungsart wird geändert.')).toBeInTheDocument()
  })

  // A voucher row's till is its top-up's; that is the field the run writes.
  it('reads a voucher row\'s till from its top-up', async () => {
    const user = userEvent.setup()
    renderDialog({
      rows: [
        makeRow({
          id: 1, first_name: 'Anna', last_name: 'Huber', price: 50,
          payment_method: 'voucher', voucher_payment_method: 'cash',
        }),
        makeRow({ id: 2, first_name: 'Bruno', last_name: 'Bauer', price: 270, payment_method: 'cash' }),
      ],
    })

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'Karte')

    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Bar → Karte')
    expect(screen.getByText('2 Zahlungsarten werden geändert.')).toBeInTheDocument()
  })

  it('sperrt Kassieren, bis eine Zahlungsart gewählt ist', async () => {
    const user = userEvent.setup()
    renderDialog()
    const confirmButton = screen.getByRole('button', { name: 'Kassieren' })
    expect(confirmButton).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'Karte')
    expect(confirmButton).toBeEnabled()
  })

  it('ruft onConfirm mit der gewählten Methode auf', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderDialog({ onConfirm })

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'Karte')
    await user.click(screen.getByRole('button', { name: 'Kassieren' }))

    expect(onConfirm).toHaveBeenCalledWith('card')
  })

  it('ruft onCancel bei Escape auf', () => {
    // jsdom has no real Escape handling for <dialog> — the browser-fired
    // 'cancel' event is simulated directly instead of pressing a key.
    const onCancel = vi.fn()
    const { container } = renderDialog({ onCancel })
    const dialog = container.querySelector('dialog')!
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('schluckt Escape während busy, statt onCancel aufzurufen', () => {
    // This is the guard that makes the sequential collect loop safe: while a
    // PATCH is in flight, tearing the dialog down would strand the loop with
    // no dialog left to show its error in. preventDefault() is what stops the
    // native <dialog> from closing itself on the cancel event regardless of
    // what the handler does.
    const onCancel = vi.fn()
    const { container } = renderDialog({ onCancel, busy: true })
    const dialog = container.querySelector('dialog')!
    const event = new Event('cancel', { cancelable: true })
    fireEvent(dialog, event)
    expect(onCancel).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('sperrt bei busy Auswahl und beide Buttons, und beschriftet Kassieren um', () => {
    renderDialog({ busy: true })
    expect(screen.getByLabelText('Zahlungsart')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Wird kassiert…' })).toBeDisabled()
  })

  it('zeigt einen Fehler an, ohne den Dialog zu sperren', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderDialog({ error: 'Speichern fehlgeschlagen', onConfirm })

    expect(screen.getByText('Speichern fehlgeschlagen')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'Karte')
    const confirmButton = screen.getByRole('button', { name: 'Kassieren' })
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledWith('card')
  })
})
