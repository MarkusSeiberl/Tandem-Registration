import { useId } from 'react'
import type { ExtraBooking, Prices, WeightSurcharge } from './api'
import { computePrice, formatEuro } from './pricing'

// Each row and column names the prices it adds, so a cell knows which inputs
// it depends on and can blank itself alone when one of them is invalid.
const ROWS: { booking: ExtraBooking; label: string; needs: (keyof Prices)[] }[] = [
  { booking: 'none', label: 'Tandem', needs: ['jump'] },
  { booking: 'video', label: 'Tandem + Video', needs: ['jump', 'video'] },
  { booking: 'video_photo', label: 'Tandem + Video + Foto', needs: ['jump', 'video_photo'] },
]

// `spoken` completes the short visible heading for a screen reader, which hears
// a column heading on its own, without the "Zuschlag" of the first one.
const COLUMNS: { surcharge: WeightSurcharge; label: string; spoken: string; needs: (keyof Prices)[] }[] = [
  { surcharge: 'none', label: 'ohne Zuschlag', spoken: '', needs: [] },
  { surcharge: 'over_90', label: 'ab 90 kg', spoken: 'Zuschlag ', needs: ['weight_over_90'] },
  { surcharge: 'over_100', label: 'ab 100 kg', spoken: 'Zuschlag ', needs: ['weight_over_100'] },
]

interface PriceMatrixProps {
  // Only the prices that currently parse; the rest are left out.
  prices: Partial<Prices>
  // The saved prices, when the screen has unsaved edits: a cell that would
  // change is marked and says what it was.
  before?: Partial<Prices>
}

function priceOf(
  prices: Partial<Prices>,
  booking: ExtraBooking,
  surcharge: WeightSurcharge,
  needs: (keyof Prices)[]
): number | null {
  if (needs.some((key) => prices[key] === undefined)) return null
  // Safe: computePrice only reads the prices listed in `needs`.
  return computePrice({ extra_booking: booking, weight_surcharge: surcharge }, prices as Prices)
}

// What a guest pays for each combination, derived with the same rule the detail
// screen uses, so the table can never disagree with an actual bill.
export default function PriceMatrix({ prices, before }: PriceMatrixProps) {
  const headingId = useId()

  return (
    <section className="price-matrix">
      <h3 id={headingId}>Endpreise</h3>
      <table aria-labelledby={headingId}>
        <thead>
          <tr>
            <td />
            {COLUMNS.map((col) => (
              <th key={col.surcharge} scope="col">
                {col.spoken && <span className="visually-hidden">{col.spoken}</span>}
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.booking}>
              <th scope="row">{row.label}</th>
              {COLUMNS.map((col) => {
                const needs = [...row.needs, ...col.needs]
                const now = priceOf(prices, row.booking, col.surcharge, needs)
                const then = before ? priceOf(before, row.booking, col.surcharge, needs) : null
                const changed = before !== undefined && then !== null && now !== then
                return (
                  <td key={col.surcharge} className={changed ? 'numeral changed' : 'numeral'}>
                    {now === null ? '–' : formatEuro(now)}
                    {changed && <span className="visually-hidden">, vorher {formatEuro(then)}</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
