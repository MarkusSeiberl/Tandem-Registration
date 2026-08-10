import { useEffect, useState } from 'react'
import {
  checkVoucher, patch, remove, flyers as fetchFlyers, masters as fetchMasters, contractPdfUrl,
  getSettings,
} from './api'
import type {
  CollectedVia, ExtraBooking, PaymentMethod, Prices, Registration, StammdatenItem,
  VoucherCheck, VoucherService, WeightSurcharge,
} from './api'
import {
  COLLECTED_VIA, EXTRA_BOOKINGS, PAYMENT_METHODS, VOUCHER_SERVICES, WEIGHT_SURCHARGES,
  genderLabel,
} from './labels'
import {
  atLeast, formatEuro, priceLines, serviceOfVoucher, surchargeForWeight, voucherValue,
} from './pricing'
import { voucherAmountText, voucherServiceText, voucherStatusText } from './voucher'
import TrashIcon from './TrashIcon'

export interface DetailProps {
  registration: Registration
  onBack: () => void
  onSaved: (updated: Registration) => void
}

export default function Detail({ registration, onBack, onSaved }: DetailProps) {
  const [masterList, setMasterList] = useState<StammdatenItem[]>([])
  const [flyerList, setFlyerList] = useState<StammdatenItem[]>([])

  const [prices, setPrices] = useState<Prices | null>(null)

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
  const [extraBooking, setExtraBooking] = useState<ExtraBooking>(registration.extra_booking ?? 'none')
  const [weightSurcharge, setWeightSurcharge] =
    useState<WeightSurcharge>(registration.weight_surcharge ?? 'none')
  const [cameraFlyerId, setCameraFlyerId] = useState<number | ''>(registration.camera_flyer_id ?? '')
  const [notes, setNotes] = useState<string>(registration.notes ?? '')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchMasters().then(setMasterList).catch(() => {})
    fetchFlyers().then(setFlyerList).catch(() => {})
    // The amounts live in the settings so the club can change them between
    // seasons; the breakdown below is only a preview of what the server will
    // compute on save.
    getSettings().then((cfg) => setPrices(cfg.prices)).catch(() => {})
  }, [])

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
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      checkVoucher(number)
        .then((result) => { if (!cancelled) setVoucherCheck(result) })
        .catch(() => { if (!cancelled) setVoucherCheck(null) })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [voucherNumber, showVoucherNumber])

  const voucherLine = voucherCheck ? voucherStatusText(voucherCheck) : null
  const voucherArtLine = voucherCheck ? voucherServiceText(voucherCheck, voucherService) : null
  // What the same service is worth at today's table, for the "damals · heute"
  // line. `voucherValue` is already imported by this screen's pricing helpers.
  const voucherAmountLine =
    voucherCheck && prices
      ? voucherAmountText(
          voucherCheck,
          voucherCheck.service ? voucherValue(voucherCheck.service, prices) : null,
          formatEuro
        )
      : null
  // Kameraflieger is needed whenever video is filmed — that includes a guest
  // whose voucher already covers the video, who books nothing on top.
  const voucherCoversVideo = showVoucherNumber &&
    (voucherService === 'jump_video' || voucherService === 'jump_video_photo')
  const showCameraFlyer =
    extraBooking === 'video' || extraBooking === 'video_photo' || voucherCoversVideo

  const lines = prices
    ? priceLines({
        payment_method: paymentMethod,
        voucher_service: showVoucherNumber ? voucherService : null,
        extra_booking: extraBooking,
        weight_surcharge: weightSurcharge,
      }, prices)
    : []
  const computed = lines.reduce((sum, l) => sum + l.amount, 0)
  const due = priceOverride && price !== '' ? price : computed
  // A voucher moves no money by itself, so the till it lands in is only a
  // question once the guest actually owes something on top of it. The field stays
  // in place either way and says which of the two it is — a field that vanishes
  // while you are looking somewhere else is the thing this screen got wrong.
  const showVoucherPayment = showVoucherNumber && due > 0
  const voucherStatus = showVoucherPayment
    ? `Noch ${formatEuro(due)} offen — bitte Kassa wählen.`
    : 'Gutschein deckt alles ab — nichts zu kassieren.'
  // Money is owed and nobody recorded where it went: that till will not add up at
  // closing. Worth a warning, not worth blocking a half-finished row from saving.
  const tillMissing = showVoucherPayment && voucherPaymentMethod === ''

  // The surcharge is derived from the weight once, when the guest registers. From
  // then on the operator owns it — waiving it is a legitimate exception. So this
  // only reports the disagreement instead of correcting it.
  const surchargeFromWeight = surchargeForWeight(registration.weight_kg)
  const surchargeDeviates = weightSurcharge !== surchargeFromWeight

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await patch(registration.id, {
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
        // Likewise drop the till once there is nothing left to collect.
        voucher_payment_method: showVoucherPayment
          ? (voucherPaymentMethod === '' ? null : voucherPaymentMethod)
          : null,
        extra_booking: extraBooking,
        weight_surcharge: weightSurcharge,
        // Clear a stale flyer selection if the booking no longer includes video.
        camera_flyer_id: showCameraFlyer ? (cameraFlyerId === '' ? null : cameraFlyerId) : null,
        notes: notes.trim() === '' ? null : notes.trim(),
      })
      // The server owns the number; adopt whatever it stored so the field cannot
      // drift from the sheet.
      setPrice(updated.price ?? '')
      setPriceOverride(!!updated.price_override)
      // Adopt the stored form of the note too, so the field shows what the sheet
      // will show — the server trims it and turns an empty one into nothing.
      setNotes(updated.notes ?? '')
      onSaved(updated)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
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
      // The list re-fetches on the server's "changed" event, so going back is all
      // that is left to do here.
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="detail-screen">
      <button type="button" className="btn secondary" onClick={onBack}>
        ← Zurück
      </button>

      <div className="detail-grid">
        <section className="guest-data">
          <h2>Gastdaten</h2>
          <dl>
            <div className="detail-row">
              <dt>Name</dt>
              <dd>
                {registration.first_name} {registration.last_name}
              </dd>
            </div>
            <div className="detail-row">
              <dt>Geschlecht</dt>
              <dd>{genderLabel(registration.gender)}</dd>
            </div>
            <div className="detail-row">
              <dt>Alter</dt>
              <dd className="numeral">{registration.age}</dd>
            </div>
            <div className="detail-row">
              <dt>Größe</dt>
              <dd className="numeral">{registration.height_cm != null ? `${registration.height_cm} cm` : ''}</dd>
            </div>
            <div className="detail-row">
              <dt>Gewicht</dt>
              <dd className="numeral">{registration.weight_kg} kg</dd>
            </div>
            <div className="detail-row">
              <dt>Adresse</dt>
              <dd>
                {registration.street}
                <br />
                {registration.postal_code} {registration.city}
              </dd>
            </div>
            <div className="detail-row">
              <dt>E-Mail</dt>
              <dd>{registration.email}</dd>
            </div>
            <div className="detail-row">
              <dt>Telefon</dt>
              <dd>{registration.phone}</dd>
            </div>
            <div className="detail-row">
              <dt>Sprungdatum</dt>
              <dd>{registration.jump_date}</dd>
            </div>
          </dl>
        </section>

        <section className="manifest-fields">
          <h2>Manifest</h2>

          <label className="field">
            Tandemmaster
            <select
              value={tandemMasterId}
              onChange={(e) => setTandemMasterId(e.target.value === '' ? '' : Number(e.target.value))}
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
              value={loadNumber}
              onChange={(e) => setLoadNumber(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </label>

          <label className="field">
            Zahlungsart
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}>
              <option value="">— auswählen —</option>
              {PAYMENT_METHODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {/*
            One block, tied to the payment method right above it: everything the
            voucher needs appears and disappears together, and the till comes
            after the two fields that decide its amount.
          */}
          {showVoucherNumber && (
            <fieldset className="voucher-group">
              <legend>Gutschein</legend>

              <label className="field">
                Gutschein-Nr.
                <input
                  type="text"
                  value={voucherNumber}
                  onChange={(e) => setVoucherNumber(e.target.value)}
                />
                {voucherLine && (
                  <span className={`field-hint voucher-check ${voucherLine.tone}`}>
                    {voucherLine.text}
                  </span>
                )}
                {voucherArtLine && (
                  <span className={`field-hint voucher-check ${voucherArtLine.tone}`}>
                    {voucherArtLine.text}
                  </span>
                )}
                {voucherAmountLine && (
                  <span className={`field-hint voucher-check ${voucherAmountLine.tone}`}>
                    {voucherAmountLine.text}
                  </span>
                )}
              </label>

              <label className="field">
                Gutschein-Leistung
                <select
                  name="voucher_service"
                  value={voucherService}
                  onChange={(e) => {
                    const next = e.target.value as VoucherService | ''
                    setVoucherService(next)
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

              <p className={tillMissing ? 'voucher-status warn' : 'voucher-status'}>
                {voucherStatus}
              </p>

              <label className="field">
                Zuzahlung bezahlt mit
                <select
                  name="voucher_payment_method"
                  disabled={!showVoucherPayment}
                  value={showVoucherPayment ? voucherPaymentMethod : ''}
                  onChange={(e) => setVoucherPaymentMethod(e.target.value as CollectedVia | '')}
                >
                  <option value="">— auswählen —</option>
                  {COLLECTED_VIA.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Zählt am Abend in die Bar- bzw. Kartensumme.
                </span>
              </label>
            </fieldset>
          )}

          <label className="field">
            Gebuchte Leistung
            <select value={extraBooking} onChange={(e) => setExtraBooking(e.target.value as ExtraBooking)}>
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
              onChange={(e) => setWeightSurcharge(e.target.value as WeightSurcharge)}
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
            reflowed the form under the operator's hand.
          */}
          <label className="field">
            Kameraflieger
            <select
              disabled={!showCameraFlyer}
              value={showCameraFlyer ? cameraFlyerId : ''}
              onChange={(e) => setCameraFlyerId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">— auswählen —</option>
              {flyerList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {!showCameraFlyer && <span className="field-hint">Kein Video gebucht.</span>}
          </label>

          <div className="price-box">
            {/*
              Until the price table has arrived there is nothing honest to show —
              a 0 € total would be read as "guest owes nothing".
            */}
            {!prices && <p className="hint">Preise werden geladen…</p>}

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
                  <span>Zu kassieren</span>
                  <span className="numeral">{formatEuro(due)}</span>
                </div>
              </>
            )}

            <label className="price-override-toggle">
              <input
                type="checkbox"
                checked={priceOverride}
                onChange={(e) => {
                  setPriceOverride(e.target.checked)
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
                  onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </label>
            )}
          </div>

          {/*
            Below the price box on purpose: a note about a special arrangement
            explains the numbers above it. Placed among the dropdowns it would
            read as one more thing to fill in on every row.
          */}
          <label className="field">
            Anmerkungen
            <textarea
              name="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <span className="field-hint">
              Besondere Vereinbarungen, Abweichungen, Sonderfälle. Steht im Excel-Export.
            </span>
          </label>
        </section>
      </div>

      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="hint">Gespeichert.</p>}

      <div className="actions">
        <a
          className="btn secondary"
          href={contractPdfUrl(registration.id)}
          target="_blank"
          rel="noreferrer"
        >
          Vertrag öffnen
        </a>
        {/*
          The Urkunde print sheet for `registration` is rendered by App.tsx (see
          Urkunde.tsx / urkunde.css) as a sibling of the app shell, not here — it
          must sit outside the `.no-print` subtree so `@media print` can hide the
          app UI without also hiding the sheet. This button only has to trigger
          the browser print dialog.
        */}
        <button type="button" className="btn secondary" onClick={() => window.print()}>
          Urkunde drucken
        </button>
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
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
    </div>
  )
}
