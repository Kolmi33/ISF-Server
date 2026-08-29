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
import type { MutateBody } from './types.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || join(__dir, '..', 'data', 'buchungen.db');
const IMPORT_JSON = process.env.IMPORT_JSON || join(dirname(DB_PATH), 'buchungen.json');
const BACKUP_DIR = process.env.BACKUP_DIR || join(dirname(DB_PATH), 'backups');
const BACKUP_KEEP = parseInt(process.env.BACKUP_KEEP || '30');
const PUBLIC_DIR = join(__dir, '..', 'public');
const BUNDLED_JSON = join(__dir, '..', 'buchungen.json'); // shipped in the image (Dockerfile copies it)

const db = openDb(DB_PATH);
// First-run seed: DB empty? Import from the volume (/data/buchungen.json), else from the
// image-bundled buchungen.json (no docker cp needed).
try {
  const seedPath = existsSync(IMPORT_JSON)
    ? IMPORT_JSON
    : existsSync(BUNDLED_JSON)
      ? BUNDLED_JSON
      : IMPORT_JSON;
  const r = importFromJson(db, seedPath);
  if (r && !r.skipped)
    log('Import', `Erstimport (${seedPath}): ${r.machines} Maschinen, ${r.bookings} Buchungen`);
} catch (e) {
  if (existsSync(IMPORT_JSON) || existsSync(BUNDLED_JSON))
    console.error('Import fehlgeschlagen:', (e as Error).message);
}

// ---------- helpers ----------
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

// ---------- SSE clients ----------
const clients = new Set<ServerResponse>();
const clientNames = new Map<ServerResponse, string>(); // res -> user name (for presence)
function presenceUsers(): string[] {
  return [...new Set([...clientNames.values()].filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'de'),
  );
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
  broadcast('presence', { n: clients.size, users: presenceUsers() });
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
    const name = `buchungen_${ymd(new Date())}.db`;
    const dest = join(BACKUP_DIR, name);
    if (!existsSync(dest)) {
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); // clean consistent copy, safe while running
      const olds = readdirSync(BACKUP_DIR)
        .filter((n) => /^buchungen_\d{4}-\d{2}-\d{2}\.db$/.test(n))
        .sort();
      for (const n of olds.slice(0, -BACKUP_KEEP)) {
        try {
          rmSync(join(BACKUP_DIR, n));
        } catch {
          /* ignore */
        }
      }
      console.log('Backup:', dest);
    }
  } catch (e) {
    console.error('Backup fehlgeschlagen:', (e as Error).message);
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
function readBody(req: IncomingMessage): Promise<MutateBody | null> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 1e6) {
        req.destroy();
        resolve(null);
      } // overflow: finish immediately (no hanging handler)
    });
    req.on('end', () => {
      try {
        resolve(b ? (JSON.parse(b) as MutateBody) : {});
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
  const hb = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* dropped */
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(hb);
    clients.delete(res);
    clientNames.delete(res);
    sendPresence();
  });
}

async function serveStatic(res: ServerResponse, p: string): Promise<void> {
  const file = p === '/' ? '/index.html' : p;
  if (file.includes('..')) return send(res, 400, { error: 'bad path' });
  const abs = join(PUBLIC_DIR, file);
  try {
    const data = await readFile(abs);
    res
      .writeHead(200, { 'Content-Type': MIME[extname(abs)] || 'application/octet-stream' })
      .end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/health')
      return send(res, 200, {
        ok: true,
        rev: parseInt(getMeta(db, 'revision') || '0') || 0,
        clients: clients.size,
      });
    if (p === '/api/state') return send(res, 200, getState(db));
    if (p === '/api/stream') return openStream(req, res, url);
    if (req.method === 'POST' && p === '/api/mutate') {
      const body = await readBody(req);
      if (body === null) return send(res, 400, { error: 'Ungültige oder zu große Anfrage' });
      const out = applyMutate(db, body, broadcast);
      return send(res, out.error ? 400 : 200, out);
    }
    return serveStatic(res, p);
  } catch (e) {
    console.error(e);
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
