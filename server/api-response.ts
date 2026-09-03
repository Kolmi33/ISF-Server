// =======================================================================================
// API RESPONSE MODULE (server/api-response.ts)
// =======================================================================================
//
// The REST API's response envelope. `/api/v1/*` responses use this consistent shape; the
// existing `/api/state`/`/api/mutate` trio is untouched and keeps its own `{error: string}`-
// only shape (see PROGRESS.md's Phase 9 plan for why the two don't merge).
//
// This module provides:
// 1. `apiSuccess` — the `{ data: <payload> }` envelope, `meta` included only when given.
// 2. `apiError` — the `{ error: <human message>, code: <machine-readable>, details?: <unknown> }`
//    envelope. `error` stays a plain string so anything that already does
//    `errorMessage(response.error)`-style display keeps working unmodified; `code` is new, for
//    programmatic `/api/v1/*` consumers to branch on without parsing prose.
//
// =======================================================================================

import type { ApiResponse } from './api-router.js';

/** The closed set of machine-readable error codes `/api/v1/*` responses use. Deliberately small —
 *  add to this list only when a genuinely distinct client-handling case shows up, not per-endpoint. */
export type ApiErrorCode =
  'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'PRECONDITION_FAILED' | 'INTERNAL';

/** A successful `/api/v1/*` response: `data` under its own key, `status` defaulting to 200 (pass
 *  201/204/etc. explicitly for create/delete). `meta` is included only when given (e.g. a
 *  cursor-pagination `{nextCursor}`) — omitted entirely, not present as an explicit
 *  `undefined`, matching `apiError`'s `details`. */
export function apiSuccess(
  data: unknown,
  status = 200,
  meta?: Record<string, unknown>,
): ApiResponse {
  const body: { data: unknown; meta?: Record<string, unknown> } = { data };
  if (meta !== undefined) body.meta = meta;
  return { status, body };
}

/** An error `/api/v1/*` response. `details` is included only when given — never present as an
 *  explicit `undefined`, so a plain `JSON.stringify` round-trip and an `'details' in body` check
 *  agree with each other. */
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): ApiResponse {
  const body: { error: string; code: ApiErrorCode; details?: unknown } = { error: message, code };
  if (details !== undefined) body.details = details;
  return { status, body };
}
