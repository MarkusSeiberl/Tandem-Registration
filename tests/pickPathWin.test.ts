import { expect, test } from 'vitest'
import { buildPickScript, encodeCommand } from '../src/server/pickPathWin'

// The dialog itself can only be judged by opening it, so what is tested here is
// everything around it: which dialog gets asked for, and that a path with
// quotes or umlauts survives the trip into PowerShell intact.

test('asks for a folder dialog when a directory is wanted', () => {
  const script = buildPickScript('directory', 'C:/Tandem')
  expect(script).toContain('FolderBrowserDialog')
  expect(script).not.toContain('OpenFileDialog')
})

test('asks for a file dialog filtered to Excel files when the list is wanted', () => {
  const script = buildPickScript('excel-file', '')
  expect(script).toContain('OpenFileDialog')
  expect(script).toContain('*.xlsx')
  expect(script).toContain('*.xlsm')
  expect(script).not.toContain('FolderBrowserDialog')
})

test('raises the dialog itself to the front', () => {
  // tandem.exe is a background process while the operator looks at the browser,
  // so Windows refuses it the foreground and the dialog opens *behind* that
  // window: the button looks dead and every click leaves another invisible
  // dialog behind. The owner form being TopMost does not carry over to the shell
  // dialog it owns, so the dialog window has to be raised on its own.
  const script = buildPickScript('directory', '')
  expect(script).toContain('SetWindowPos')
  expect(script).toContain('SetForegroundWindow')
  // The raise has to happen while the modal dialog is up, which only a timer
  // ticking inside the dialog's own message loop can do.
  expect(script).toContain('Timer')
  // Being on top is not enough: without the foreground, what the operator types
  // still goes to the browser behind the dialog. Windows grants the foreground
  // to a background process only while its input thread is attached to the one
  // that currently holds it.
  expect(script).toContain('AttachThreadInput')
})

test('shows the owner window explicitly', () => {
  // The server starts PowerShell with windowsHide, and that hide flag is applied
  // to the first window the process shows — which is this owner form. It then
  // stays hidden, the dialog has nothing to centre on and lands at 0,0 behind
  // the browser. A second, explicit ShowWindow is not affected by the flag.
  expect(buildPickScript('directory', '')).toContain('ShowWindow')
})

test('keeps the owner window on the screen', () => {
  // The dialogs position themselves relative to their owner. An owner parked at
  // -2000,-2000 pushed the file dialog into the top-left corner of the screen.
  const script = buildPickScript('excel-file', '')
  expect(script).not.toContain('-2000')
  expect(script).toContain('PrimaryScreen')
})

test('starts the dialog at the path that is configured', () => {
  expect(buildPickScript('directory', 'C:\\Tandem\\Export')).toContain('C:\\Tandem\\Export')
})

test('escapes a quote in the current path instead of breaking the script', () => {
  // A single quote would otherwise end the PowerShell string and turn the rest
  // of the path into commands.
  const script = buildPickScript('directory', "C:\\Karl's Ordner")
  expect(script).toContain("C:\\Karl''s Ordner")
})

test('encodes the script as UTF-16LE base64, the way -EncodedCommand expects', () => {
  const script = buildPickScript('excel-file', 'C:\\Verein\\Gutscheinübersicht.xlsx')
  const decoded = Buffer.from(encodeCommand(script), 'base64').toString('utf16le')
  expect(decoded).toBe(script)
  expect(decoded).toContain('Gutscheinübersicht.xlsx')
})
