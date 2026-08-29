// backfill.ts — one-time weekend-bridge backfill CLI (Phase 6.3).
// Usage:  node dist/server/backfill.js
// Inserts every missing Sat/Sun bridge across the DB in a single transaction (internal SQL,
// not the 1000-cell API cap). This is a PRODUCTION DATA WRITE when pointed at the live DB —
// run it deliberately (a daily VACUUM backup exists; the client sweep removes bridges again
// if a series later breaks).
import { openDb } from './db.js';
import { backfillBridges } from './bridge.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dir, '..', 'data', 'buchungen.db');

const db = openDb(DB_PATH);
const n = backfillBridges(db);
console.log(`Weekend-Bridges eingefügt: ${n} → ${DB_PATH}`);
db.close();
