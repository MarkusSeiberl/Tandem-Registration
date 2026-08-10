import { test, expect } from 'vitest'
import { normaliseVoucherNumber, serviceFromArt } from '../src/server/voucherList'

test('the same voucher written three ways normalises to one key', () => {
  const canonical = normaliseVoucherNumber('26-001')
  expect(normaliseVoucherNumber('26-1')).toBe(canonical)
  expect(normaliseVoucherNumber('26 001')).toBe(canonical)
  expect(normaliseVoucherNumber('  26-001  ')).toBe(canonical)
  expect(normaliseVoucherNumber('26/001')).toBe(canonical)
})

test('different vouchers stay different', () => {
  // Joining the groups keeps the separator meaningful: 26001 is not 26-001.
  expect(normaliseVoucherNumber('26001')).not.toBe(normaliseVoucherNumber('26-001'))
  expect(normaliseVoucherNumber('26-002')).not.toBe(normaliseVoucherNumber('26-001'))
  expect(normaliseVoucherNumber('25-001')).not.toBe(normaliseVoucherNumber('26-001'))
})

test('a group that is only zeros survives normalising', () => {
  expect(normaliseVoucherNumber('26-0')).toBe('26-0')
})

test('letters are kept and folded to upper case', () => {
  expect(normaliseVoucherNumber('gs26-001')).toBe(normaliseVoucherNumber('GS26-001'))
})

test('Art maps to the service it covers', () => {
  expect(serviceFromArt('Tandem')).toEqual({ service: 'jump', isAddOn: false })
  expect(serviceFromArt('Tandem + Video')).toEqual({ service: 'jump_video', isAddOn: false })
  expect(serviceFromArt('Tandem + Video + Foto'))
    .toEqual({ service: 'jump_video_photo', isAddOn: false })
})

test('an Art without Tandem is an add-on, not a jump voucher', () => {
  // "Video + Foto zu GS25-2" tops up another voucher; reading it as a
  // Sprung+Video+Foto voucher would credit a jump nobody paid for.
  expect(serviceFromArt('Video + Foto zu GS25-2')).toEqual({ service: null, isAddOn: true })
})

test('an Art nobody recognises compares against nothing', () => {
  expect(serviceFromArt('Sonderaktion')).toEqual({ service: null, isAddOn: false })
  expect(serviceFromArt(null)).toEqual({ service: null, isAddOn: false })
  expect(serviceFromArt('')).toEqual({ service: null, isAddOn: false })
})

import { readVoucherList } from '../src/server/voucherList'
import { writeVoucherFile } from './helpers/voucherFile'

test('reads the columns it needs by header name', async () => {
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem + Video', betrag: 355 },
  ])
  const list = await readVoucherList(file)

  const entry = list.byNumber.get(normaliseVoucherNumber('26-001'))![0]
  expect(entry.number).toBe('26-001')
  expect(entry.amount).toBe(355)
  expect(entry.art).toBe('Tandem + Video')
  expect(entry.service).toBe('jump_video')
  expect(entry.paidAt?.toISOString().slice(0, 10)).toBe('2026-01-14')
  expect(entry.paidText).toBeNull()
  expect(entry.redeemedAt).toBeNull()
  // Row 1 is the header, so the first voucher is row 2 — the writer needs this.
  expect(entry.rowNumber).toBe(2)
})

test('an unpaid row and a STORNO row are told apart', async () => {
  const file = await writeVoucherFile([
    { lfdNr: '26-007', einzahlDat: null, art: 'Tandem', betrag: 255 },
    { lfdNr: '26-009', einzahlDat: 'STORNO', art: 'Tandem', betrag: 255 },
  ])
  const list = await readVoucherList(file)

  const unpaid = list.byNumber.get(normaliseVoucherNumber('26-007'))![0]
  expect(unpaid.paidAt).toBeNull()
  expect(unpaid.paidText).toBeNull()

  const cancelled = list.byNumber.get(normaliseVoucherNumber('26-009'))![0]
  expect(cancelled.paidAt).toBeNull()
  // Kept verbatim: the club may write something other than STORNO tomorrow.
  expect(cancelled.paidText).toBe('STORNO')
})

test('two rows sharing a number are both kept, so the caller can call it ambiguous', async () => {
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
    { lfdNr: '26-1', einzahlDat: new Date('2026-02-14'), art: 'Tandem' },
  ])
  const list = await readVoucherList(file)
  expect(list.byNumber.get(normaliseVoucherNumber('26-001'))).toHaveLength(2)
})

test('rows without a number are skipped rather than keyed on empty string', async () => {
  const file = await writeVoucherFile([
    { lfdNr: '', einzahlDat: new Date('2026-01-14') },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-14') },
  ])
  const list = await readVoucherList(file)
  expect(list.byNumber.size).toBe(1)
})

test('a missing required header is an error naming the column', async () => {
  const file = await writeVoucherFile([{ lfdNr: '26-001' }], {
    headers: ['LfdNr', 'EinzahlDat', 'Betrag'],
  })
  await expect(readVoucherList(file)).rejects.toThrow(/Eingelöst/)
})

test('a missing file is an error, not a crash', async () => {
  // The route shows this message straight to the club's operator, so
  // ExcelJS's own English "File not found" must not leak through.
  await expect(readVoucherList('C:/nope/keine-datei.xlsx'))
    .rejects.toThrow('Die Gutscheinliste konnte nicht gelesen werden: C:/nope/keine-datei.xlsx')
})

test('a hyperlink cell in a data column reads as its text', async () => {
  // ExcelJS represents a hyperlink cell as { text, hyperlink }; unwrapped
  // naively that stringifies to "[object Object]" instead of the label.
  const file = await writeVoucherFile([
    { lfdNr: '26-010', art: { text: 'Tandem', hyperlink: 'https://example.com' } },
  ])
  const list = await readVoucherList(file)

  const entry = list.byNumber.get(normaliseVoucherNumber('26-010'))![0]
  expect(entry.art).toBe('Tandem')
  expect(entry.service).toBe('jump')
})

import { promises as fsp } from 'fs'
import { clearVoucherListCache, loadVoucherList, lookupVoucher } from '../src/server/voucherList'

async function listOf(rows: Parameters<typeof writeVoucherFile>[0]) {
  return readVoucherList(await writeVoucherFile(rows))
}

test('a paid, unredeemed voucher is ok', async () => {
  const list = await listOf([{ lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' }])
  expect(lookupVoucher(list, '26-1').status).toBe('ok')
})

test('an unpaid voucher is not valid', async () => {
  const list = await listOf([{ lfdNr: '26-007', einzahlDat: null, art: 'Tandem' }])
  expect(lookupVoucher(list, '26-007').status).toBe('unpaid')
})

test('text in EinzahlDat means cancelled, and the text is handed on', async () => {
  const list = await listOf([{ lfdNr: '26-009', einzahlDat: 'STORNO', art: 'Tandem' }])
  const result = lookupVoucher(list, '26-009')
  expect(result.status).toBe('cancelled')
  expect(result.entry?.paidText).toBe('STORNO')
})

test('any other text is cancelled too, not quietly accepted', async () => {
  const list = await listOf([{ lfdNr: '26-010', einzahlDat: 'zurückgezahlt', art: 'Tandem' }])
  expect(lookupVoucher(list, '26-010').status).toBe('cancelled')
})

test('a voucher with a redemption date is already used', async () => {
  const list = await listOf([{
    lfdNr: '26-002', einzahlDat: new Date('2026-01-14'),
    art: 'Tandem', eingeloest: new Date('2026-07-12'),
  }])
  const result = lookupVoucher(list, '26-002')
  expect(result.status).toBe('redeemed')
  expect(result.entry?.redeemedAt?.toISOString().slice(0, 10)).toBe('2026-07-12')
})

test('an unknown number is not found, and an empty one is not looked up', async () => {
  const list = await listOf([{ lfdNr: '26-001', einzahlDat: new Date('2026-01-14') }])
  expect(lookupVoucher(list, '99-999').status).toBe('not_found')
  expect(lookupVoucher(list, '   ').status).toBe('not_found')
})

test('two matching rows are ambiguous rather than a guess', async () => {
  const list = await listOf([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14') },
    { lfdNr: '26-1', einzahlDat: new Date('2026-02-14') },
  ])
  const result = lookupVoucher(list, '26-001')
  expect(result.status).toBe('ambiguous')
  expect(result.entry).toBeNull()
})

test('the list is cached until the file changes on disk', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([{ lfdNr: '26-001', einzahlDat: new Date('2026-01-14') }])

  const first = await loadVoucherList(file)
  const second = await loadVoucherList(file)
  // Same object: a OneDrive file must not be re-parsed on every keystroke.
  expect(second).toBe(first)

  // Rewriting it with a second voucher must be picked up without a restart.
  await new Promise((resolve) => setTimeout(resolve, 20))
  const rewritten = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14') },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-15') },
  ])
  await fsp.copyFile(rewritten, file)

  const third = await loadVoucherList(file)
  expect(third).not.toBe(first)
  expect(third.byNumber.size).toBe(2)
})
