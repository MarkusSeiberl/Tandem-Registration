export interface StepManagerProps {
  manager: string
  onManagerChange: (name: string) => void
  /** Why the name could not be saved; null when it could. */
  message: string | null
  disabled: boolean
}

export default function StepManager({ manager, onManagerChange, message, disabled }: StepManagerProps) {
  return (
    <>
      <h3>Betriebsleiter</h3>
      <p className="dc-lede">Wer hat den Tag geführt? Der Name steht im Blatt in der Zeile Betriebsleiter (BL).</p>
      {message && <p className="dc-message" role="alert">{message}</p>}
      <div className="dc-bl">
        <label htmlFor="dc-manager">Betriebsleiter</label>
        <input
          id="dc-manager"
          className="dc-text"
          type="text"
          autoComplete="off"
          placeholder="Vor- und Nachname"
          value={manager}
          disabled={disabled}
          onChange={(e) => onManagerChange(e.target.value)}
        />
        <span className="dc-hint">Gleiches Feld wie oben in der Liste.</span>
      </div>
    </>
  )
}
