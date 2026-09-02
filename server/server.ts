// server.ts — zero-dependency HTTP API + Server-Sent-Events for the machine plan.
// Node >= 22 (uses the built-in node:sqlite). This is the impure entry shell: HTTP,
// SSE, the daily backup, and the first-run seed. All domain logic lives in the pure
// modules it imports (db / model / mutate), which are unit-tested; this shell is
// verified by running it (E5). Faithful port of the top-level of src/server.mjs.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getMeta, importFromJson } from './db.js';
import { getState } from './model.js';
import { applyMutate } from './mutate.js';
import { formatDateAsIsoString } from '../shared/dates.js';
import type { MutateBody } from './types.js';
import { findRoute, type ApiRoute } from './api-router.js';
import { apiError } from './api-response.js';
import { listMachines, getMachine } from './api-machines.js';
import { listMachineBookings, getMachineBooking, listBookingsByGroup } from './api-bookings.js';
import { listActivity } from './api-activity.js';
import { createMachine, updateMachine, deleteMachine, moveMachine } from './api-machines-write.js';
import { putBooking, deleteBooking, batchBook, batchDelete } from './api-bookings-write.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || join(currentDirectory, '..', 'data', 'buchungen.db');
const IMPORT_JSON = process.env.IMPORT_JSON || join(dirname(DB_PATH), 'buchungen.json');
const BACKUP_DIR = process.env.BACKUP_DIR || join(dirname(DB_PATH), 'backups');
const BACKUP_KEEP = parseInt(process.env.BACKUP_KEEP || '30');
const WEEKEND_BRIDGE = process.env.WEEKEND_BRIDGE !== 'off'; // 6.3 maintain hook (on unless disabled)
const PUBLIC_DIR = join(currentDirectory, '..', 'public');
const BUNDLED_JSON = join(currentDirectory, '..', 'buchungen.json'); // shipped in the image (Dockerfile copies it)

const db = openDb(DB_PATH);

// ---------- REST API (Phase 9) — a second entrance onto the same data, not a second write
// engine: every write route below still goes through `mutate.ts`'s single `applyMutate` path,
// alongside the existing /api/state, /api/mutate, /api/stream trio the live grid itself uses
// (see PROGRESS.md's Phase 9 plan for why the two don't merge).
const apiV1Routes: ApiRoute[] = [
  { method: 'GET', pattern: '/api/v1/machines', handler: (_params, url) => listMachines(db, url) },
  {
    method: 'GET',
    pattern: '/api/v1/machines/:id',
    handler: (params) => getMachine(db, params.id!),
  },
  {
    method: 'GET',
    pattern: '/api/v1/machines/:id/bookings',
    handler: (params, url) => listMachineBookings(db, params.id!, url),
  },
  {
    method: 'GET',
    pattern: '/api/v1/machines/:id/bookings/:date',
    handler: (params) => getMachineBooking(db, params.id!, params.date!),
  },
  {
    method: 'GET',
    pattern: '/api/v1/bookings',
    handler: (_params, url) => listBookingsByGroup(db, url),
  },
  { method: 'GET', pattern: '/api/v1/activity', handler: (_params, url) => listActivity(db, url) },
  // ---- writes (Phase 9e/9f) — every one of these funnels into `mutate.ts`'s single
  // `applyMutate` write path; see `api-machines-write.ts`/`api-bookings-write.ts` headers.
  {
    method: 'POST',
    pattern: '/api/v1/machines',
    handler: (_params, _url, body) => createMachine(db, body, broadcast),
  },
  {
    method: 'PUT',
    pattern: '/api/v1/machines/:id',
    handler: (params, _url, body) => updateMachine(db, params.id!, body, broadcast),
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/machines/:id',
    handler: (params, _url, body) => deleteMachine(db, params.id!, body, broadcast),
  },
  {
    method: 'POST',
    pattern: '/api/v1/machines/:id/move',
    handler: (params, _url, body) => moveMachine(db, params.id!, body, broadcast),
  },
  {
    method: 'PUT',
    pattern: '/api/v1/machines/:id/bookings/:date',
    handler: (params, _url, body, headers) =>
      putBooking(db, params.id!, params.date!, body, headers, broadcast),
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/machines/:id/bookings/:date',
    handler: (params, _url, _body, headers) =>
      deleteBooking(db, params.id!, params.date!, headers, broadcast),
  },
  {
    method: 'POST',
    pattern: '/api/v1/bookings/batch',
    handler: (_params, _url, body) => batchBook(db, body, broadcast),
  },
  {
    method: 'POST',
    pattern: '/api/v1/bookings/batch-delete',
    handler: (_params, _url, body) => batchDelete(db, body, broadcast),
  },
];

// First-run seed: DB empty? Import from the volume (/data/buchungen.json), else from the
// image-bundled buchungen.json (no docker cp needed).
try {
  // Prefer the volume-mounted JSON (a previous deployment's data); fall back to the
  // image-bundled JSON (first-ever deploy); if neither exists, use the volume path anyway
  // so the read below fails with a clear "file not found" instead of silently no-op-ing.
  let seedPath = IMPORT_JSON;
  if (!existsSync(IMPORT_JSON) && existsSync(BUNDLED_JSON)) {
    seedPath = BUNDLED_JSON;
  }
  const importResult = importFromJson(db, seedPath);
  if (importResult && !importResult.skipped) {
    log(
      'Import',
      `Erstimport (${seedPath}): ${importResult.machines} Maschinen, ${importResult.bookings} Buchungen`,
    );
  }
} catch (error) {
  if (existsSync(IMPORT_JSON) || existsSync(BUNDLED_JSON)) {
    console.error('Import fehlgeschlagen:', (error as Error).message);
  }
}

// ---------- SSE clients ----------
const clients = new Set<ServerResponse>();
const clientNames = new Map<ServerResponse, string>(); // res -> user name (for presence)
function presenceUsers(): string[] {
  const distinctNames = [...new Set([...clientNames.values()].filter(Boolean))];
  return distinctNames.sort((nameA, nameB) => nameA.localeCompare(nameB, 'de'));
}
function broadcast(event: string, data: unknown): void {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      /* dropped client */
    }
  }
}
function sendPresence(): void {
  broadcast('presence', { clientCount: clients.size, users: presenceUsers() });
}
function log(user: string, action: string): void {
  try {
    db.prepare('INSERT INTO log(ts,user,action) VALUES(?,?,?)').run(
      new Date().toISOString(),
      user || '?',
      action,
    );
  } catch {
    /* best-effort */
  }
}

// ---------- daily backup (protects against corruption / mass-delete) ----------
function runBackup(): void {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const backupFileName = `buchungen_${formatDateAsIsoString(new Date())}.db`;
    const backupPath = join(BACKUP_DIR, backupFileName);
    if (!existsSync(backupPath)) {
      // Single quotes inside a SQLite string literal are escaped by doubling them.
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`); // clean consistent copy, safe while running
      const oldestFirstBackupFileNames = readdirSync(BACKUP_DIR)
        .filter((fileName) => /^buchungen_\d{4}-\d{2}-\d{2}\.db$/.test(fileName))
        .sort();
      // Keep only the newest BACKUP_KEEP files: a negative slice bound drops everything
      // except the last BACKUP_KEEP entries, so this list is everything OLDER than that.
      const filesToDelete = oldestFirstBackupFileNames.slice(0, -BACKUP_KEEP);
      for (const fileName of filesToDelete) {
        try {
          rmSync(join(BACKUP_DIR, fileName));
        } catch {
          /* ignore */
        }
      }
      console.log('Backup:', backupPath);
    }
  } catch (error) {
    console.error('Backup fehlgeschlagen:', (error as Error).message);
  }
}
runBackup();
setInterval(runBackup, 6 * 60 * 60 * 1000); // check every 6h; one file per day

// ---------- HTTP ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
function send(
  res: ServerResponse,
  code: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
/** Read + JSON-parse a request body (shared by `/api/mutate` and every `/api/v1/*` write route)
 *  — `null` means "reject with 400" (overflow or malformed JSON), `{}` an empty-but-valid body.
 *  Deliberately untyped (`unknown`): the caller knows which shape it expects (`MutateBody` for
 *  `/api/mutate`, a REST write's own body type for `/api/v1/*`). */
function readBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    let bodyText = '';
    req.on('data', (chunk) => {
      bodyText += chunk;
      if (bodyText.length > 1e6) {
        req.destroy();
        resolve(null);
      } // overflow: finish immediately (no hanging handler)
    });
    req.on('end', () => {
      try {
        resolve(bodyText ? (JSON.parse(bodyText) as unknown) : {});
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function openStream(req: IncomingMessage, res: ServerResponse, url: URL): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(
    `event: hello\ndata: ${JSON.stringify({ rev: parseInt(getMeta(db, 'revision') || '0') || 0 })}\n\n`,
  );
  clients.add(res);
  clientNames.set(res, (url.searchParams.get('user') || '').trim());
  sendPresence();
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* dropped */
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    clients.delete(res);
    clientNames.delete(res);
    sendPresence();
  });
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const filePath = urlPath === '/' ? '/index.html' : urlPath;
  if (filePath.includes('..')) return send(res, 400, { error: 'bad path' });
  const absolutePath = join(PUBLIC_DIR, filePath);
  try {
    const data = await readFile(absolutePath);
    res
      .writeHead(200, {
        'Content-Type': MIME[extname(absolutePath)] || 'application/octet-stream',
      })
      .end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

async function handleMutatePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  if (body === null) return send(res, 400, { error: 'Ungültige oder zu große Anfrage' });
  const result = applyMutate(db, body as MutateBody, broadcast, WEEKEND_BRIDGE);
  return send(res, result.error ? 400 : 200, result);
}

/** Try the `/api/v1/*` route table; returns whether it handled the request (and already sent
 *  the response), so the caller falls through to static-file serving when it didn't. Split out
 *  purely to keep the main request handler under the complexity budget. Reads + parses the
 *  request body for any non-GET method (a write route's handler ignores it otherwise), rejecting
 *  with the REST error envelope — not `/api/mutate`'s plain `{error}` shape — on malformed JSON. */
async function tryApiV1(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  urlPath: string,
  url: URL,
): Promise<boolean> {
  const match = findRoute(apiV1Routes, method, urlPath);
  if (!match) return false;
  const body = method === 'GET' ? undefined : await readBody(req);
  if (body === null) {
    const parseError = apiError(400, 'VALIDATION', 'Ungültige oder zu große Anfrage');
    send(res, parseError.status, parseError.body);
    return true;
  }
  const response = await match.route.handler(match.params, url, body, req.headers);
  send(res, response.status, response.body, response.headers);
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const urlPath = url.pathname;
  try {
    if (urlPath === '/api/health') {
      return send(res, 200, {
        ok: true,
        rev: parseInt(getMeta(db, 'revision') || '0') || 0,
        clients: clients.size,
      });
    }
    if (urlPath === '/api/state') return send(res, 200, getState(db));
    if (urlPath === '/api/stream') return openStream(req, res, url);
    if (req.method === 'POST' && urlPath === '/api/mutate') return handleMutatePost(req, res);
    if (await tryApiV1(req, res, req.method || 'GET', urlPath, url)) return;
    return serveStatic(res, urlPath);
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: 'Serverfehler' });
  }
});

server.listen(PORT, HOST, () =>
  console.log(`Maschinenplan-Server läuft auf http://${HOST}:${PORT}  (DB: ${DB_PATH})`),
);

// graceful shutdown so the DB closes cleanly
function shutdown(): void {
  console.log('Shutdown …');
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
