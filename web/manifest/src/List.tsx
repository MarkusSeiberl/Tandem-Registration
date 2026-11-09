import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dayManager, dayTables, list, masters as fetchMasters, patch, pendingRedemptions,
  remove, repriceDay, saveDayManager,
} from './api'
import type { CollectedVia, DayTables, ManifestPatch, Registration } from './api'
import { useEvents } from './useEvents'
import { extraBookingLabel, paymentLabel, weightSurchargeLabel } from './labels'
import { collectedVia, formatEuro } from './pricing'
import { today } from './date'
import { voucherWarningText } from './voucher'
import CollectDialog from './CollectDialog'
import DayCloseDialog from './dayClose/DayCloseDialog'
import SelectionBar from './SelectionBar'

export interface ListProps {
  onSelect: (registration: Registration) => void
  /** The day being shown. Owned by App so it survives leaving this screen. */
  date: string
  onDateChange: (date: string) => void
}

// Which colored dot a payment method's pill gets — voucher (ember, matches the
// Gutschein-Nr. field it implies) and cash (go-green) are called out; card
// gets the neutral default dot.
function paymentPillClass(method: Registration['payment_method']): string {
  if (method === 'voucher') return 'pill pill-voucher'
  if (method === 'cash') return 'pill pill-go'
  return 'pill'
}

const COLUMN_COUNT = 8

interface TableProps {
  caption: string
  /** A warning shown beside the caption; nothing when null. */
  captionNote?: string | null
  rows: Registration[]
  emptyText: string
  masterNames: Map<number, string>
  checkedIds: Set<number>
  onToggleChecked: (id: number) => void
  onSelect: (registration: Registration) => void
  /** Opens the collect dialog for this one row. Only the open table uses it. */
  onCollect: (registration: Registration) => void
  onSetPaid: (registration: Registration, paid: boolean) => void
  pendingId: number | null
  /** A bulk run is in flight — the row actions would race it. */
  busy: boolean
  /** 'open' still owes money, 'paid' has been collected. */
  variant: 'open' | 'paid'
}

function RegistrationTable({
  caption, captionNote, rows, emptyText, masterNames, checkedIds, onToggleChecked, onSelect,
  onCollect, onSetPaid, pendingId, busy, variant,
}: TableProps) {
  return (
    <table className={`manifest-table manifest-table-${variant}`}>
      <caption>
        {caption}
        {captionNote && <span className="caption-note warn">{captionNote}</span>}
      </caption>
      {/*
        Both tables size their columns from these, not from their own rows, so
        Offen and Kassiert line up column for column.
      */}
      <colgroup>
        <col className="col-checkbox" />
        <col className="col-load" />
        <col className="col-name" />
        <col />
        <col />
        <col />
        <col className="col-price" />
        <col className="col-action" />
      </colgroup>
      <thead>
        <tr>
          <th className="col-checkbox"></th>
          <th className="col-load">Load</th>
          <th>Name</th>
          <th>Tandemmaster</th>
          <th>Zusatzbuchung</th>
          <th>Zahlungsart</th>
          <th>Preis</th>
          <th className="col-action"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={row.voucher_check_status ? 'clickable-row voucher-flagged' : 'clickable-row'}
            onClick={() => onSelect(row)}
          >
            <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={checkedIds.has(row.id)}
                onChange={() => onToggleChecked(row.id)}
                aria-label={`${row.first_name} ${row.last_name} auswählen`}
              />
            </td>
            <td className="numeral col-load">{row.load_number ?? ''}</td>
            <td>
              {row.voucher_check_status && (
                <span
                  className="voucher-flag"
                  title={voucherWarningText(row.voucher_check_status, row.voucher_check_detail)}
                  aria-label={voucherWarningText(row.voucher_check_status, row.voucher_check_detail)}
                >
                  ⚠
                </span>
              )}
              <span>{row.first_name} {row.last_name}</span>{' '}
              <span>({row.age} J. - {row.weight_kg} kg)</span>
            </td>
            <td>{row.tandem_master_id != null ? masterNames.get(row.tandem_master_id) ?? '' : ''}</td>
            <td>
              {/*
                Only the service actually flown — it already includes whatever
                the voucher covers, so showing the voucher service too would
                print "Sprung+Video" beside "Video + Foto" for one jump.
                Which part was prepaid is a detail-screen question.
              */}
              {row.extra_booking && row.extra_booking !== 'none' && (
                <span className="pill pill-video">{extraBookingLabel(row.extra_booking)}</span>
              )}
              {row.weight_surcharge && row.weight_surcharge !== 'none' && (
                <span className="pill pill-surcharge">{weightSurchargeLabel(row.weight_surcharge)}</span>
              )}
            </td>
            <td>
              {row.payment_method && (
                <span className={paymentPillClass(row.payment_method)}>{paymentLabel(row.payment_method)}</span>
              )}
              {/*
                A voucher moves no money, so for counting the till at closing
                what matters is how the top-up was paid.
              */}
              {row.payment_method === 'voucher' && row.voucher_payment_method && (
                <span className={paymentPillClass(row.voucher_payment_method)}>
                  {paymentLabel(row.voucher_payment_method)}
                </span>
              )}
            </td>
            <td className="numeral">{row.price != null ? formatEuro(row.price) : ''}</td>
            {/*
              The row click opens the detail screen, so the action has to keep
              its click to itself.
            */}
            <td className="col-action" onClick={(e) => e.stopPropagation()}>
              {/*
                Named for what it does, not for the state it leads to: a row of
                "✓ Kassiert" in the open table read as tandems already paid.
                The guest's name tells one row's button from the next.
              */}
              {variant === 'open' ? (
                <button
                  type="button"
                  className="btn small collect"
                  onClick={() => onCollect(row)}
                  disabled={busy || pendingId === row.id}
                  aria-label={`${row.first_name} ${row.last_name} kassieren`}
                >
                  Kassieren
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => onSetPaid(row, false)}
                  disabled={busy || pendingId === row.id}
                  aria-label="Als offen markieren"
                  title="Als offen markieren"
                >
                  ↩
                </button>
              )}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={COLUMN_COUNT}>{emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

export default function List({ onSelect, date, onDateChange }: ListProps) {
  const [rows, setRows] = useState<Registration[]>([])
  const [masterNames, setMasterNames] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collecting, setCollecting] = useState(false)
  // The Tagesabschluss dialog stands over the list while this is true.
  const [closingOpen, setClosingOpen] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  // What the open dialog is about to collect: the checked rows ('selection'),
  // or the single row whose Kassieren button was pressed (its id). null while
  // the dialog is closed.
  const [collectTarget, setCollectTarget] = useState<'selection' | number | null>(null)
  const [collectError, setCollectError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [pending, setPending] = useState(0)
  // What this day runs on. The list is the screen that shows a day, so the day's
  // prices — and the one action that changes them — belong here.
  const [day, setDay] = useState<DayTables | null>(null)
  const [repricing, setRepricing] = useState(false)
  // Who was on duty as Betriebsleiter. A fact of the day, so it is loaded with
  // the day and written back against that date; the export reads it from there.
  const [manager, setManager] = useState('')
  // What the server has. Leaving the field untouched must not write anything —
  // an unchanged name would otherwise be re-saved on every visit to the screen.
  const savedManager = useRef('')

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    list(date)
      .then((items) => {
        setRows(items)
        // Rows change identity across a refresh (deletes, a new registration) —
        // any stale checked ids from before would silently keep the delete
        // button enabled for rows that no longer exist. But the server echoes
        // every PATCH back to the client that sent it (SseHub.broadcast has no
        // sender exclusion), so this refresh also runs mid-collect, on the
        // manifest's own write. Dropping the whole set there would empty a
        // bulk-collect loop's selection while it is still working, so only the
        // ids that no longer exist are dropped — a row that merely changed
        // table (open to paid) stays checked.
        setCheckedIds((prev) => {
          const alive = new Set(items.map((r) => r.id))
          const next = new Set<number>()
          for (const id of prev) if (alive.has(id)) next.add(id)
          return next
        })
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false))
  }, [date])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Cleared when the day changes so the banner cannot describe the day before;
  // refetched after every refresh so it reflects a reprice straight away. The
  useEffect(() => {
    setDay(null)
  }, [date])

  useEffect(() => {
    dayTables(date).then(setDay).catch(() => {})
  }, [date, rows])

  // The name belongs to the date, so switching days swaps it. `stale` guards
  // the slower answer of a day the operator has already clicked away from.
  useEffect(() => {
    let stale = false
    setManager('')
    savedManager.current = ''
    dayManager(date)
      .then((r) => {
        if (stale) return
        setManager(r.name)
        savedManager.current = r.name
      })
      .catch(() => {
        // Not being able to read the name must not take the list down with it —
        // the field simply stays empty and can be typed into.
      })
    return () => {
      stale = true
    }
  }, [date])

  useEffect(() => {
    fetchMasters()
      .then((items) => setMasterNames(new Map(items.map((m) => [m.id, m.name]))))
      .catch(() => {
        // Tandemmaster-Namen sind nur eine Anzeige-Ergänzung; ein Fehler hier
        // soll die Liste selbst nicht blockieren.
      })
  }, [])

  // Live refresh: re-fetch the current date whenever the server reports a change
  // (new guest registration, or an edit saved from another manifest client).
  useEvents(refresh)

  // Refreshed with the list, so a redemption written by the export disappears
  // from the note without a reload. Only the shown day counts — the note sits
  // beside that day's Kassiert table.
  useEffect(() => {
    let stale = false
    pendingRedemptions(date)
      .then((r) => { if (!stale) setPending(r.count) })
      .catch(() => { if (!stale) setPending(0) })
    return () => { stale = true }
  }, [rows, date])

  // Highest load number first — that's who boards next; unassigned (null)
  // registrations sort last.
  // The club edited a price after this day had started. Nothing is wrong — the
  // day is simply older than the price list — but it is worth saying so, because
  // otherwise the numbers here and the numbers in the settings disagree without
  // explanation.
  const dayOutdated =
    day !== null && day.frozen &&
    JSON.stringify(day.prices) !== JSON.stringify(day.current.prices)
  // Only the running day can still be moved. A day that is over has been flown,
  // collected and usually exported; those amounts are what guests paid, and a
  // price list edited afterwards does not get to rewrite them. So a past day
  // gets the explanation without the button.
  const isToday = date === today()

  async function handleReprice() {
    setRepricing(true)
    setError(null)
    try {
      await repriceDay(date)
      refresh()
      setDay(await dayTables(date))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preise übernehmen fehlgeschlagen')
    } finally {
      setRepricing(false)
    }
  }

  const sortedRows = [...rows].sort((a, b) => (b.load_number ?? -1) - (a.load_number ?? -1))
  // Payment happens after the jump, so the open table is the working list and
  // the collected one is the archive of the day.
  const openRows = sortedRows.filter((r) => r.paid_at == null)
  const paidRows = sortedRows.filter((r) => r.paid_at != null)
  // The bulk action works on the checked rows that are still open. Checked rows
  // in the collected table stay untouched — the dialog says so rather than
  // passing over them in silence.
  const selectedOpenRows = openRows.filter((r) => checkedIds.has(r.id))
  const selectedPaidCount = paidRows.filter((r) => checkedIds.has(r.id)).length
  // A row's own Kassieren is the same action on one row: same dialog, same
  // write rule, so a single tandem's Zahlungsart is asked for instead of
  // guessed. Read out of `openRows` rather than held as a snapshot, so a row
  // collected on another tablet while the dialog stands drops out of the run.
  const collectRows = collectTarget === 'selection'
    ? selectedOpenRows
    : openRows.filter((r) => r.id === collectTarget)
  const collectSkippedCount = collectTarget === 'selection' ? selectedPaidCount : 0
  const sumOf = (items: Registration[]) => items.reduce((sum, r) => sum + (r.price ?? 0), 0)
  const paidVia = (via: 'cash' | 'card') =>
    sumOf(paidRows.filter((r) => collectedVia(r) === via))
  const openSum = sumOf(openRows)
  const paidCash = paidVia('cash')
  const paidCard = paidVia('card')

  function toggleChecked(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Unticking a long selection box by box is work; the bar that acts on it
  // offers the way out of it.
  function handleClearSelection() {
    setCheckedIds(new Set())
  }

  async function handleSetPaid(row: Registration, paid: boolean) {
    setPendingId(row.id)
    setError(null)
    try {
      const updated = await patch(row.id, { paid })
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setPendingId(null)
    }
  }

  /**
   * One tandem settled from the Tagesabschluss dialog: an open row is
   * collected, a collected row without a till gets one. The till is written by
   * the same rule as runCollect(): only where money is owed, and for a voucher
   * row as the top-up's till. Throws, so the dialog can keep the row with its
   * message.
   */
  async function settleRow(row: Registration, method: CollectedVia | null): Promise<void> {
    const fields: ManifestPatch = {}
    if (row.paid_at == null) fields.paid = true
    if (method !== null && (row.price ?? 0) > 0) {
      if (row.payment_method === 'voucher') fields.voucher_payment_method = method
      else fields.payment_method = method
    }
    const updated = await patch(row.id, fields)
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
  }

  /**
   * Writes the field if it has been changed. Answers whether the day's name is
   * now safe on the server, so the export can refuse to write a sheet whose
   * Betriebsleiter line would be out of date.
   */
  async function saveManager(): Promise<boolean> {
    const name = manager.trim()
    if (name === savedManager.current) return true
    try {
      const saved = await saveDayManager(date, name)
      savedManager.current = saved.name
      setManager(saved.name)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Betriebsleiter speichern fehlgeschlagen')
      return false
    }
  }

  // Sequential, and each answer folded in with the functional setRows the row
  // button uses, so a refresh() landing mid-loop cannot be clobbered by the next
  // iteration. Answers with the failure message rather than showing it itself:
  // only the caller knows whether there is a dialog to put it in. On a failure
  // the rows already collected have left the open table and `checkedIds` still
  // holds, so pressing Kassieren again runs over exactly what is left.
  //
  // `method` is null when nothing in the run is owed — see startCollect().
  async function runCollect(
    method: CollectedVia | null,
    rowsToCollect: Registration[],
  ): Promise<string | null> {
    setCollecting(true)
    try {
      for (const row of rowsToCollect) {
        const fields: ManifestPatch = { paid: true }
        // The payment method is a statement about money that changed hands, so it
        // is only written where money is owed. A fully covered voucher moves none
        // and keeps whatever it already carries.
        if (method !== null && (row.price ?? 0) > 0) {
          // payment_method says what the jump was paid with; for a voucher row
          // that is already answered, and only the top-up has a till.
          if (row.payment_method === 'voucher') fields.voucher_payment_method = method
          else fields.payment_method = method
        }
        const updated = await patch(row.id, fields)
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      }
    } catch (err) {
      return err instanceof Error ? err.message : 'Kassieren fehlgeschlagen'
    } finally {
      setCollecting(false)
    }
    return null
  }

  // The rows have moved to the other table; staying checked would arm the
  // delete button on tandems that were just collected. A single row's button
  // says nothing about the rest of the selection, so only that row leaves it.
  function clearCollected(target: 'selection' | number) {
    if (target === 'selection') setCheckedIds(new Set())
    else setCheckedIds((prev) => {
      if (!prev.has(target)) return prev
      const next = new Set(prev)
      next.delete(target)
      return next
    })
  }

  // Both Kassieren buttons come through here. The dialog exists to ask one
  // question — which till the money went into — so a run where no row owes
  // anything has nothing to ask and skips it: the operator would otherwise have
  // to name a Zahlungsart that runCollect() then refuses to write, which reads
  // as if the fully covered voucher still wanted paying. A single row that
  // already names its till (cash/card, or a voucher top-up's method) has the
  // question answered too, and keeps what it says. The bulk run still asks:
  // there the chosen method deliberately overwrites the whole selection.
  function startCollect(target: 'selection' | number) {
    setCollectError(null)
    const targetRows = target === 'selection'
      ? selectedOpenRows
      : openRows.filter((r) => r.id === target)
    const answered = (r: Registration) =>
      (r.price ?? 0) <= 0 || (target !== 'selection' && collectedVia(r) !== null)
    if (targetRows.length > 0 && targetRows.every(answered)) {
      void collectSilently(target, targetRows)
      return
    }
    setCollectTarget(target)
  }

  // No dialog stands over this run, so its failure goes to the page's own error
  // line instead of the dialog's.
  async function collectSilently(target: 'selection' | number, targetRows: Registration[]) {
    setError(null)
    const message = await runCollect(null, targetRows)
    if (message !== null) {
      setError(message)
      return
    }
    clearCollected(target)
  }

  async function handleCollectSelected(method: CollectedVia) {
    const target = collectTarget
    if (target === null || collectRows.length === 0) {
      // A `changed` echo can still land between confirm and here, or a retry can
      // be pressed after the failed run's rows already got picked up some other
      // way — either leaves nothing to patch. Falling through to the success
      // tail below with an empty loop would close the dialog as if it had just
      // finished collecting, which would be success reported for work that
      // never ran.
      return
    }
    setCollectError(null)
    const message = await runCollect(method, collectRows)
    if (message !== null) {
      // The dialog stays open and carries the message.
      setCollectError(message)
      return
    }
    setCollectTarget(null)
    clearCollected(target)
  }

  async function handleDelete() {
    if (checkedIds.size === 0) return
    const confirmed = window.confirm(
      checkedIds.size === 1
        ? '1 Registrierung löschen?'
        : `${checkedIds.size} Registrierungen löschen?`
    )
    if (!confirmed) return
    setDeleting(true)
    setError(null)
    try {
      for (const id of checkedIds) {
        await remove(id)
      }
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="list-screen">
      {dayOutdated && (isToday ? (
        <div className="day-outdated">
          <p>
            Dieser Tag läuft auf der Preisliste von seinem Beginn
            ({formatEuro(day!.prices.jump)} pro Sprung, aktuell{' '}
            {formatEuro(day!.current.prices.jump)}). Die Beträge bleiben so, bis jemand es
            ausdrücklich ändert.
          </p>
          <button
            type="button"
            className="btn secondary small"
            onClick={handleReprice}
            disabled={repricing}
          >
            {repricing ? 'Wird übernommen…' : 'Preise für diesen Tag aktualisieren'}
          </button>
        </div>
      ) : (
        <div className="day-outdated day-settled">
          <p>
            Dieser Tag wurde mit der Preisliste von seinem Beginn abgerechnet
            ({formatEuro(day!.prices.jump)} pro Sprung, aktuell{' '}
            {formatEuro(day!.current.prices.jump)}). Abgeschlossene Tage bleiben, wie sie
            geflogen wurden.
          </p>
        </div>
      ))}

      <div className="list-toolbar">
        <label className="date-field">
          Datum
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </label>
        {/* One press back to the running day, from wherever the operator
            wandered off to. Off while it would change nothing. */}
        <button
          type="button"
          className="btn secondary small"
          onClick={() => onDateChange(today())}
          disabled={date === today()}
        >
          Heute
        </button>
        {/* Beside the date, because it is the same kind of fact: what this day
            was. The export writes it into the Betriebsleiter (BL) line. */}
        <label className="manager-field">
          Betriebsleiter
          <input
            type="text"
            value={manager}
            onChange={(e) => setManager(e.target.value)}
            onBlur={() => { void saveManager() }}
          />
        </label>
        {/* Filled, unlike the other day controls: it is the one step the day
            must not end without, and as a grey outline it was easy to forget. */}
        <button
          type="button"
          className="btn primary"
          onClick={() => setClosingOpen(true)}
          disabled={collecting}
        >
          Tagesabschluss
        </button>
        {/* Kassieren and the delete action used to stand here. They act on the
            checked rows, not on the day, and in a row of identical grey buttons
            only their disabled state said so — they live in SelectionBar now. */}
        {/* The day's money in one place. Offen leads: it is what the desk works
            down all day and what has to reach zero before closing. The tills
            stack beside it with their sum, in the order they are counted, so the
            amounts line up under each other for the cash box and the terminal.
            The row count lives in each table's caption, so it is not repeated. */}
        <div className={openSum === 0 && rows.length > 0 ? 'day-totals settled' : 'day-totals'}>
          <dl className="day-total-open">
            <dt>Offen</dt>
            <dd className="numeral">{formatEuro(openSum)}</dd>
          </dl>
          <dl className="day-total-tills">
            <dt>Bar</dt>
            <dd className="numeral">{formatEuro(paidCash)}</dd>
            <dt>Karte</dt>
            <dd className="numeral">{formatEuro(paidCard)}</dd>
            <dt className="day-total-sum">Kassiert</dt>
            <dd className="numeral day-total-sum">{formatEuro(paidCash + paidCard)}</dd>
          </dl>
        </div>
      </div>

      {collectTarget !== null && (
        <CollectDialog
          rows={collectRows}
          skippedCount={collectSkippedCount}
          busy={collecting}
          error={collectError}
          onConfirm={(method) => { void handleCollectSelected(method) }}
          onCancel={() => setCollectTarget(null)}
        />
      )}

      {closingOpen && (
        <DayCloseDialog
          date={date}
          rows={rows}
          masterNames={masterNames}
          manager={manager}
          onManagerChange={setManager}
          saveManager={saveManager}
          settleRow={settleRow}
          onClose={() => { setClosingOpen(false); refresh() }}
        />
      )}

      {error && <p className="error">{error}</p>}
      {loading && rows.length === 0 && <p>Lädt…</p>}

      {rows.length === 0 && !loading ? (
        // Two empty tables for an empty day would be noise — one line says it.
        <p>Keine Registrierungen für dieses Datum.</p>
      ) : (
        <>
          {/* Directly above the rows it acts on, and sticky from here to the end
              of the screen so it stays reachable in the collected table too. */}
          <SelectionBar
            selectedCount={checkedIds.size}
            openCount={selectedOpenRows.length}
            busy={collecting || deleting}
            onCollect={() => startCollect('selection')}
            onDelete={() => { void handleDelete() }}
            onClear={handleClearSelection}
          />
          <RegistrationTable
            caption={`Offen (${openRows.length})`}
            rows={openRows}
            emptyText="Keine offenen Einträge."
            masterNames={masterNames}
            checkedIds={checkedIds}
            onToggleChecked={toggleChecked}
            onSelect={onSelect}
            onCollect={(row) => startCollect(row.id)}
            onSetPaid={handleSetPaid}
            pendingId={pendingId}
            busy={collecting || deleting}
            variant="open"
          />
          <RegistrationTable
            caption={`Kassiert (${paidRows.length})`}
            captionNote={pending === 0 ? null : pending === 1
              ? '1 Gutschein noch nicht in die Gutscheinliste eingetragen'
              : `${pending} Gutscheine noch nicht in die Gutscheinliste eingetragen`}
            rows={paidRows}
            emptyText="Noch nichts kassiert."
            masterNames={masterNames}
            checkedIds={checkedIds}
            onToggleChecked={toggleChecked}
            onSelect={onSelect}
            onCollect={(row) => startCollect(row.id)}
            onSetPaid={handleSetPaid}
            pendingId={pendingId}
            busy={collecting || deleting}
            variant="paid"
          />
        </>
      )}
    </div>
  )
}
