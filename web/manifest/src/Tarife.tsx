import Betraege from './Betraege'

interface TarifeProps {
  onDirtyChange?: (dirty: boolean) => void
}

// Prices, payout rates and what they add up to. Opened before every season and
// whenever someone asks what a combination costs; the crew lists change on
// their own schedule and live on the Crew screen.
export default function Tarife({ onDirtyChange }: TarifeProps) {
  return (
    <div className="tarife-screen">
      <h2>Tarife</h2>
      <Betraege onDirtyChange={onDirtyChange} />
    </div>
  )
}
