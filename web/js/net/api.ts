// The HTTP data layer — talks to the Node/SQLite backend (/api/state, /api/mutate).
// Same-origin (empty base). Extracted from the legacy backend adapter (Phase 3.2); the
// live SSE connection is a separate concern that lands in net/sse.ts (3.3).
//
// `fetch` is injected (E4) so the client is unit-testable in Node without a network;
// app.ts bridges these onto `window` and legacy calls them as before (global `fetch`
// default). The response-shaping helpers (`validateData`, `normalizeState`) are pure
// faithful ports of the legacy `validateData`/`readFile` normalization.

import type { ServerData } from '../../../shared/types.ts';

/** Same origin as the served page (legacy `const API = ''`). */
export const API = '';

/** The slice of the Fetch API this layer needs; injectable for tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** GET `path` as JSON; throws `Server <status>` on a non-2xx response. */
export async function apiGet(path: string, fetchFn: FetchLike = fetch): Promise<unknown> {
  const response = await fetchFn(API + path);
  if (!response.ok) throw new Error('Server ' + response.status);
  return response.json();
}

/** POST `body` as JSON to `path`; returns the parsed JSON response. */
export async function apiPost(
  path: string,
  body: unknown,
  fetchFn: FetchLike = fetch,
): Promise<unknown> {
  const response = await fetchFn(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

/**
 * Structural integrity check for a state payload (faithful port of legacy `validateData`):
 * `machines` must be an array and `bookings` an object, else throw; `log` is coerced to an
 * array and `revision` to a number. Mutates and returns the given object.
 */
export function validateData(data: unknown): ServerData {
  if (!data || typeof data !== 'object') throw new Error('kein JSON-Objekt');
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.machines)) throw new Error('machines fehlt/ungültig');
  if (!record.bookings || typeof record.bookings !== 'object') {
    throw new Error('bookings fehlt/ungültig');
  }
  record.log = Array.isArray(record.log) ? record.log : [];
  if (typeof record.revision !== 'number') record.revision = 0; // Alt-Dateien ohne Revision
  return record as unknown as ServerData;
}

/**
 * Normalize a raw `/api/state` payload into `ServerData` (faithful port of legacy
 * `readFile`'s post-fetch step): carry the server's `rev` into the client field
 * `revision` (`rev || 0`), default `log`, then validate.
 */
export function normalizeState(rawState: unknown): ServerData {
  const record = rawState as Record<string, unknown>;
  record.revision = (record.rev as number) || 0;
  record.log = (record.log as unknown[]) || [];
  return validateData(record);
}
