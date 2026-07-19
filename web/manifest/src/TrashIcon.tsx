export interface TrashIconProps {
  size?: number
}

// Shared bin glyph for delete affordances (manifest toolbar batch-delete and
// per-row Stammdaten delete), so both screens speak the same visual language.
export default function TrashIcon({ size = 18 }: TrashIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
