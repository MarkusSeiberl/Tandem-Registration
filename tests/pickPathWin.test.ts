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

test('shows the dialog above the console window', () => {
  // Without an owner the dialog can open behind the tandem.exe console, and the
  // program looks hung to whoever pressed the button.
  expect(buildPickScript('directory', '')).toContain('TopMost')
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
