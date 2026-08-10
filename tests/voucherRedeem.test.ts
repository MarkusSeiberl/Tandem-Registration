import { test, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { redeemVoucher } from '../src/server/voucherRedeem'
import { clearVoucherListCache } from '../src/server/voucherList'
import { writeVoucherFile } from './helpers/voucherFile'
import { DEFAULT_PAYOUTS, DEFAULT_PRICES } from '../src/server/config'
import type { Config } from '../src/server/config'

async function configFor(voucherListPath: string): Promise<Config> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-redeem-'))
  return {
    exportDir: dir, contractText: '', privacyText: '', jumpLocation: '',
    backupDir: '', voucherListPath,
    prices: { ...DEFAULT_PRICES }, payouts: { ...DEFAULT_PAYOUTS },
  }
}

async function cellValue(file: string, row: number, header: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  const headers = ws.getRow(1).values as string[]
  return ws.getRow(row).getCell(headers.indexOf(header)).value
}

test('writes the redemption date into the Eingelöst cell', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-001', new Date('2026-08-10'))).toBe('written')
  const written = await cellValue(file, 2, 'Eingelöst')
  expect(written instanceof Date && written.toISOString().slice(0, 10)).toBe('2026-08-10')
})

test('a date already in the cell is left exactly as it is', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    {
      lfdNr: '26-002', einzahlDat: new Date('2026-01-14'), art: 'Tandem',
      eingeloest: new Date('2026-07-12'),
    },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-002', new Date('2026-08-10'))).toBe('already_redeemed')
  const kept = await cellValue(file, 2, 'Eingelöst')
  expect(kept instanceof Date && kept.toISOString().slice(0, 10)).toBe('2026-07-12')
})

test('an invalid voucher is never marked as redeemed', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-007', einzahlDat: null, art: 'Tandem' },
    { lfdNr: '26-009', einzahlDat: 'STORNO', art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-007', new Date('2026-08-10'))).toBe('invalid')
  expect(await redeemVoucher(cfg, '26-009', new Date('2026-08-10'))).toBe('invalid')
  expect(await redeemVoucher(cfg, '99-999', new Date('2026-08-10'))).toBe('invalid')
  expect(await cellValue(file, 2, 'Eingelöst')).toBeNull()
  expect(await cellValue(file, 3, 'Eingelöst')).toBeNull()
})

test('the list is backed up once a day, not once per write', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-15'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  await redeemVoucher(cfg, '26-001', new Date('2026-08-10'))
  await redeemVoucher(cfg, '26-002', new Date('2026-08-10'))

  const backups = await fs.readdir(path.join(cfg.exportDir, 'Gutschein-Backup'))
  expect(backups).toEqual(['Tandemliste_2026-08-10.xlsx'])
})

test('an unreadable list is a technical failure, to be retried', async () => {
  clearVoucherListCache()
  const cfg = await configFor('C:/nope/keine-datei.xlsx')
  expect(await redeemVoucher(cfg, '26-001', new Date('2026-08-10'))).toBe('failed')
})

test('no configured list means nothing to do', async () => {
  const cfg = await configFor('')
  expect(await redeemVoucher(cfg, '26-001', new Date('2026-08-10'))).toBe('disabled')
})
