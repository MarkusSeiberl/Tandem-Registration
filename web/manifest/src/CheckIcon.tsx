export interface CheckIconProps {
  size?: number
}

// Save glyph for the Crew edit row, drawn to match PencilIcon and TrashIcon.
export default function CheckIcon({ size = 18 }: CheckIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
