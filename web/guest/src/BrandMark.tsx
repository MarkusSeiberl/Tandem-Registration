export interface BrandMarkProps {
  size?: number
  className?: string
}

// The HFSC Skydive Freistadt club logo — shared mark for the favicon, the
// welcome screen, and the done screen.
export default function BrandMark({ size = 40, className }: BrandMarkProps) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}icon.png`}
      width={size}
      height={size}
      alt=""
      className={className}
    />
  )
}
