import { execFile } from 'child_process'
import path from 'path'
import type { PickKind, PickPath } from './routes/pickPath'

// Ten minutes is not a deadline for the operator, it is a guard: a dialog nobody
// answers would otherwise keep a PowerShell process and an open HTTP request
// alive until tandem.exe is restarted.
const DIALOG_TIMEOUT_MS = 10 * 60 * 1000

// PowerShell single-quoted strings take everything literally except the quote
// itself, which is escaped by doubling it. Without this a path like
// `C:\Karl's Ordner` would end the string and run the rest as code.
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function buildPickScript(kind: PickKind, current: string): string {
  const trimmed = current.trim()
  // The dialog must not open behind the tandem.exe console window — a program
  // waiting on an invisible dialog looks like a program that has hung. A tiny
  // top-most form serves as its owner and pulls it to the front.
  const header = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
    // Plain integers rather than System.Drawing.Size/Point, so the script needs
    // no second assembly loaded to place a window nobody is meant to see.
    "$owner.StartPosition = 'Manual'",
    '$owner.Width = 1',
    '$owner.Height = 1',
    '$owner.Left = -2000',
    '$owner.Top = -2000',
    '$owner.Show()',
  ]

  const dialog = kind === 'directory'
    ? [
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        `$d.Description = 'Verzeichnis wählen'`,
        '$d.ShowNewFolderButton = $true',
        ...(trimmed ? [`$d.SelectedPath = ${psQuote(trimmed)}`] : []),
      ]
    : [
        '$d = New-Object System.Windows.Forms.OpenFileDialog',
        `$d.Title = 'Gutscheinliste wählen'`,
        `$d.Filter = 'Excel-Dateien (*.xlsx;*.xlsm)|*.xlsx;*.xlsm|Alle Dateien (*.*)|*.*'`,
        '$d.CheckFileExists = $true',
        ...(trimmed
          ? [
              `$d.InitialDirectory = ${psQuote(path.dirname(trimmed))}`,
              `$d.FileName = ${psQuote(path.basename(trimmed))}`,
            ]
          : []),
      ]

  // Nothing on stdout means cancelled. `Write` rather than `WriteLine` so a path
  // never carries a trailing newline into config.json.
  const chosen = kind === 'directory' ? '$d.SelectedPath' : '$d.FileName'
  const footer = [
    'if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {',
    `  [Console]::Out.Write(${chosen})`,
    '}',
    '$owner.Close()',
  ]

  return [...header, ...dialog, ...footer].join('\n')
}

// -EncodedCommand takes UTF-16LE base64. Passing the script as plain text would
// mean quoting it through cmd and PowerShell both, and any umlaut in a path
// would depend on the console code page.
export function encodeCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export const pickPathWindows: PickPath = (kind, current) =>
  new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encodeCommand(buildPickScript(kind, current)),
      ],
      { timeout: DIALOG_TIMEOUT_MS, encoding: 'utf8', windowsHide: true },
      (err, stdout) => {
        if (err) {
          console.error('[tandem] Dateiauswahl fehlgeschlagen:', err.message)
          resolve(null)
          return
        }
        const picked = stdout.trim()
        resolve(picked === '' ? null : picked)
      },
    )
  })
