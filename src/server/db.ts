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
      first_name TEXT, last_name TEXT, age INTEGER, weight_kg INTEGER,
      address TEXT, email TEXT, phone TEXT, signature_png TEXT,
      accepted_terms INTEGER,
      tandem_master_id INTEGER, load_number INTEGER, price REAL,
      payment_method TEXT, extra_booking TEXT, camera_flyer_id INTEGER,
      created_at TEXT, jump_date TEXT
    );
    CREATE TABLE IF NOT EXISTS tandem_masters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS camera_flyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  return db
}
