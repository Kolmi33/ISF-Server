// import.ts — one-off seed of the SQLite DB from an existing buchungen.json.
// Usage:  node dist/server/import.js [path/to/buchungen.json] [--force]
// Faithful port of src/import.mjs.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, importFromJson } from './db.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dir, '..', 'data', 'buchungen.db');
const force = process.argv.includes('--force');
const src =
  process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) ||
  process.env.IMPORT_JSON ||
  join(dirname(DB_PATH), 'buchungen.json');

const db = openDb(DB_PATH);
const r = importFromJson(db, src, { force });
if (r.skipped)
  console.log(`Übersprungen — DB hat bereits ${r.machines} Maschinen (mit --force überschreiben).`);
else console.log(`Importiert: ${r.machines} Maschinen, ${r.bookings} Buchungen → ${DB_PATH}`);
db.close();
