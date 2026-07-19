import { exec } from 'child_process'

// A dependency-free Windows toast: drives the built-in Windows.UI.Notifications
// API through PowerShell. Deliberately no npm notification package — those ship
// helper .exe binaries that pkg cannot serve from its virtual snapshot (same
// constraint as better-sqlite3), whereas spawning powershell needs nothing
// extra beside the exe. The guest name is passed via an environment variable
// (not string-interpolated into the script) so it can't break the script or
// inject PowerShell. The whole script is base64/UTF-16LE encoded to avoid all
// shell quoting issues.
const TOAST_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t = $xml.GetElementsByTagName('text')
$t.Item(0).AppendChild($xml.CreateTextNode('Neue Anmeldung')) | Out-Null
$t.Item(1).AppendChild($xml.CreateTextNode($env:TANDEM_GUEST + ' hat die Anmeldung abgeschlossen.')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`

// Show a desktop toast that a guest finished registering. Best-effort and
// non-blocking — a missing/blocked notification must never affect the request.
export function notifyRegistration(name: string): void {
  if (process.platform !== 'win32') return
  const encoded = Buffer.from(TOAST_SCRIPT, 'utf16le').toString('base64')
  exec(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { env: { ...process.env, TANDEM_GUEST: name }, windowsHide: true },
    (err) => {
      if (err) console.error('[tandem] Windows-Benachrichtigung fehlgeschlagen:', err.message)
    }
  )
}
