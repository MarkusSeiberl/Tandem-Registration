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
      email TEXT, phone TEXT, signature_png TEXT,
      accepted_terms INTEGER,
      tandem_master_id INTEGER, load_number INTEGER, price REAL,
      payment_method TEXT, voucher_number TEXT, extra_booking TEXT,
      camera_flyer_id INTEGER,
      created_at TEXT, jump_date TEXT
    );
    CREATE TABLE IF NOT EXISTS tandem_masters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS camera_flyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
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
  ]
  for (const [name, type] of added) {
    if (!existing.has(name)) db.exec(`ALTER TABLE registrations ADD COLUMN ${name} ${type}`)
  }

  // `address` was replaced by street/postal_code/city. Dropping it gives a
  // migrated database the same set of columns as a freshly created one (the
  // order still differs — ALTER TABLE appends), so `SELECT *` cannot hand the
  // manifest a stale column that no longer has a UI or an export mapping.
  if (existing.has('address')) db.exec('ALTER TABLE registrations DROP COLUMN address')
}
