export interface PencilIconProps {
  size?: number
}

// Edit glyph for the per-row Crew edit button, drawn to match TrashIcon.
export default function PencilIcon({ size = 18 }: PencilIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
