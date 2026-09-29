import Betraege from './Betraege'

// Prices, payout rates and what they add up to. Opened before every season and
// whenever someone asks what a combination costs; the crew lists change on
// their own schedule and live on the Crew screen.
export default function Tarife() {
  return (
    <div className="tarife-screen">
      <Betraege />
    </div>
  )
}
