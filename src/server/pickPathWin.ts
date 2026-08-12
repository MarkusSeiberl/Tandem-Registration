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
  // While the operator looks at the manifest in a browser, tandem.exe is a
  // background process — Windows denies it the foreground, so a dialog it opens
  // appears *behind* the browser window. The button then looks dead, and every
  // further click leaves another invisible dialog behind. Two things are needed:
  // an owner window in the middle of the screen (both dialogs place themselves
  // relative to their owner), and a raise of the dialog window itself, because
  // TopMost on the owner does not carry over to the shell dialog it owns.
  const header = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class TandemWin {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after,'
      + ' int x, int y, int cx, int cy, uint flags);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,'
      + ' IntPtr pid);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to,'
      + ' bool attach);',
    '  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
    '  // Windows hands the foreground to a background process only while its',
    '  // input thread is attached to the thread that currently holds it.',
    '  public static void Raise(IntPtr h) {',
    '    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);',
    '    uint me = GetCurrentThreadId();',
    '    AttachThreadInput(fg, me, true);',
    '    SetForegroundWindow(h);',
    '    AttachThreadInput(fg, me, false);',
    '  }',
    '}',
    '"@',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
    '$owner.Opacity = 0',
    // Plain integers rather than System.Drawing.Size/Point, so the script needs
    // no second assembly loaded to place a window nobody is meant to see.
    "$owner.StartPosition = 'Manual'",
    '$owner.Width = 1',
    '$owner.Height = 1',
    '$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$owner.Left = [int]($bounds.Left + $bounds.Width / 2)',
    '$owner.Top = [int]($bounds.Top + $bounds.Height / 2)',
    '$owner.Show()',
    // The server starts this process with windowsHide, i.e. CREATE_NO_WINDOW,
    // and Windows applies that hide flag to the first window the process shows —
    // the owner form above. It would stay hidden, the dialog would have nothing
    // to centre on and would open at 0,0 behind the browser. The flag only ever
    // affects that first call, so showing it again by hand fixes it.
    // SW_SHOWNOACTIVATE (4): visible to Windows, but it must not steal focus —
    // the dialog does that for itself below.
    '[void][TandemWin]::ShowWindow($owner.Handle, 4)',
    // GW_ENABLEDPOPUP (6) hands back the dialog the owner is currently blocked
    // by. Raising it needs no foreground rights: HWND_TOPMOST (-1) always wins,
    // and SetForegroundWindow then puts the keyboard where the operator looks.
    '$raise = New-Object System.Windows.Forms.Timer',
    '$raise.Interval = 200',
    '$script:raiseTicks = 0',
    // The shell folder dialog builds its window in stages, and a single raise at
    // the first popup it hands out is too early — the window behind it takes the
    // focus back. Keep raising for three seconds, then leave the operator alone.
    '$raise.Add_Tick({',
    '  $script:raiseTicks++',
    '  $popup = [TandemWin]::GetWindow($owner.Handle, 6)',
    '  if ($popup -ne [IntPtr]::Zero) {',
    '    [void][TandemWin]::SetWindowPos($popup, [IntPtr]-1, 0, 0, 0, 0, 0x0003)',
    '    [TandemWin]::Raise($popup)',
    '  }',
    '  if ($script:raiseTicks -ge 15) { $raise.Stop() }',
    '})',
    '$raise.Start()',
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
    '$raise.Stop()',
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
