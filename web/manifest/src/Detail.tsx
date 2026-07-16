import { useEffect, useState } from 'react'
import { patch, flyers as fetchFlyers, masters as fetchMasters } from './api'
import type { ExtraBooking, PaymentMethod, Registration, StammdatenItem } from './api'
import { EXTRA_BOOKINGS, PAYMENT_METHODS, genderLabel } from './labels'

export interface DetailProps {
  registration: Registration
  onBack: () => void
  onSaved: (updated: Registration) => void
}

export default function Detail({ registration, onBack, onSaved }: DetailProps) {
  const [masterList, setMasterList] = useState<StammdatenItem[]>([])
  const [flyerList, setFlyerList] = useState<StammdatenItem[]>([])

  const [tandemMasterId, setTandemMasterId] = useState<number | ''>(registration.tandem_master_id ?? '')
  const [loadNumber, setLoadNumber] = useState<number | ''>(registration.load_number ?? '')
  const [price, setPrice] = useState<number | ''>(registration.price ?? '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(registration.payment_method ?? '')
  const [voucherNumber, setVoucherNumber] = useState<string>(registration.voucher_number ?? '')
  const [extraBooking, setExtraBooking] = useState<ExtraBooking>(registration.extra_booking ?? 'none')
  const [cameraFlyerId, setCameraFlyerId] = useState<number | ''>(registration.camera_flyer_id ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchMasters().then(setMasterList).catch(() => {})
    fetchFlyers().then(setFlyerList).catch(() => {})
  }, [])

  // Kameraflieger only makes sense for bookings that actually include video.
  const showCameraFlyer = extraBooking === 'video' || extraBooking === 'video_photo'
  // A voucher number only exists when the guest actually paid with one.
  const showVoucherNumber = paymentMethod === 'voucher'

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await patch(registration.id, {
        tandem_master_id: tandemMasterId === '' ? null : tandemMasterId,
        load_number: loadNumber === '' ? null : loadNumber,
        price: price === '' ? null : price,
        payment_method: paymentMethod === '' ? undefined : paymentMethod,
        // Clear a stale voucher number if the guest no longer pays by voucher.
        voucher_number: showVoucherNumber ? (voucherNumber.trim() === '' ? null : voucherNumber.trim()) : null,
        extra_booking: extraBooking,
        // Clear a stale flyer selection if the booking no longer includes video.
        camera_flyer_id: showCameraFlyer ? (cameraFlyerId === '' ? null : cameraFlyerId) : null,
      })
      onSaved(updated)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="detail-screen">
      <button type="button" className="btn secondary" onClick={onBack}>
        ← Zurück
      </button>

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
            <dd>{registration.age}</dd>
          </div>
          <div className="detail-row">
            <dt>Größe</dt>
            <dd>{registration.height_cm != null ? `${registration.height_cm} cm` : ''}</dd>
          </div>
          <div className="detail-row">
            <dt>Gewicht</dt>
            <dd>{registration.weight_kg} kg</dd>
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
            value={loadNumber}
            onChange={(e) => setLoadNumber(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>

        <label className="field">
          Preis
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
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

        {showVoucherNumber && (
          <label className="field">
            Gutschein-Nr.
            <input
              type="text"
              value={voucherNumber}
              onChange={(e) => setVoucherNumber(e.target.value)}
            />
          </label>
        )}

        <label className="field">
          Zusatzbuchung
          <select value={extraBooking} onChange={(e) => setExtraBooking(e.target.value as ExtraBooking)}>
            {EXTRA_BOOKINGS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </label>

        {showCameraFlyer && (
          <label className="field">
            Kameraflieger
            <select
              value={cameraFlyerId}
              onChange={(e) => setCameraFlyerId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">— auswählen —</option>
              {flyerList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="hint">Gespeichert.</p>}

      <div className="actions">
        {/*
          The A4 print sheet for `registration` is rendered by App.tsx (see Print.tsx /
          print.css) as a sibling of the app shell, not here — it must sit outside the
          `.no-print` subtree so `@media print` can hide the app UI without also hiding
          the sheet. This button only has to trigger the browser print dialog.
        */}
        <button type="button" className="btn secondary" onClick={() => window.print()}>
          Drucken
        </button>
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </div>
  )
}
