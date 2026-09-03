// =======================================================================================
// HTTP DATA LAYER (web/js/net/api.ts)
// =======================================================================================
//
// Network transport layer communicating with the backend API (`/api/state`, `/api/mutate`).
//
// Responsibilities:
// 1. JSON Fetch Client: Provides `apiGet` and `apiPost` HTTP wrappers with error handling.
// 2. Boundary Validation: Enforces structural integrity on incoming JSON payloads (`validateData`)
//    before state reaches reactive store consumers.
// 3. State Normalization: Guarantees default values for revision numbers and audit logs.
//
// =======================================================================================

import type { ServerData } from '../../../shared/types.ts';

/** Same-origin base API path. */
export const API = '';

/** Fetch API interface for dependency injection in tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Performs an HTTP GET request and parses the JSON response body.
 */
export async function apiGet(path: string, fetchFn: FetchLike = fetch): Promise<unknown> {
  const response = await fetchFn(API + path);
  if (!response.ok) throw new Error('Server ' + response.status);
  return response.json();
}

/**
 * Performs an HTTP POST request with a JSON request body and parses the response.
 */
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
 * Validates the structural integrity of the application state payload received from the server.
 * Throws an error if required root arrays/objects (`machines`, `bookings`) are missing.
 */
export function validateData(data: unknown): ServerData {
  if (!data || typeof data !== 'object') throw new Error('kein JSON-Objekt');
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.machines)) throw new Error('machines fehlt/ungültig');
  if (!record.bookings || typeof record.bookings !== 'object') {
    throw new Error('bookings fehlt/ungültig');
  }
  record.log = Array.isArray(record.log) ? record.log : [];
  if (typeof record.revision !== 'number') record.revision = 0;
  return record as unknown as ServerData;
}

/**
 * Normalizes raw `/api/state` response into a clean `ServerData` structure.
 */
export function normalizeState(rawState: unknown): ServerData {
  const record = rawState as Record<string, unknown>;
  record.revision = (record.rev as number) || 0;
  record.log = (record.log as unknown[]) || [];
  return validateData(record);
}

/**
 * Fetches and validates the full team-wide application state from `/api/state`.
 */
export async function readFile(): Promise<ServerData> {
  return normalizeState(await apiGet('/api/state'));
}
