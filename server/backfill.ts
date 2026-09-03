// =======================================================================================
// BACKFILL CLI (server/backfill.ts)
// =======================================================================================
//
// One-time weekend-bridge backfill. Usage: `node dist/server/backfill.js`.
//
// Inserts every missing Sat/Sun bridge across the DB in a single transaction (internal
// SQL, not subject to the REST API's 1000-cell batch cap) via `bridge.ts`'s
// `backfillBridges`. This is a PRODUCTION DATA WRITE when pointed at the live DB — run it
// deliberately (a daily VACUUM backup exists; the client sweep removes bridges again if a
// series later breaks).
//
// =======================================================================================
import { openDb } from './db.js';
import { backfillBridges } from './bridge.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(currentDirectory, '..', 'data', 'buchungen.db');

const db = openDb(DB_PATH);
const insertedBridgeCount = backfillBridges(db);
console.log(`Weekend-Bridges eingefügt: ${insertedBridgeCount} → ${DB_PATH}`);
db.close();
