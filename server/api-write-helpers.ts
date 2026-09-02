// api-write-helpers.ts — Phase 9e/9f: two tiny pieces every REST write handler in
// `api-machines-write.ts`/`api-bookings-write.ts` needs when reading its untrusted request
// body's generic `user`/`log` fields (the same two fields `/api/mutate` itself accepts) — pulled
// out once so neither file repeats the same inline ternary (and so each caller's own cyclomatic
// complexity stays under budget without the logic actually changing).

/** `value` if it's a non-empty string, else `undefined` — the shape every write handler wants
 *  for an optional passthrough field like `user`. */
export function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** The body's own `log` message if it gave one, else `fallback` — the auto-generated message a
 *  REST write logs when the caller didn't supply their own (tagged `(REST)` so the activity feed
 *  stays honest about where the write came from). */
export function logOrDefault(rawLog: unknown, fallback: string): string {
  return pickString(rawLog) ?? fallback;
}
