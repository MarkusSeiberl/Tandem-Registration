export interface BrandMarkProps {
  size?: number
  className?: string
}

// The HFSC Skydive Freistadt club logo — shared mark for the favicon and the
// sidebar brand.
export default function BrandMark({ size = 28, className }: BrandMarkProps) {
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
