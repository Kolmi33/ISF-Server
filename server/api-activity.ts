// =======================================================================================
// API ACTIVITY MODULE (server/api-activity.ts)
// =======================================================================================
//
// GET /api/v1/activity — the activity feed as a REST resource. The `log` table is the one
// genuinely unbounded, append-only collection in this app (unlike `machines`, bounded at a
// few hundred rows, or a single machine's bookings, naturally bounded by a date range) —
// cursor pagination on its own autoincrement `id` is the natural fit, not offset/limit.
//
// =======================================================================================

import type { Db } from './db.js';
import type { LogRow } from './types.js';
import type { ApiResponse } from './api-router.js';
import { apiSuccess, apiError } from './api-response.js';

/** An activity-log entry as emitted on the wire (nulls coalesced to empty strings — the
 *  columns have no NOT NULL constraint, but every writer already supplies real values). */
export interface ActivityEntryOut {
  id: number;
  ts: string;
  user: string;
  action: string;
}

/** Maps one `log` row onto its wire shape, coalescing nulls to empty strings. */
function activityOut(row: LogRow): ActivityEntryOut {
  return { id: row.id, ts: row.ts || '', user: row.user || '', action: row.action || '' };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Parse a required-numeric query param; returns `undefined` when absent, the parsed number
 *  when valid, or `null` to signal "present but invalid" (the caller 400s on `null`). */
function parseOptionalInt(value: string | null): number | null | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * `GET /api/v1/activity`. Newest first (`id DESC`, matching the client's own log display).
 * `?limit=` (default 50, capped at 200), `?cursor=` (the previous page's `meta.nextCursor` —
 * strictly older entries than that id), `?user=` and `?since=` (ISO timestamp, `ts >= since`)
 * as optional filters. `meta.nextCursor` is present only when there's a next page to fetch.
 *
 * How it works: parses and validates `limit`/`cursor` first (400s on a non-integer value for
 * either), builds a `WHERE` clause from whichever of `cursor`/`user`/`since` were given, then
 * fetches `limit + 1` rows in one query — the extra row, if it comes back, proves a next page
 * exists without a second `COUNT` query, and gets sliced back off before the response goes out.
 */
export function listActivity(db: Db, url: URL): ApiResponse {
  const limitParam = parseOptionalInt(url.searchParams.get('limit'));
  if (limitParam === null) return apiError(400, 'VALIDATION', 'limit muss eine ganze Zahl sein.');
  const limit = Math.min(Math.max(limitParam ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const cursor = parseOptionalInt(url.searchParams.get('cursor'));
  if (cursor === null) return apiError(400, 'VALIDATION', 'cursor muss eine ganze Zahl sein.');

  const user = url.searchParams.get('user');
  const since = url.searchParams.get('since');

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (cursor !== undefined) {
    conditions.push('id < ?');
    params.push(cursor);
  }
  if (user) {
    conditions.push('user = ?');
    params.push(user);
  }
  if (since) {
    conditions.push('ts >= ?');
    params.push(since);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Fetch one extra row to know whether a next page exists, without a second COUNT query.
  const rows = db
    .prepare(`SELECT * FROM log ${whereClause} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit + 1) as unknown as LogRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const entries = page.map(activityOut);

  return hasMore
    ? apiSuccess(entries, 200, { nextCursor: page[page.length - 1]!.id })
    : apiSuccess(entries);
}
