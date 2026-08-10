import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import path from 'path'
import {
  cellText, clearVoucherListCache, headerColumns, loadVoucherList, lookupVoucher,
  normaliseVoucherNumber,
} from './voucherList'
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

// Local calendar day, not UTC. The club is in Austria (UTC+1/+2), so a
// redemption taken just after local midnight has a UTC date of *yesterday*:
// toISOString would write the previous day into the club's list and reuse the
// previous day's backup name, quietly skipping today's backup.
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ExcelJS stores a Date as `25569 + getTime()/86400000`, i.e. it reads the
// instant in UTC. Handing it the raw `on` would therefore land the same
// after-midnight redemption on the previous day in the sheet. The local
// calendar day is re-expressed as UTC midnight so the day Excel shows is the
// day the operator was standing in.
const excelDay = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))

// Every call queues behind the previous one. Two overlapping redemptions would
// otherwise each read the whole workbook, each write their own copy back, and
// the later write would drop the earlier date — while our DB claims that date
// synced, so nothing ever retries it. Fastify runs request handlers
// concurrently and the export sweep calls this in a loop, so the exclusion
// cannot be left to timing.
let queue: Promise<void> = Promise.resolve()

function serialise<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  // The chain is advanced with a link that can never reject, so a caller whose
  // turn throws does not poison the turn of the caller behind it.
  queue = run.then(() => undefined, () => undefined)
  return run
}

// A sibling of the target, so the rename that follows stays inside one volume.
let tempCounter = 0
const tempSibling = (filePath: string) =>
  path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}-${tempCounter++}.tmp`
  )

// One copy per day, before the first change of that day. This is the club's
// only record of which vouchers it sold, so nothing is written to it until a
// copy of today's state exists.
async function backupOnce(cfg: Config, filePath: string, on: Date): Promise<void> {
  const dir = path.join(cfg.backupDir?.trim() || cfg.exportDir, 'Gutschein-Backup')
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `Tandemliste_${isoDay(on)}.xlsx`)

  // Today's copy is already there: it was taken before today's first change,
  // which is the copy worth keeping. Checking rather than claiming the name
  // with 'wx' is safe because every write to this list is serialised above, so
  // this check cannot race another redemption in this process.
  try {
    await fs.stat(target)
    return
  } catch {
    // Not there yet (or unreadable) — fall through and try to create it.
  }

  const temp = tempSibling(target)
  try {
    // The bytes are put in place under a temp name and only then given the
    // dated name. Opening the dated name with 'wx' created it empty first, and
    // a process that died in between left today's backup name taken by a
    // zero-length file — every later write that day then found it and skipped
    // backing up at all.
    await fs.copyFile(filePath, temp)
    await fs.rename(temp, target)
  } catch (err) {
    await fs.unlink(temp).catch(() => {})
    throw err
  }
}

export async function redeemVoucher(
  cfg: Config,
  number: string,
  on: Date
): Promise<RedeemOutcome> {
  const filePath = cfg.voucherListPath?.trim()
  if (!filePath) return 'disabled'
  // The lookup is queued together with the write: the row number found by the
  // lookup is only meaningful for as long as no other call has rewritten the
  // file underneath it.
  return serialise(() => redeemNow(cfg, filePath, number, on))
}

async function redeemNow(
  cfg: Config,
  filePath: string,
  number: string,
  on: Date
): Promise<RedeemOutcome> {
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

  let temp: string | null = null
  try {
    await backupOnce(cfg, filePath, on)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const sheet = wb.worksheets[0]
    if (!sheet) return 'failed'
    const columns = headerColumns(sheet)
    const redeemedColumn = columns.get('eingelöst')
    const numberColumn = columns.get('lfdnr')
    if (redeemedColumn === undefined || numberColumn === undefined) return 'failed'

    const row = sheet.getRow(entry.rowNumber)
    // entry.rowNumber comes from a parse that may be up to 5 s old, and this is
    // a second, separate read of the file. If the club inserted or deleted a
    // row in Excel in between, that number now addresses a different voucher —
    // and the empty-cell check below would not notice, because an unrelated
    // unredeemed row is empty too. So the row has to name the voucher being
    // redeemed before anything is written to it.
    const rowNumber = cellText(row.getCell(numberColumn).value)
    if (!rowNumber || normaliseVoucherNumber(rowNumber) !== normaliseVoucherNumber(number)) {
      return 'failed'
    }

    const cell = row.getCell(redeemedColumn)
    // Re-checked against the file itself, not only against the cached read: the
    // club may have entered a date since the list was last parsed.
    if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') {
      return 'already_redeemed'
    }
    cell.value = excelDay(on)
    cell.numFmt = 'dd.mm.yyyy'

    // ExcelJS's writeFile is createWriteStream(filename), i.e. flag 'w': the
    // club's list is truncated the moment it opens and stays partial for the
    // whole serialisation. A crash, a dropped OneDrive share or a full disk in
    // that window would leave an unopenable .xlsx and no way back. Serialising
    // into a sibling temp file and renaming it over the target keeps the path
    // either wholly the old file or wholly the new one — rename is atomic
    // within a volume, and a sibling is on the same volume by construction.
    temp = tempSibling(filePath)
    await wb.xlsx.writeFile(temp)
    await fs.rename(temp, filePath)
    temp = null
    // The file on disk changed, so the parsed copy is stale.
    clearVoucherListCache()
    return 'written'
  } catch {
    // Locked by Excel, mid-sync in OneDrive, read-only share: all retryable.
    // A half-written temp file must not be left behind in the club's folder.
    if (temp) await fs.unlink(temp).catch(() => {})
    return 'failed'
  }
}
