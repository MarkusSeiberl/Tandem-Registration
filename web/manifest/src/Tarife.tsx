import Betraege from './Betraege'

interface TarifeProps {
  onDirtyChange?: (dirty: boolean) => void
}

// Prices, payout rates and what they add up to. Opened before every season and
// whenever someone asks what a combination costs; the crew lists change on
// their own schedule and live on the Crew screen.
export default function Tarife({ onDirtyChange }: TarifeProps) {
  return (
    // No page heading: the active "Tarife" tab in the sidebar already names it.
    <div className="tarife-screen">
      <Betraege onDirtyChange={onDirtyChange} />
    </div>
  )
}
