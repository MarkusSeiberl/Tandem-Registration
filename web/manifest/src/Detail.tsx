import { useEffect, useId, useState } from 'react'
import {
  checkVoucher, dayTables, patch, remove, flyers as fetchFlyers, masters as fetchMasters,
  contractPdfUrl, urkundePdfUrl,
} from './api'
import type {
  CollectedVia, DayTables, ExtraBooking, ManifestPatch, PaymentMethod, Prices, Registration,
  StammdatenItem, VoucherCheck, VoucherService, WeightSurcharge,
} from './api'
import {
  COLLECTED_VIA, EXTRA_BOOKINGS, PAYMENT_METHODS, VOUCHER_SERVICES, WEIGHT_SURCHARGES,
  genderLabel,
} from './labels'
import {
  REJECTED_VOUCHER_STATUSES, atLeast, collectedVia, formatEuro, priceLines, serviceOfVoucher,
  surchargeForWeight, voucherCovered, voucherValue,
} from './pricing'
import { formatDate, voucherAmountText, voucherServiceText, voucherStatusText } from './voucher'
import { today } from './date'
import CollectDialog from './CollectDialog'
import TrashIcon from './TrashIcon'

export interface DetailProps {
  registration: Registration
  onBack: () => void
  onSaved: (updated: Registration) => void
  // Told whenever unsaved edits appear or go, so the app can ask before Zurück
  // or a tab switch throws them away.
  onDirtyChange?: (dirty: boolean) => void
}

const tillLabel = (via: CollectedVia | null) =>
  COLLECTED_VIA.find((m) => m.value === via)?.label ?? 'keine Kassa'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
}

export default function Detail({ registration, onBack, onSaved, onDirtyChange }: DetailProps) {
  const [masterList, setMasterList] = useState<StammdatenItem[]>([])
  const [flyerList, setFlyerList] = useState<StammdatenItem[]>([])

  // The price list of the day this jump belongs to, frozen by that day's first
  // registration. Every amount on this screen comes from it — which is what
  // keeps the total here equal to the one in the list behind it and in the
  // export. The settings table only decides what the NEXT day starts from.
  const [day, setDay] = useState<DayTables | null>(null)
  const prices: Prices | null = day?.prices ?? null
  // A failed load used to leave "Preise werden geladen…" on screen for good and
  // the crew selects silently empty. Each failure is said where it bites, with
  // a way to try again.
  const [pricesFailed, setPricesFailed] = useState(false)
  const [crewFailed, setCrewFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [tandemMasterId, setTandemMasterId] = useState<number | ''>(registration.tandem_master_id ?? '')
  const [loadNumber, setLoadNumber] = useState<number | ''>(registration.load_number ?? '')
  const [price, setPrice] = useState<number | ''>(registration.price ?? '')
  const [priceOverride, setPriceOverride] = useState<boolean>(!!registration.price_override)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(registration.payment_method ?? '')
  const [voucherPaymentMethod, setVoucherPaymentMethod] =
    useState<CollectedVia | ''>(registration.voucher_payment_method ?? '')
  const [voucherNumber, setVoucherNumber] = useState<string>(registration.voucher_number ?? '')
  const [voucherService, setVoucherService] = useState<VoucherService | ''>(registration.voucher_service ?? '')
  const [voucherCheck, setVoucherCheck] = useState<VoucherCheck | null>(null)
  // What the club's list says this voucher was paid for, and whether the guest
  // pays the rise since then. The amount is kept in state rather than read off
  // the check on every render: the check is dropped while the operator is still
  // typing, and the amount a saved row was priced with must not go with it.
  const [voucherAmount, setVoucherAmount] =
    useState<number | null>(registration.voucher_amount ?? null)
  const [voucherTopup, setVoucherTopup] = useState<boolean>(!!registration.voucher_topup)
  // The operator honours a voucher the club's list rejects.
  const [voucherAccepted, setVoucherAccepted] = useState<boolean>(!!registration.voucher_accepted)
  const [extraBooking, setExtraBooking] = useState<ExtraBooking>(registration.extra_booking ?? 'none')
  const [weightSurcharge, setWeightSurcharge] =
    useState<WeightSurcharge>(registration.weight_surcharge ?? 'none')
  const [cameraFlyerId, setCameraFlyerId] = useState<number | ''>(registration.camera_flyer_id ?? '')
  const [notes, setNotes] = useState<string>(registration.notes ?? '')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Set by the operator's own edits and cleared by a save. Values the screen
  // fills in by itself — the voucher amount from the club's list — do not
  // count: nobody should be asked to discard something they never typed.
  const [dirty, setDirty] = useState(false)
  const [collectOpen, setCollectOpen] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collectError, setCollectError] = useState<string | null>(null)

  const ids = {
    voucherNumber: useId(),
    voucherChecks: useId(),
    cameraFlyer: useId(),
    cameraFlyerHint: useId(),
  }

  // Wraps a setter so the change counts as an edit: it arms the question before
  // leaving, and "Gespeichert." stops claiming something it no longer covers.
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value)
      setDirty(true)
      setSaved(false)
    }
  }

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  // Leaving the screen leaves nothing unsaved behind it.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  useEffect(() => {
    let cancelled = false
    setPricesFailed(false)
    setCrewFailed(false)
    const onCrewFailed = () => { if (!cancelled) setCrewFailed(true) }
    fetchMasters().then((list) => { if (!cancelled) setMasterList(list) }).catch(onCrewFailed)
    fetchFlyers().then((list) => { if (!cancelled) setFlyerList(list) }).catch(onCrewFailed)
    dayTables(registration.jump_date)
      .then((tables) => { if (!cancelled) setDay(tables) })
      .catch(() => { if (!cancelled) setPricesFailed(true) })
    return () => { cancelled = true }
  }, [registration.jump_date, loadAttempt])

  // A voucher number and the covered service only exist when the guest actually
  // paid with one.
  const showVoucherNumber = paymentMethod === 'voucher'

  // Checked shortly after typing stops, not per keystroke: the club's list may
  // live in OneDrive. The server caches it against the file's mtime, so a repeat
  // check of the same number costs nothing.
  useEffect(() => {
    const number = voucherNumber.trim()
    if (!showVoucherNumber || number.length === 0) {
      setVoucherCheck(null)
      setVoucherAmount(null)
      return
    }
    // The previous number's answer is about the previous number. Left on screen
    // for the debounce window it would state what the club's list says about a
    // voucher that is no longer in the field — a sentence about money that is
    // wrong for what the operator is looking at.
    setVoucherCheck(null)
    let cancelled = false
    const timer = setTimeout(() => {
      checkVoucher(number)
        .then((result) => {
          if (cancelled) return
          setVoucherCheck(result)
          setVoucherAmount(result.amount)
        })
        .catch(() => { if (!cancelled) setVoucherCheck(null) })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [voucherNumber, showVoucherNumber])

  const paid = registration.paid_at != null
  const numberAsSaved = voucherNumber.trim() === (registration.voucher_number ?? '')
  // The verdict this row is priced with, the same one the server prices it
  // with. A collected row — and one whose redemption already reached the club's
  // file — keeps the verdict it was collected under: a live check would call
  // the voucher redeemed by this very row. Otherwise the live check wins once
  // it is back, and until then the verdict stored with the number stands.
  const verdict: string | null = !showVoucherNumber
    ? null
    : numberAsSaved && (paid || registration.voucher_redeem_synced_at)
      ? registration.voucher_check_status
      : voucherCheck && !voucherCheck.configured
        ? null
        : voucherCheck?.readable
          ? (voucherCheck.status === 'ok' ? null : voucherCheck.status)
          : numberAsSaved ? registration.voucher_check_status : null
  const voucherRejectedByList =
    (REJECTED_VOUCHER_STATUSES as readonly string[]).includes(verdict ?? '')

  const voucherLine = voucherCheck ? voucherStatusText(voucherCheck) : null
  const voucherArtLine = voucherCheck ? voucherServiceText(voucherCheck, voucherService) : null
  // What our two stamps say about this row's redemption. A row can be put back
  // to open while its date already stands in the club's file — the file keeps
  // that date, so the screen has to say so, or the operator sees an open row
  // and a list that quietly disagrees with it. A statement, never a warning:
  // there is nothing here for anyone to fix.
  const redemptionLine = registration.voucher_redeem_synced_at
    ? `Einlösung am ${formatDate(registration.voucher_redeem_synced_at)} in die ` +
      'Gutscheinliste eingetragen. Das Datum bleibt dort stehen.'
    : registration.voucher_redeemed_at
      ? 'Einlösung vermerkt, aber noch nicht in die Gutscheinliste geschrieben.'
      : null
  // Kameraflieger is needed whenever video is filmed — that includes a guest
  // whose voucher already covers the video, who books nothing on top.
  const voucherCoversVideo = showVoucherNumber &&
    (voucherService === 'jump_video' || voucherService === 'jump_video_photo')
  const showCameraFlyer =
    extraBooking === 'video' || extraBooking === 'video_photo' || voucherCoversVideo
  // Booked video with nobody to film it is a flyer missing on the load. Said,
  // not enforced: the flyer is often settled at the plane, after the row.
  const cameraFlyerMissing = showCameraFlyer && cameraFlyerId === ''

  // One description of this row's money, used for the breakdown and for the
  // voucher difference alike, so the two can never disagree about what the
  // voucher covers.
  const pricedFields = {
    payment_method: paymentMethod,
    voucher_service: showVoucherNumber ? voucherService : null,
    extra_booking: extraBooking,
    weight_surcharge: weightSurcharge,
    voucher_topup: showVoucherNumber && voucherTopup,
    voucher_amount: voucherAmount,
    voucher_check_status: verdict,
    voucher_accepted: showVoucherNumber && voucherAccepted,
  }
  const lines = prices ? priceLines(pricedFields, prices) : []
  const computed = lines.reduce((sum, l) => sum + l.amount, 0)
  // Worth saying out loud, once: the club edited a price after this jump day had
  // started, so these amounts are no longer the list amounts. Changing that is a
  // decision about the whole day, so the button for it lives in the manifest.
  const dayOutdated =
    day !== null && day.frozen &&
    JSON.stringify(day.prices) !== JSON.stringify(day.current.prices)
  // Only the running day can still be moved onto the current list, so only for
  // that one does it make sense to point at the button in the manifest.
  const dayIsToday = registration.jump_date === today()
  const due = priceOverride && price !== '' ? price : computed
  // The voucher was bought at an older price and is honoured at today's. That
  // gap is the club's to give away or to charge, so it is stated once, beside
  // the total it changes, with the decision as a box to tick. Only a gap in the
  // club's favour exists: a voucher bought above today's price is not refunded,
  // and `voucherTopup` never returns a negative amount.
  //
  // Shown only once the check has come back, so the sentence is never about a
  // number nobody has looked up.
  const covered = prices ? voucherCovered(pricedFields, prices) : 0
  const voucherDifference =
    voucherCheck?.amount != null && prices ? covered - voucherCheck.amount : 0
  const showVoucherDifference = showVoucherNumber && voucherDifference > 0
  // The "damals · heute" line says the same thing as the difference block, so
  // it only stands on its own when there is no difference to decide about.
  const voucherAmountLine =
    voucherCheck && prices && !showVoucherDifference
      ? voucherAmountText(
          voucherCheck,
          voucherCheck.service ? voucherValue(voucherCheck.service, prices) : null,
          formatEuro
        )
      : null
  // A voucher moves no money by itself, so the till it lands in is only a
  // question once the guest actually owes something on top of it. The field
  // stays in place either way and says which of the two it is.
  const showVoucherPayment = showVoucherNumber && due > 0
  // Money is owed and nobody recorded where it went: that till will not add up at
  // closing. Worth a warning, not worth blocking a half-finished row from saving.
  const tillMissing = showVoucherPayment && voucherPaymentMethod === ''

  // Which till the money is in now, and which it would be in after a save.
  const tillThen = collectedVia(registration)
  const tillNow = collectedVia({
    payment_method: paymentMethod || null,
    voucher_payment_method: showVoucherPayment ? voucherPaymentMethod || null : null,
  })
  // A collected row is money already counted. Editing it is allowed — mistakes
  // happen — but the change to the till is said before it is saved.
  const paidChanges = paid && dirty && prices
    ? [
        due !== (registration.price ?? 0) &&
          `${formatEuro(registration.price ?? 0)} → ${formatEuro(due)}`,
        tillNow !== tillThen && `${tillLabel(tillThen)} → ${tillLabel(tillNow)}`,
      ].filter((part): part is string => !!part)
    : []
  const paidState = paid
    ? `Kassiert ${formatTime(registration.paid_at!)} · ${
        tillThen ? tillLabel(tillThen) : registration.payment_method === 'voucher' ? 'Gutschein' : 'ohne Kassa'
      }`
    : 'Offen'

  // The surcharge is derived from the weight once, when the guest registers. From
  // then on the operator owns it — waiving it is a legitimate exception. So this
  // only reports the disagreement instead of correcting it.
  const surchargeFromWeight = surchargeForWeight(registration.weight_kg)
  const surchargeDeviates = weightSurcharge !== surchargeFromWeight

  // Everything this screen edits, as the PATCH that stores it. Shared by
  // Speichern and Kassieren, so collecting from here also saves what is on
  // screen instead of collecting the row as it was.
  function changes(): ManifestPatch {
    return {
      tandem_master_id: tandemMasterId === '' ? null : tandemMasterId,
      load_number: loadNumber === '' ? null : loadNumber,
      // Without an override the price is left to the server, which derives it
      // from the price table — sending our preview back would let two manifest
      // clients with stale settings disagree.
      ...(priceOverride
        ? { price: price === '' ? null : price }
        : { price_override: 0 as const }),
      payment_method: paymentMethod === '' ? undefined : paymentMethod,
      // Clear a stale voucher number if the guest no longer pays by voucher.
      voucher_number: showVoucherNumber ? (voucherNumber.trim() === '' ? null : voucherNumber.trim()) : null,
      voucher_service: showVoucherNumber ? (voucherService === '' ? null : voucherService) : null,
      // The amount travels with the flag so the server can price this row
      // again — on a save, on a reprice — without reaching for the club's
      // Excel file, which may be locked, edited or gone by then.
      voucher_topup: showVoucherNumber && voucherTopup ? 1 : 0,
      voucher_amount: showVoucherNumber ? voucherAmount : null,
      voucher_accepted: showVoucherNumber && voucherAccepted ? 1 : 0,
      // Likewise drop the till once there is nothing left to collect.
      voucher_payment_method: showVoucherPayment
        ? (voucherPaymentMethod === '' ? null : voucherPaymentMethod)
        : null,
      extra_booking: extraBooking,
      weight_surcharge: weightSurcharge,
      // Clear a stale flyer selection if the booking no longer includes video.
      camera_flyer_id: showCameraFlyer ? (cameraFlyerId === '' ? null : cameraFlyerId) : null,
      notes: notes.trim() === '' ? null : notes.trim(),
    }
  }

  // The server owns the stored values; adopt them so the fields cannot drift
  // from the sheet.
  function adopt(updated: Registration) {
    setPrice(updated.price ?? '')
    setPriceOverride(!!updated.price_override)
    setVoucherTopup(!!updated.voucher_topup)
    setVoucherAccepted(!!updated.voucher_accepted)
    // The server trims the note and turns an empty one into nothing.
    setNotes(updated.notes ?? '')
    setDirty(false)
    onSaved(updated)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      adopt(await patch(registration.id, changes()))
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  // `method` is the till the dialog asked for, or null when the screen already
  // knows it — or nothing is owed. Same rule as the list's row button: the
  // method is only written where money changes hands.
  async function collect(method: CollectedVia | null) {
    setCollecting(true)
    setError(null)
    setCollectError(null)
    setSaved(false)
    try {
      const fields: ManifestPatch = { ...changes(), paid: true }
      if (method !== null && due > 0) {
        if (paymentMethod === 'voucher') fields.voucher_payment_method = method
        else fields.payment_method = method
      }
      adopt(await patch(registration.id, fields))
      setCollectOpen(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kassieren fehlgeschlagen'
      // With the dialog open the message belongs in it; without one, beside
      // the buttons like every other failure on this screen.
      if (collectOpen) setCollectError(message)
      else setError(message)
    } finally {
      setCollecting(false)
    }
  }

  // The dialog only asks which till the money went into. Nothing owed, or a
  // till already chosen on this screen, leaves nothing to ask.
  function startCollect() {
    if (due <= 0 || tillNow !== null) {
      void collect(null)
      return
    }
    setCollectError(null)
    setCollectOpen(true)
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `Registrierung von ${registration.first_name} ${registration.last_name} löschen?`
    )
    if (!confirmed) return
    setDeleting(true)
    setError(null)
    try {
      await remove(registration.id)
      // The row is gone, and with it anything unsaved about it — leaving must
      // not ask about edits to a registration that no longer exists.
      setDirty(false)
      onDirtyChange?.(false)
      // The list re-fetches on the server's "changed" event, so going back is all
      // that is left to do here.
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen')
    } finally {
      setDeleting(false)
    }
  }

  const retry = () => setLoadAttempt((n) => n + 1)

  return (
    <div className="detail-screen">
      <button type="button" className="btn secondary detail-back" onClick={onBack}>
        ← Zurück
      </button>

      {/*
        The guest arrives from the kiosk and is never edited here, so all nine
        facts read as one load-sheet line across the top instead of as a column
        of their own. Weight is set apart because it is the one guest fact that
        costs money: it sets the Gewichtszuschlag further down the screen.
      */}
      <section className="guest-strip" aria-label="Gastdaten">
        <h2 className="guest-name">
          {registration.first_name} {registration.last_name}
        </h2>

        <dl className="guest-facts">
          <div className="fact">
            <dt>Geschlecht</dt>
            <dd>{genderLabel(registration.gender)}</dd>
          </div>
          <div className="fact">
            <dt>Alter</dt>
            <dd className="numeral">{registration.age}</dd>
          </div>
          <div className="fact">
            <dt>Größe</dt>
            <dd className="numeral">
              {registration.height_cm != null ? `${registration.height_cm} cm` : ''}
            </dd>
          </div>
          <div className="fact fact-weight">
            <dt>Gewicht</dt>
            <dd className="numeral">{registration.weight_kg} kg</dd>
          </div>
          <div className="fact">
            <dt>Sprungdatum</dt>
            <dd className="numeral">{formatDate(registration.jump_date)}</dd>
          </div>
        </dl>

        <dl className="guest-contact">
          <div className="fact">
            <dt>Adresse</dt>
            <dd>
              {registration.street}, {registration.postal_code} {registration.city}
            </dd>
          </div>
          <div className="fact">
            <dt>E-Mail</dt>
            <dd>{registration.email}</dd>
          </div>
          <div className="fact">
            <dt>Telefon</dt>
            <dd>{registration.phone}</dd>
          </div>
        </dl>
      </section>

      <div className="detail-cols">
        <section className="panel" aria-label="Zuteilung">
          <h3 className="panel-title">Zuteilung</h3>

          {crewFailed && (
            <div className="load-failed">
              <p className="error">Tandemmaster und Kameraflieger konnten nicht geladen werden.</p>
              <button type="button" className="btn secondary" onClick={retry}>
                Erneut versuchen
              </button>
            </div>
          )}

          <label className="field">
            Tandemmaster
            <select
              value={tandemMasterId}
              onChange={(e) => edited(setTandemMasterId)(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">— auswählen —</option>
              {masterList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Load-Nr.
            <input
              type="number"
              className="numeral"
              min={0}
              value={loadNumber}
              onChange={(e) => edited(setLoadNumber)(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </label>

          <label className="field">
            Zahlungsart
            <select
              value={paymentMethod}
              onChange={(e) => edited(setPaymentMethod)(e.target.value as PaymentMethod | '')}
            >
              <option value="">— auswählen —</option>
              {PAYMENT_METHODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {/*
            What the voucher is: its number, the club list's verdict on it, and
            what it covers. What it does to the bill — the difference, the till,
            honouring a rejected one — is decided in the Kassa, beside the total
            it changes.
          */}
          {showVoucherNumber && (
            <fieldset className="voucher-group">
              <legend>Gutschein</legend>

              {/*
                The verdict lines sit outside the label and are tied to the input
                by aria-describedby: inside it they became part of the field's
                name, read out in full on every focus and changing under the
                cursor while the check came back.
              */}
              <div className="field">
                <label htmlFor={ids.voucherNumber}>Gutschein-Nr.</label>
                <input
                  id={ids.voucherNumber}
                  type="text"
                  value={voucherNumber}
                  aria-describedby={ids.voucherChecks}
                  onChange={(e) => {
                    edited(setVoucherNumber)(e.target.value)
                    // Honouring a rejected voucher is a decision about that
                    // voucher, not about whatever number is typed next.
                    setVoucherAccepted(false)
                  }}
                />
                <div id={ids.voucherChecks} className="voucher-checks" aria-live="polite">
                  {voucherLine && (
                    <p className={`field-hint voucher-check ${voucherLine.tone}`}>
                      {voucherLine.text}
                    </p>
                  )}
                  {voucherArtLine && (
                    <p className={`field-hint voucher-check ${voucherArtLine.tone}`}>
                      {voucherArtLine.text}
                    </p>
                  )}
                  {voucherAmountLine && (
                    <p className={`field-hint voucher-check ${voucherAmountLine.tone}`}>
                      {voucherAmountLine.text}
                    </p>
                  )}
                </div>
              </div>

              <label className="field">
                Gutschein-Leistung
                <select
                  name="voucher_service"
                  value={voucherService}
                  onChange={(e) => {
                    const next = e.target.value as VoucherService | ''
                    edited(setVoucherService)(next)
                    // The guest flies at least what the voucher covers, so raise
                    // the booking to match — otherwise the voucher would be worth
                    // more than the service and the difference would read as 0.
                    setExtraBooking((current) => atLeast(current, serviceOfVoucher(next)))
                  }}
                >
                  <option value="">— auswählen —</option>
                  {VOUCHER_SERVICES.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Was der Gutschein abdeckt. Wird vom Preis abgezogen.
                </span>
              </label>
            </fieldset>
          )}

          {/*
            Outside the voucher block on purpose, directly under it: what the
            club's file already carries stays true even after the payment method
            is moved away from Gutschein, which is precisely when the row stops
            naming the voucher the date sits on.
          */}
          {redemptionLine && (
            <p className="field-hint">{redemptionLine}</p>
          )}
        </section>

        <section className="panel" aria-label="Leistung">
          <h3 className="panel-title">Leistung</h3>

          <label className="field">
            Gebuchte Leistung
            <select
              value={extraBooking}
              onChange={(e) => edited(setExtraBooking)(e.target.value as ExtraBooking)}
            >
              {EXTRA_BOOKINGS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
            <span className="field-hint">
              {showVoucherNumber
                ? 'Was der Gast insgesamt bekommt. Der Gutschein wird davon abgezogen.'
                : 'Zusätzlich zum Sprung.'}
            </span>
          </label>

          <label className="field">
            Gewichtszuschlag
            <select
              value={weightSurcharge}
              onChange={(e) => edited(setWeightSurcharge)(e.target.value as WeightSurcharge)}
            >
              {WEIGHT_SURCHARGES.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                  {prices && w.value !== 'none'
                    ? ` (${formatEuro(w.value === 'over_90' ? prices.weight_over_90 : prices.weight_over_100)})`
                    : ''}
                </option>
              ))}
            </select>
            {/*
              Preset from the weight when the guest registered, and left alone
              afterwards. The hint only points out a disagreement — waiving the
              surcharge is the manifest's call, and a waiver that gets corrected
              back on the next save is not a waiver.
            */}
            <span className={surchargeDeviates ? 'field-hint warn' : 'field-hint'}>
              {surchargeDeviates
                ? `${registration.weight_kg} kg — ${
                    surchargeFromWeight === 'none'
                      ? 'kein Zuschlag fällig.'
                      : `Zuschlag ${surchargeFromWeight === 'over_90' ? 'ab 90 kg' : 'ab 100 kg'} wäre fällig.`
                  }`
                : `Eingetragenes Gewicht: ${registration.weight_kg} kg`}
            </span>
          </label>

          {/*
            Always in place, only usable when a video is actually flown — the
            field kept appearing and disappearing as the booking changed, which
            reflowed the form under the operator's hand. Its hint says why it is
            locked, or that a booked video still has nobody to film it.
          */}
          <div className="field">
            <label htmlFor={ids.cameraFlyer}>Kameraflieger</label>
            <select
              id={ids.cameraFlyer}
              disabled={!showCameraFlyer}
              value={showCameraFlyer ? cameraFlyerId : ''}
              aria-describedby={ids.cameraFlyerHint}
              onChange={(e) => edited(setCameraFlyerId)(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">— auswählen —</option>
              {flyerList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <p id={ids.cameraFlyerHint} className={cameraFlyerMissing ? 'field-hint warn' : 'field-hint'}>
              {!showCameraFlyer
                ? 'Kein Video gebucht.'
                : cameraFlyerMissing
                  ? 'Video gebucht — noch kein Kameraflieger.'
                  : ''}
            </p>
          </div>

          {/*
            Last in this column on purpose: a note records the special
            arrangement behind the three choices above it. Among the dropdowns it
            would read as one more thing to fill in on every row.
          */}
          <label className="field">
            Anmerkungen
            <textarea
              name="notes"
              rows={3}
              value={notes}
              onChange={(e) => edited(setNotes)(e.target.value)}
            />
            <span className="field-hint">
              Besondere Vereinbarungen, Abweichungen, Sonderfälle. Steht im Excel-Export.
            </span>
          </label>
        </section>

        {/*
          Everything about this guest's money in one column: whether it is in,
          what is owed, and every decision that changes that amount. The state
          comes first — an operator back from an interruption has to see at a
          glance whether the till already has it.
        */}
        <section className="panel kassa-panel" aria-labelledby="kassa-title">
          <div className="kassa-head">
            <h3 className="panel-title" id="kassa-title">Kassa</h3>
            <p className={paid ? 'kassa-state paid' : 'kassa-state open'}>{paidState}</p>
          </div>

          {/*
            Until the price table has arrived there is nothing honest to show —
            a 0 € total would be read as "guest owes nothing".
          */}
          {pricesFailed && (
            <div className="load-failed">
              <p className="error">Preise konnten nicht geladen werden.</p>
              <button type="button" className="btn secondary" onClick={retry}>
                Erneut versuchen
              </button>
            </div>
          )}
          {!prices && !pricesFailed && <p className="field-hint">Preise werden geladen…</p>}

          {prices && (
            <>
              <div className="price-breakdown">
                {lines.map((l) => (
                  <div className="price-line" key={l.label}>
                    <span>{l.label}</span>
                    <span className="numeral">{formatEuro(l.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="price-line price-total">
                {/* On a collected row the total is what was taken — until an edit
                    changes it, when it is what the row would say after saving. */}
                <span>
                  {!paid ? 'Zu kassieren' : paidChanges.length > 0 ? 'Nach dem Speichern' : 'Kassiert'}
                </span>
                <span className="numeral">{formatEuro(due)}</span>
              </div>
              {priceOverride && due !== computed && (
                <p className="field-hint">Berechnet wären {formatEuro(computed)}.</p>
              )}
            </>
          )}

          {/*
            The club's list says this voucher is not worth anything — never
            paid, cancelled, or already spent. It takes nothing off the bill
            until someone decides, with the guest in front of them, to honour
            it anyway. The box is that decision.
          */}
          {showVoucherNumber && voucherRejectedByList && (
            <div className="kassa-alert">
              <p role="alert">
                <strong>Gutschein laut Liste ungültig</strong>
                {voucherAccepted ? ' — wird trotzdem abgezogen.' : ' — volle Summe kassieren.'}
              </p>
              <label className="voucher-topup-toggle">
                <input
                  type="checkbox"
                  name="voucher_accepted"
                  checked={voucherAccepted}
                  onChange={(e) => edited(setVoucherAccepted)(e.target.checked)}
                />
                trotzdem anerkennen
              </label>
            </div>
          )}

          {showVoucherDifference && (
            <div className="voucher-difference">
              <p className="voucher-difference-line">
                Gutschein damals {formatEuro(voucherCheck!.amount!)}, die gedeckte Leistung
                kostet heute {formatEuro(covered)} — Differenz{' '}
                <strong>{formatEuro(voucherDifference)}</strong>.
              </p>
              <label className="voucher-topup-toggle">
                <input
                  type="checkbox"
                  name="voucher_topup"
                  checked={voucherTopup}
                  onChange={(e) => edited(setVoucherTopup)(e.target.checked)}
                />
                Differenz dazurechnen
              </label>
            </div>
          )}

          {showVoucherNumber && (
            <label className="field">
              Zuzahlung bezahlt mit
              <select
                name="voucher_payment_method"
                disabled={!showVoucherPayment}
                value={showVoucherPayment ? voucherPaymentMethod : ''}
                onChange={(e) => edited(setVoucherPaymentMethod)(e.target.value as CollectedVia | '')}
              >
                <option value="">— auswählen —</option>
                {COLLECTED_VIA.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className={tillMissing ? 'field-hint warn' : 'field-hint'}>
                {!showVoucherPayment
                  ? 'Gutschein deckt alles ab — keine Zuzahlung.'
                  : tillMissing
                    ? `${formatEuro(due)} Zuzahlung — Bar oder Karte wählen.`
                    : 'Zählt am Abend in die Bar- bzw. Kartensumme.'}
              </span>
            </label>
          )}

          {paidChanges.length > 0 && (
            <p className="field-hint warn">
              Bereits kassiert — Speichern ändert die Kassa: {paidChanges.join(', ')}.
            </p>
          )}

          {dayOutdated && (
            <p className="price-outdated">
              Dieser Sprungtag läuft auf der Preisliste vom Tagesbeginn
              ({formatEuro(day!.prices.jump)} pro Sprung, aktuell {formatEuro(day!.current.prices.jump)}).
              {dayIsToday
                ? ' Im Manifest lässt sich der ganze Tag auf die aktuellen Preise umstellen.'
                : ' Abgeschlossene Tage bleiben, wie sie geflogen wurden.'}
            </p>
          )}

          {/*
            Locked until the prices are in: the manual field starts from the
            computed amount, and before the table arrives that amount is 0 —
            a single click would have stored the jump as free.
          */}
          <label className="price-override-toggle">
            <input
              type="checkbox"
              checked={priceOverride}
              disabled={!prices}
              onChange={(e) => {
                edited(setPriceOverride)(e.target.checked)
                // Start the manual field from the amount currently computed, so
                // a small correction is a small edit — and so a price stored
                // before the selection changed cannot silently come back.
                if (e.target.checked) setPrice(computed)
              }}
            />
            abweichender Preis
          </label>

          {priceOverride && (
            <label className="field">
              Preis (EUR)
              <input
                type="number"
                className="numeral"
                value={price}
                onChange={(e) => edited(setPrice)(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </label>
          )}

          {/*
            Collecting from here saves the screen with it, so an operator who
            just fixed the booking does not have to go back to the list to take
            the money for it.
          */}
          {!paid && (
            <button
              type="button"
              className="btn primary kassa-collect"
              onClick={startCollect}
              disabled={!prices || saving || collecting || (priceOverride && price === '')}
            >
              {collecting
                ? 'Wird kassiert…'
                : due > 0 && prices ? `${formatEuro(due)} kassieren` : 'Kassieren'}
            </button>
          )}
        </section>
      </div>

      <div className="save-bar detail-actions">
        <a
          className="btn secondary"
          href={contractPdfUrl(registration.id)}
          target="_blank"
          rel="noreferrer"
        >
          Vertrag öffnen
        </a>
        {/*
          Opens the filled certificate in the browser's PDF viewer, where it is
          printed like the contract. The whole page comes from the server, so
          plain paper is enough.
        */}
        <a
          className="btn secondary"
          href={urkundePdfUrl(registration.id)}
          target="_blank"
          rel="noreferrer"
        >
          Urkunde drucken
        </a>
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving || collecting}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
        {/*
          Lives in the bar, not below it, because the buttons that produce it live
          here: Speichern and Registrierung löschen are pinned to the viewport, so
          an operator scrolled away from the top would never see feedback left in
          the page's normal flow. Placed after Speichern and before the
          auto-margined delete button — in the space that margin already opens up
          — so neither button's horizontal position depends on whether a message
          is showing.
        */}
        <div className="save-feedback" role="status" aria-live="polite">
          {error && <p className="error">{error}</p>}
          {!error && dirty && <p className="unsaved">Ungespeicherte Änderungen</p>}
          {!error && !dirty && saved && <p className="hint">Gespeichert.</p>}
        </div>
        {/* Set apart from the rest so it is never the button next to Speichern. */}
        <button
          type="button"
          className="btn danger detail-delete"
          onClick={handleDelete}
          disabled={deleting}
        >
          <TrashIcon />
          {deleting ? 'Löscht…' : 'Registrierung löschen'}
        </button>
      </div>

      {collectOpen && (
        <CollectDialog
          rows={[{
            ...registration,
            payment_method: paymentMethod || null,
            voucher_payment_method: showVoucherPayment ? voucherPaymentMethod || null : null,
            price: due,
          }]}
          skippedCount={0}
          busy={collecting}
          error={collectError}
          onConfirm={(method) => { void collect(method) }}
          onCancel={() => setCollectOpen(false)}
        />
      )}
    </div>
  )
}
