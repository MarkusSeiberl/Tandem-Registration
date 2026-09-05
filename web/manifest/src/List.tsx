import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dayManager, dayTables, exportDay, list, masters as fetchMasters, patch, pendingRedemptions,
  remove, repriceDay, saveDayManager,
} from './api'
import type { CollectedVia, DayTables, ManifestPatch, Registration } from './api'
import { useEvents } from './useEvents'
import { extraBookingLabel, paymentLabel, weightSurchargeLabel } from './labels'
import { collectedVia, formatEuro } from './pricing'
import { today } from './date'
import TrashIcon from './TrashIcon'
import CollectDialog from './CollectDialog'

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

const COLUMN_COUNT = 10

interface TableProps {
  caption: string
  rows: Registration[]
  emptyText: string
  masterNames: Map<number, string>
  checkedIds: Set<number>
  onToggleChecked: (id: number) => void
  onSelect: (registration: Registration) => void
  onSetPaid: (registration: Registration, paid: boolean) => void
  pendingId: number | null
  /** 'open' still owes money, 'paid' has been collected. */
  variant: 'open' | 'paid'
}

function RegistrationTable({
  caption, rows, emptyText, masterNames, checkedIds, onToggleChecked, onSelect, onSetPaid,
  pendingId, variant,
}: TableProps) {
  return (
    <table className={`manifest-table manifest-table-${variant}`}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th className="col-checkbox"></th>
          <th>Name</th>
          <th>Alter</th>
          <th>Gewicht (kg)</th>
          <th>Tandemmaster</th>
          <th>Load-Nr.</th>
          <th>Zusatzbuchung</th>
          <th>Zahlungsart</th>
          <th>Preis</th>
          <th className="col-action"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="clickable-row" onClick={() => onSelect(row)}>
            <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={checkedIds.has(row.id)}
                onChange={() => onToggleChecked(row.id)}
                aria-label={`${row.first_name} ${row.last_name} auswählen`}
              />
            </td>
            <td>
              {row.first_name} {row.last_name}
            </td>
            <td className="numeral">{row.age}</td>
            <td className="numeral">{row.weight_kg}</td>
            <td>{row.tandem_master_id != null ? masterNames.get(row.tandem_master_id) ?? '' : ''}</td>
            <td className="numeral">{row.load_number ?? ''}</td>
            <td>
              {/*
                Only the service actually flown — it already includes whatever
                the voucher covers, so showing the voucher service too would
                print "Sprung+Video" beside "Sprung+Video+Foto" for one jump.
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
              {variant === 'open' ? (
                <button
                  type="button"
                  className="btn small collect"
                  onClick={() => onSetPaid(row, true)}
                  disabled={pendingId === row.id}
                >
                  ✓ Kassiert
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => onSetPaid(row, false)}
                  disabled={pendingId === row.id}
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

/**
 * What one press of Tagesabschluss found wrong with the day. Counted at the moment
 * of the press and held, so the panel keeps saying what the operator was asked
 * about even if another tablet adds a row while it stands.
 */
interface ExportWarning {
  open: number
  openVoucher: number
  noPayment: number
  /**
   * Of `open`, how many are also in `noPayment` — a fresh registration has
   * neither a Zahlungsart nor a paid_at, so for most of the day these are the
   * same tandems. Kept separate so the two counts can be reconciled into one
   * honest sentence instead of reading as twice the problem.
   */
  noPaymentOpen: number
}

/** The panel's first line: what the day still has open, in words. */
function warningCounts(w: ExportWarning): string {
  const parts: string[] = []
  // Rows without a Zahlungsart that are not among the open ones — the ones an
  // "open" sentence cannot already be covering.
  const collectedNoPayment = w.noPayment - w.noPaymentOpen

  if (w.open > 0) {
    const openSubject = w.open === 1 ? '1 Tandem' : `${w.open} Tandems`
    const openVerb = w.open === 1 ? 'ist' : 'sind'
    const voucher = w.openVoucher === 0
      ? ''
      : w.openVoucher === 1
        ? ', davon 1 mit Gutschein'
        : `, davon ${w.openVoucher} mit Gutschein`

    if (w.noPaymentOpen === w.open) {
      // Every open tandem is also a no-Zahlungsart tandem — the ordinary
      // mid-day state. One sentence for one set of rows, or the reader counts
      // each of them twice. The voucher clause goes last: put right after
      // "kassiert", it reads as if "und haben" continues "davon N mit
      // Gutschein" rather than the open subject.
      const haveVerb = w.open === 1 ? 'hat' : 'haben'
      parts.push(`${openSubject} ${openVerb} noch nicht kassiert und ${haveVerb} noch keine Zahlungsart${voucher}.`)
    } else {
      parts.push(`${openSubject} ${openVerb} noch nicht kassiert${voucher}.`)
      if (w.noPaymentOpen > 0) {
        parts.push(w.noPaymentOpen === 1
          ? '1 davon hat auch keine Zahlungsart.'
          : `${w.noPaymentOpen} davon haben auch keine Zahlungsart.`)
      }
    }
  }

  if (collectedNoPayment > 0) {
    // Once an open sentence has already claimed a number, a bare "N Tandems"
    // here would read as yet another group — so it is named as what it is
    // once there is something else on the page to confuse it with.
    if (w.open > 0) {
      parts.push(collectedNoPayment === 1
        ? '1 bereits kassiertes Tandem hat außerdem keine Zahlungsart.'
        : `${collectedNoPayment} bereits kassierte Tandems haben außerdem keine Zahlungsart.`)
    } else {
      parts.push(collectedNoPayment === 1
        ? '1 Tandem hat keine Zahlungsart.'
        : `${collectedNoPayment} Tandems haben keine Zahlungsart.`)
    }
  }
  return parts.join(' ')
}

/**
 * Why those counts matter, in terms of the two files the export writes. The
 * "nachgetragen" promise only holds once a row is collected: collecting is
 * what stamps voucher_redeemed_at, and the export's redemption sweep only ever
 * picks up rows that carry it. An open row that stays open is not queued for
 * anything, however many exports run in the meantime.
 */
function warningExplanation(w: ExportWarning): string {
  const parts: string[] = []
  if (w.open > 0) {
    parts.push('Nur kassierte Tandems mit Gutschein werden in die Gutscheinliste ' +
      'eingetragen. Offene bleiben stehen; sobald sie kassiert sind, trägt sie der ' +
      'nächste Export nach.')
  }
  if (w.noPayment > 0) {
    parts.push('Tandems ohne Zahlungsart zählt der Export unter „Summe ohne Zahlungsart“.')
  }
  return parts.join(' ')
}

/**
 * The same counts as ExportWarning, taken from a plain row array instead of
 * component state — so a re-check that already has its own snapshot (a
 * bulk-collect loop's `freshRows`) can describe exactly that snapshot without
 * waiting for it to land back in `rows`.
 */
function computeExportWarning(source: Registration[]): ExportWarning {
  const open = source.filter((r) => r.paid_at == null)
  const noPayment = source.filter((r) => collectedVia(r) === null && (r.price ?? 0) > 0)
  return {
    open: open.length,
    openVoucher: open.filter((r) => r.payment_method === 'voucher').length,
    noPayment: noPayment.length,
    noPaymentOpen: noPayment.filter((r) => r.paid_at == null).length,
  }
}

export default function List({ onSelect, date, onDateChange }: ListProps) {
  const [rows, setRows] = useState<Registration[]>([])
  const [masterNames, setMasterNames] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  // Set by Tagesabschluss when the day is not ready to be written; null while there
  // is nothing to ask about.
  const [exportWarning, setExportWarning] = useState<ExportWarning | null>(null)
  const [collecting, setCollecting] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [collectOpen, setCollectOpen] = useState(false)
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
  // export warning goes the same way: its counts were taken on the day being
  // left, and standing over another day's list they would simply be wrong.
  useEffect(() => {
    setDay(null)
    setExportWarning(null)
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
  // from the banner without a reload.
  useEffect(() => {
    pendingRedemptions().then((r) => setPending(r.count)).catch(() => {})
  }, [rows])

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
  // A voucher row reaches the club's Gutscheinliste only once it is collected —
  // collecting is what stamps voucher_redeemed_at (see routes/registrations.ts),
  // and the export sweep writes exactly the rows that carry it. So an open one
  // misses the list without saying a word.
  const openVoucherRows = openRows.filter((r) => r.payment_method === 'voucher')
  // The predicate the export's "Summe ohne Zahlungsart" line uses, so the
  // warning and the sheet cannot disagree — collected rows included, because a
  // collected row without a method is exactly what that line flags. The price
  // guard is there because a fully covered voucher moves no money and needs no
  // method: it adds 0 € to that line, so counting it here would send the
  // operator hunting for a field that has to stay empty.
  const noPaymentRows = rows.filter((r) => collectedVia(r) === null && (r.price ?? 0) > 0)
  // The overlap between openRows and noPaymentRows — see ExportWarning.noPaymentOpen.
  const noPaymentOpenRows = noPaymentRows.filter((r) => r.paid_at == null)
  const sumOf = (items: Registration[]) => items.reduce((sum, r) => sum + (r.price ?? 0), 0)
  const paidVia = (via: 'cash' | 'card') =>
    sumOf(paidRows.filter((r) => collectedVia(r) === via))

  function toggleChecked(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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

  async function runExport() {
    setExportWarning(null)
    setExportMessage(null)
    // Clicking the button blurs the field, but the blur save is only started —
    // the sheet has to carry what stands in the field, not the name from before
    // the last keystroke. A failed save stops the export rather than writing a
    // sheet with the wrong Betriebsleiter on it.
    if (!(await saveManager())) return
    setExporting(true)
    try {
      const result = await exportDay(date)
      const parts = [`Export erstellt: ${result.path} (${result.count} Einträge)`]
      if (result.redemptionsWritten > 0) {
        // Same count, same wording as the banner two lines below — one of them
        // saying "1 Einlösungen" while the other says "1 Einlösung" reads as two
        // different numbers.
        parts.push(result.redemptionsWritten === 1
          ? '1 Einlösung eingetragen'
          : `${result.redemptionsWritten} Einlösungen eingetragen`)
      }
      if (result.redemptionsPending > 0) {
        parts.push(`${result.redemptionsPending} noch offen`)
      }
      if (result.redemptionsInvalid > 0) {
        parts.push(`${result.redemptionsInvalid} ungültig, nicht eingetragen`)
      }
      setExportMessage(parts.join(' · '))
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : 'Export fehlgeschlagen')
    } finally {
      setExporting(false)
    }
  }

  // Sequential, and each answer folded in with the functional setRows the row
  // button uses, so a refresh() landing mid-loop cannot be clobbered by the next
  // iteration. On a failure the dialog stays open with the message: the rows
  // already collected have left the open table, and `checkedIds` still holds, so
  // pressing Kassieren again runs over exactly what is left.
  async function handleCollectSelected(method: CollectedVia) {
    if (selectedOpenRows.length === 0) {
      // A `changed` echo can still land between confirm and here, or a retry can
      // be pressed after the failed run's rows already got picked up some other
      // way — either leaves nothing to patch. Falling through to the success
      // tail below with an empty loop would close the dialog as if it had just
      // finished collecting, which would be success reported for work that
      // never ran.
      return
    }
    setCollecting(true)
    setCollectError(null)
    try {
      for (const row of selectedOpenRows) {
        const fields: ManifestPatch = { paid: true }
        // The payment method is a statement about money that changed hands, so it
        // is only written where money is owed. A fully covered voucher moves none
        // and keeps whatever it already carries.
        if ((row.price ?? 0) > 0) {
          // payment_method says what the jump was paid with; for a voucher row
          // that is already answered, and only the top-up has a till.
          if (row.payment_method === 'voucher') fields.voucher_payment_method = method
          else fields.payment_method = method
        }
        const updated = await patch(row.id, fields)
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      }
    } catch (err) {
      setCollectError(err instanceof Error ? err.message : 'Kassieren fehlgeschlagen')
      return
    } finally {
      setCollecting(false)
    }
    setCollectOpen(false)
    // The rows have moved to the other table; staying checked would arm the
    // delete button on tandems that were just collected.
    setCheckedIds(new Set())
  }

  // Collects every still-open row through the row button's own PATCH, then
  // exports. Sequential on purpose: the rows are few, and a failure has to stop
  // the run rather than leave the rest in flight. Each patch is folded into
  // `rows` with the same functional setRows(prev => ...) handleSetPaid uses,
  // so a refresh() landing mid-loop cannot be clobbered by the next iteration.
  // `freshRows` stays a separate local snapshot for the re-check below (and for
  // the failure path) to read — a local snapshot cannot be raced by a late
  // refresh() the way reading back from `rows` could.
  async function handleCollectAllAndExport() {
    setCollecting(true)
    setError(null)
    setExportMessage(null)
    let freshRows = rows
    try {
      for (const row of openRows) {
        const updated = await patch(row.id, { paid: true })
        freshRows = freshRows.map((r) => (r.id === updated.id ? updated : r))
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      }
    } catch (err) {
      // A half-collected day must not reach the club's sheet — it would look
      // finished while some of the money is still shown as outstanding.
      // Reported through exportMessage rather than error: the rows collected
      // before the failure have already broadcast, and an SSE-triggered
      // refresh() clears error, which would erase this without a trace.
      setExportMessage(err instanceof Error ? err.message : 'Kassieren fehlgeschlagen')
      // The panel below is still open (it is what "Alle kassieren und
      // exportieren" hangs off) and must describe what the table now shows,
      // not the pre-collect count the operator originally pressed on.
      setExportWarning(computeExportWarning(freshRows))
      return
    } finally {
      setCollecting(false)
    }
    // The bulk PATCH only stamps paid_at, never a Zahlungsart — so the second
    // problem the panel warned about can still stand after "collect all". Ask
    // again rather than writing a sheet with the day's revenue parked under
    // "Summe ohne Zahlungsart".
    const afterCollect = computeExportWarning(freshRows)
    if (afterCollect.noPayment > 0) {
      setExportWarning(afterCollect)
      return
    }
    await runExport()
  }

  // Nothing is written until the operator has seen what the day is missing.
  // That includes the Betriebsleiter save inside runExport: a press that ends in
  // Abbrechen must leave the day exactly as it was.
  function handleExport() {
    if (openRows.length === 0 && noPaymentRows.length === 0) {
      void runExport()
      return
    }
    setExportMessage(null)
    setExportWarning({
      open: openRows.length,
      openVoucher: openVoucherRows.length,
      noPayment: noPaymentRows.length,
      noPaymentOpen: noPaymentOpenRows.length,
    })
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
      {pending > 0 && (
        <p className="hint warn">
          {pending === 1
            ? '1 Einlösung noch nicht in die Gutscheinliste geschrieben.'
            : `${pending} Einlösungen noch nicht in die Gutscheinliste geschrieben.`}
        </p>
      )}
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
        <button
          type="button"
          className="btn secondary"
          onClick={handleExport}
          disabled={collecting || exporting}
        >
          {exporting ? 'Tagesabschluss…' : 'Tagesabschluss'}
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => { setCollectError(null); setCollectOpen(true) }}
          disabled={selectedOpenRows.length === 0 || collecting || exporting || deleting}
        >
          Kassieren
        </button>
        <button
          type="button"
          className="btn secondary btn-icon"
          onClick={handleDelete}
          disabled={checkedIds.size === 0 || deleting}
          aria-label="Ausgewählte löschen"
          title="Ausgewählte löschen"
        >
          <TrashIcon />
        </button>
        <span className="list-count">
          {rows.length} {rows.length === 1 ? 'Eintrag' : 'Einträge'}
        </span>
        {/* What is still to be collected, and what already went into the till. */}
        <span className="list-total list-total-open">Offen: {formatEuro(sumOf(openRows))}</span>
        {/* The two tills stack rather than sitting side by side: at closing they
            are counted one after the other, and as a column the amounts line up
            under each other instead of drifting apart when the toolbar wraps. */}
        <div className="list-total-tills">
          <span className="list-total">Kassiert Bar: {formatEuro(paidVia('cash'))}</span>
          <span className="list-total">Kassiert Karte: {formatEuro(paidVia('card'))}</span>
        </div>
      </div>

      {exportWarning && (
        <div className="export-warning">
          <p>{warningCounts(exportWarning)}</p>
          <p>{warningExplanation(exportWarning)}</p>
          <div className="export-warning-actions">
            {/* Only when there is something to collect — a button that would do
                nothing promises an action the day does not have. */}
            {exportWarning.open > 0 && (
              <button
                type="button"
                className="btn small"
                onClick={() => { void handleCollectAllAndExport() }}
                disabled={collecting || exporting}
              >
                {collecting ? 'Wird kassiert…' : 'Alle kassieren und exportieren'}
              </button>
            )}
            <button
              type="button"
              className="btn secondary small"
              onClick={() => { void runExport() }}
              disabled={collecting || exporting}
            >
              Trotzdem exportieren
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => setExportWarning(null)}
              disabled={collecting || exporting}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {collectOpen && (
        <CollectDialog
          rows={selectedOpenRows}
          skippedCount={selectedPaidCount}
          busy={collecting}
          error={collectError}
          onConfirm={(method) => { void handleCollectSelected(method) }}
          onCancel={() => setCollectOpen(false)}
        />
      )}

      {exportMessage && <p className="hint">{exportMessage}</p>}
      {error && <p className="error">{error}</p>}
      {loading && rows.length === 0 && <p>Lädt…</p>}

      {rows.length === 0 && !loading ? (
        // Two empty tables for an empty day would be noise — one line says it.
        <p>Keine Registrierungen für dieses Datum.</p>
      ) : (
        <>
          <RegistrationTable
            caption={`Offen (${openRows.length})`}
            rows={openRows}
            emptyText="Keine offenen Einträge."
            masterNames={masterNames}
            checkedIds={checkedIds}
            onToggleChecked={toggleChecked}
            onSelect={onSelect}
            onSetPaid={handleSetPaid}
            pendingId={pendingId}
            variant="open"
          />
          <RegistrationTable
            caption={`Kassiert (${paidRows.length})`}
            rows={paidRows}
            emptyText="Noch nichts kassiert."
            masterNames={masterNames}
            checkedIds={checkedIds}
            onToggleChecked={toggleChecked}
            onSelect={onSelect}
            onSetPaid={handleSetPaid}
            pendingId={pendingId}
            variant="paid"
          />
        </>
      )}
    </div>
  )
}
