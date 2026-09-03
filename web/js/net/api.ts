// =======================================================================================
// HTTP DATA LAYER (web/js/net/api.ts)
// =======================================================================================
//
// Talks to the Node/SQLite backend's `/api/state` and `/api/mutate` endpoints (same-origin,
// empty base URL — the SPA is always served from the same host as its API).
// This module provides:
// 1. `apiGet`/`apiPost`: thin JSON fetch wrappers.
// 2. `validateData`/`normalizeState`/`readFile`: shape and validate a raw `/api/state`
//    payload into the `ServerData` the rest of the app expects.
//
// Key Principles:
// - INJECTED FETCH: `fetch` is an optional parameter defaulting to the global (E4), so this
//   layer is unit-testable in Node without a real network; `app.ts` calls it with the
//   ambient `window.fetch`.
// - VALIDATE AT THE BOUNDARY: `validateData` is the one place that trusts (or rejects) a
//   server payload's shape, so every other module downstream can assume `ServerData` is
//   well-formed without re-checking it.
//
// =======================================================================================

import type { ServerData } from '../../../shared/types.ts';

/** Same origin as the served page — the SPA never calls a different host's API. */
export const API = '';

/** The slice of the Fetch API this layer needs; injectable for tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** GETs `path` and parses the response as JSON; throws `Server <status>` on a non-2xx
 *  response, so a caller's `catch` block always sees a human-readable status. */
export async function apiGet(path: string, fetchFn: FetchLike = fetch): Promise<unknown> {
  const response = await fetchFn(API + path);
  if (!response.ok) throw new Error('Server ' + response.status);
  return response.json();
}

/** POSTs `body` as JSON to `path` and returns the parsed JSON response. */
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
 * Structural integrity check for a state payload.
 *
 * How it works: `machines` must be an array and `bookings` an object, or this throws
 * immediately — those two fields are load-bearing for the whole app, so a malformed
 * payload should fail loudly at the boundary rather than crash somewhere deep inside a
 * component later. `log` is coerced to an array and `revision` to a number rather than
 * thrown on, since a missing/wrong-typed value there just means "no history yet" /
 * "unversioned", not corrupt data. Mutates and returns the given object.
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
 * Normalizes a raw `/api/state` payload into `ServerData`.
 *
 * How it works: carries the server's wire field `rev` into the client's own `revision`
 * field (`rev || 0`, so a missing/zero revision reads as 0, not `undefined`), defaults
 * `log` to an empty array, then runs {@link validateData} on the result.
 */
export function normalizeState(rawState: unknown): ServerData {
  const record = rawState as Record<string, unknown>;
  record.revision = (record.rev as number) || 0;
  record.log = (record.log as unknown[]) || [];
  return validateData(record);
}

/** Fetches and normalizes the full server state — the one call the app's boot sequence
 *  makes to get its initial `ServerData`. */
export async function readFile(): Promise<ServerData> {
  return normalizeState(await apiGet('/api/state'));
}
