// =======================================================================================
// IMPORT CLI (server/import.ts)
// =======================================================================================
//
// One-off seed of the SQLite DB from an existing buchungen.json.
// Usage: `node dist/server/import.js [path/to/buchungen.json] [--force]`.
//
// Resolves the seed path (CLI arg, then `IMPORT_JSON`, then the conventional path next to
// the DB) and hands it to `db.ts`'s `importFromJson`, which is idempotent by default
// (skips a DB that already has machines) unless `--force` is given.
//
// =======================================================================================
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, importFromJson } from './db.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(currentDirectory, '..', 'data', 'buchungen.db');
const force = process.argv.includes('--force');

// Three-way fallback for the seed file path: an explicit CLI argument, then the
// IMPORT_JSON env var, then the conventional path next to the DB.
const firstPositionalArg = process.argv.find((arg, index) => index >= 2 && !arg.startsWith('--'));
const seedJsonPath =
  firstPositionalArg || process.env.IMPORT_JSON || join(dirname(DB_PATH), 'buchungen.json');

const db = openDb(DB_PATH);
const importResult = importFromJson(db, seedJsonPath, { force });
if (importResult.skipped) {
  console.log(
    `Übersprungen — DB hat bereits ${importResult.machines} Maschinen (mit --force überschreiben).`,
  );
} else {
  console.log(
    `Importiert: ${importResult.machines} Maschinen, ${importResult.bookings} Buchungen → ${DB_PATH}`,
  );
}
db.close();
