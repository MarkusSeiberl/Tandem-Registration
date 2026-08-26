import Database from 'better-sqlite3'

// `nativeBinding` lets us point better-sqlite3 at an explicit better_sqlite3.node
// file instead of letting the `bindings` package search the filesystem. This is
// required in the packaged .exe: pkg cannot serve a native addon out of its
// virtual /snapshot filesystem, so we ship the .node beside the exe and load it
// from that real path. In dev (nativeBinding undefined) the normal resolution runs.
export function openDb(path: string, nativeBinding?: string): Database.Database {
  const db = new Database(path, nativeBinding ? { nativeBinding } : {})
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT, last_name TEXT, gender TEXT, age INTEGER,
      height_cm INTEGER, weight_kg INTEGER,
      street TEXT, postal_code TEXT, city TEXT,
      email TEXT, phone TEXT, contract_pdf_filename TEXT,
      accepted_terms INTEGER,
      tandem_master_id INTEGER, load_number INTEGER, price REAL,
      payment_method TEXT, voucher_payment_method TEXT,
      voucher_number TEXT, voucher_service TEXT,
      voucher_topup INTEGER DEFAULT 0, voucher_amount REAL,
      extra_booking TEXT, weight_surcharge TEXT DEFAULT 'none',
      price_override INTEGER DEFAULT 0,
      camera_flyer_id INTEGER,
      created_at TEXT, jump_date TEXT,
      paid_at TEXT, notes TEXT, privacy_ack_at TEXT,
      voucher_redeemed_at TEXT, voucher_redeem_synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tandem_masters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS camera_flyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    -- The price list and payout rates one jump day runs on, frozen by that day's
    -- first registration. What a jump costs is a fact of the day it was flown,
    -- not of whatever the settings screen says when someone later opens the row.
    CREATE TABLE IF NOT EXISTS day_tables (
      jump_date TEXT PRIMARY KEY,
      prices TEXT NOT NULL,
      payouts TEXT NOT NULL
    );
  `)
  migrate(db)
  return db
}

// The CREATE TABLE above only ever runs on a fresh file — IF NOT EXISTS makes it
// a no-op against a database that already has the table, so schema changes would
// otherwise never reach an existing tandem.db. Every column added after the
// initial release therefore has to be applied here as well. Both steps are
// idempotent (guarded by the live column list), so this runs on every startup.
function migrate(db: Database.Database): void {
  const columns = () =>
    new Set((db.pragma('table_info(registrations)') as { name: string }[]).map(c => c.name))

  const existing = columns()
  const added: [string, string][] = [
    ['gender', 'TEXT'],
    ['height_cm', 'INTEGER'],
    ['street', 'TEXT'],
    ['postal_code', 'TEXT'],
    ['city', 'TEXT'],
    ['voucher_number', 'TEXT'],
    ['contract_pdf_filename', 'TEXT'],
    ['voucher_service', 'TEXT'],
    ['weight_surcharge', "TEXT DEFAULT 'none'"],
    ['price_override', 'INTEGER DEFAULT 0'],
    ['voucher_payment_method', 'TEXT'],
    // NULL means "not collected yet" — no default, so existing rows stay open
    // instead of appearing as paid without anyone having taken the money.
    ['paid_at', 'TEXT'],
    ['notes', 'TEXT'],
    // NULL on a migrated row means "registered before the acknowledgement
    // existed", not "the guest refused" — the two must stay distinguishable.
    ['privacy_ack_at', 'TEXT'],
    // When we decided the voucher was used, and when that reached the club's
    // Excel file. Both NULL on an old row: it predates the voucher check.
    ['voucher_redeemed_at', 'TEXT'],
    ['voucher_redeem_synced_at', 'TEXT'],
    // Whether the guest pays the rise since the voucher was bought, and what the
    // club's list said the voucher was paid for. 0/NULL on a migrated row means
    // the club ate that rise, which is exactly how it worked until now.
    ['voucher_topup', 'INTEGER DEFAULT 0'],
    ['voucher_amount', 'REAL'],
  ]
  for (const [name, type] of added) {
    if (!existing.has(name)) db.exec(`ALTER TABLE registrations ADD COLUMN ${name} ${type}`)
  }

  // `address` was replaced by street/postal_code/city, and `signature_png` by
  // contract_pdf_filename (a generated PDF replaces the raw signature image).
  // Dropping both gives a migrated database the same column set as a freshly
  // created one.
  if (existing.has('address')) db.exec('ALTER TABLE registrations DROP COLUMN address')
  if (existing.has('signature_png')) db.exec('ALTER TABLE registrations DROP COLUMN signature_png')
}
