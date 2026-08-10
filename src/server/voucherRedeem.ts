import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import path from 'path'
import { clearVoucherListCache, loadVoucherList, lookupVoucher } from './voucherList'
import type { Config } from './config'

export type RedeemOutcome =
  /** The date reached the Eingelöst cell. */
  | 'written'
  /** Someone had already entered a date; it was left alone. */
  | 'already_redeemed'
  /** Unpaid, cancelled, unknown or ambiguous — nothing was written or claimed. */
  | 'invalid'
  /** File locked, missing or unreadable. Worth retrying. */
  | 'failed'
  /** No voucher list configured. */
  | 'disabled'

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

// One copy per day, before the first change of that day. The sheet is plain
// enough that an ExcelJS round-trip is low risk, but this is the club's only
// record of which vouchers it sold.
async function backupOnce(cfg: Config, filePath: string, on: Date): Promise<void> {
  const dir = path.join(cfg.backupDir?.trim() || cfg.exportDir, 'Gutschein-Backup')
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `Tandemliste_${isoDay(on)}.xlsx`)
  try {
    // 'wx' fails with EEXIST if today's copy is already there, which makes the
    // check and the write one operation rather than two racing ones.
    const handle = await fs.open(target, 'wx')
    try {
      await handle.writeFile(await fs.readFile(filePath))
    } finally {
      await handle.close()
    }
  } catch (err: any) {
    if (err.code !== 'EEXIST') throw err
  }
}

function eingeloestColumn(sheet: ExcelJS.Worksheet): number | null {
  const header = sheet.getRow(1)
  for (let c = 1; c <= sheet.columnCount; c++) {
    const value = header.getCell(c).value
    if (value === null || value === undefined) continue
    const key = String(value).trim().toLowerCase().replace('eingeloest', 'eingelöst')
    if (key === 'eingelöst') return c
  }
  return null
}

export async function redeemVoucher(
  cfg: Config,
  number: string,
  on: Date
): Promise<RedeemOutcome> {
  const filePath = cfg.voucherListPath?.trim()
  if (!filePath) return 'disabled'

  let entry
  try {
    const list = await loadVoucherList(filePath)
    const found = lookupVoucher(list, number)
    // Only a voucher the list calls good gets a date. An unpaid or cancelled one
    // must not be marked used, and an ambiguous one must not have a row guessed.
    if (found.status === 'redeemed') return 'already_redeemed'
    if (found.status !== 'ok' || !found.entry) return 'invalid'
    entry = found.entry
  } catch {
    return 'failed'
  }

  try {
    await backupOnce(cfg, filePath, on)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const sheet = wb.worksheets[0]
    const column = eingeloestColumn(sheet)
    if (!sheet || column === null) return 'failed'

    const cell = sheet.getRow(entry.rowNumber).getCell(column)
    // Re-checked against the file itself, not only against the cached read: the
    // club may have entered a date since the list was last parsed.
    if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') {
      return 'already_redeemed'
    }
    cell.value = on
    cell.numFmt = 'dd.mm.yyyy'

    await wb.xlsx.writeFile(filePath)
    // The file on disk changed, so the parsed copy is stale.
    clearVoucherListCache()
    return 'written'
  } catch {
    // Locked by Excel, mid-sync in OneDrive, read-only share: all retryable.
    return 'failed'
  }
}
