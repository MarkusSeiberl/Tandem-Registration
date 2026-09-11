import TrashIcon from './TrashIcon'

export interface SelectionBarProps {
  /** Angehakte Zeilen über beide Tabellen. */
  selectedCount: number
  /** Wie viele davon noch offen sind — nur die kann Kassieren anfassen. */
  openCount: number
  /** Eine Massenaktion läuft in List; jeder Druck hier würde ihr hineinfahren. */
  busy: boolean
  onCollect: () => void
  onDelete: () => void
  onClear: () => void
}

// Die Aktionen, die auf die Auswahl wirken — getrennt von der Tages-Toolbar,
// weil dort alles den ganzen Tag betrifft (Datum, Betriebsleiter,
// Tagesabschluss) und nur der disabled-Zustand den Unterschied verriet.
//
// Reine Darstellung: List besitzt `checkedIds`, den Dialog und jeden Fetch.
export default function SelectionBar({
  selectedCount, openCount, busy, onCollect, onDelete, onClear,
}: SelectionBarProps) {
  // Die Höhe steht immer, auch leer: sonst schiebt das erste Häkchen die
  // Tabellen nach unten und die nächste Checkbox wandert unter dem Finger weg.
  // Kleben soll die leere Leiste aber nicht — ein unsichtbarer Streifen am
  // Viewport-Rand würde nur die Spaltenköpfe verdecken.
  if (selectedCount === 0) return <div className="selection-bar" aria-hidden="true" />

  return (
    <div className="selection-bar selection-bar-active" role="region" aria-label="Auswahl">
      <p className="selection-bar-summary" aria-live="polite">
        {openCount > 0
          ? `${selectedCount} ausgewählt · ${openCount} offen`
          : `${selectedCount} ausgewählt · keine offen`}
      </p>
      {/* Nicht gesperrt, sondern weg, wenn nichts Offenes angehakt ist: genau
          dieser gesperrte Button war das schwache Signal von vorher. */}
      {openCount > 0 && (
        <button type="button" className="btn primary" onClick={onCollect} disabled={busy}>
          Kassieren ({openCount})
        </button>
      )}
      <button
        type="button"
        className="btn danger"
        onClick={onDelete}
        disabled={busy}
        aria-label={`Ausgewählte löschen (${selectedCount})`}
      >
        <TrashIcon />
        Löschen ({selectedCount})
      </button>
      <button
        type="button"
        className="btn secondary small selection-bar-clear"
        onClick={onClear}
        disabled={busy}
      >
        Auswahl leeren
      </button>
    </div>
  )
}
