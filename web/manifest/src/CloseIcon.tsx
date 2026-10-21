export interface CloseIconProps {
  size?: number
}

// Cancel glyph for the Crew edit row, drawn to match PencilIcon and TrashIcon.
export default function CloseIcon({ size = 18 }: CloseIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
