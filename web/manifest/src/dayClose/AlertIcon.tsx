export interface AlertIconProps {
  size?: number
}

// "Look here" mark for a closing step left with something open, drawn to
// match CheckIcon.
export default function AlertIcon({ size = 16 }: AlertIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 6v7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="12" cy="17.5" r="1.6" fill="currentColor" />
    </svg>
  )
}
