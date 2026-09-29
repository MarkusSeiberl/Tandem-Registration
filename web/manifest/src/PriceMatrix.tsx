import type { ExtraBooking, Prices, WeightSurcharge } from './api'
import { computePrice, formatEuro } from './pricing'

// Each row and column names the prices it adds, so a cell knows which inputs
// it depends on and can blank itself alone when one of them is invalid.
const ROWS: { booking: ExtraBooking; label: string; needs: (keyof Prices)[] }[] = [
  { booking: 'none', label: 'Tandem', needs: ['jump'] },
  { booking: 'video', label: 'Tandem + Video', needs: ['jump', 'video'] },
  { booking: 'video_photo', label: 'Tandem + Video + Foto', needs: ['jump', 'video_photo'] },
]

const COLUMNS: { surcharge: WeightSurcharge; label: string; needs: (keyof Prices)[] }[] = [
  { surcharge: 'none', label: 'ohne Zuschlag', needs: [] },
  { surcharge: 'over_90', label: 'ab 90 kg', needs: ['weight_over_90'] },
  { surcharge: 'over_100', label: 'ab 100 kg', needs: ['weight_over_100'] },
]

interface PriceMatrixProps {
  // Only the prices that currently parse; the rest are left out.
  prices: Partial<Prices>
}

// What a guest pays for each combination, derived with the same rule the detail
// screen uses, so the table can never disagree with an actual bill.
export default function PriceMatrix({ prices }: PriceMatrixProps) {
  function cell(booking: ExtraBooking, surcharge: WeightSurcharge, needs: (keyof Prices)[]) {
    if (needs.some((key) => prices[key] === undefined)) return '–'
    // Safe: computePrice only reads the prices listed in `needs`.
    return formatEuro(
      computePrice({ extra_booking: booking, weight_surcharge: surcharge }, prices as Prices)
    )
  }

  return (
    <section className="price-matrix">
      <h3>Endpreise</h3>
      <table>
        <thead>
          <tr>
            <td />
            {COLUMNS.map((col) => (
              <th key={col.surcharge} scope="col">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.booking}>
              <th scope="row">{row.label}</th>
              {COLUMNS.map((col) => (
                <td key={col.surcharge} className="numeral">
                  {cell(row.booking, col.surcharge, [...row.needs, ...col.needs])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
