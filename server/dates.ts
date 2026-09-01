// dates.ts — the backend's own tiny UTC date helpers.
//
// Deliberately separate from web/js/core/dates.ts: the frontend (Vite-bundled, imports
// .ts sources directly) and the backend (tsc-compiled to plain .js, zero runtime deps,
// NodeNext module resolution) are different build targets with no shared *runtime*
// module today — shared/types.ts only ever carried type-only declarations, which compile
// away and cost nothing to share, but a real function body would need build-config work
// on both sides to actually share (see ARCHITECTURE_AUDIT.md §9/F2). This file exists so
// that work stays a single, explicit, backend-local decision instead of every server
// module growing its own private copy — which is what had happened before this file
// existed (`server/bridge.ts` and `server/server.ts` each defined their own). Named the
// same way as the frontend's `core/dates.ts` for a reader moving between them; kept to
// only what `server/*.ts` actually needs.

/** 'YYYY-MM-DD' → a Date at UTC midnight of that day. */
export function parseIsoDateString(isoDateString: string): Date {
  return new Date(isoDateString + 'T00:00:00Z');
}

/** A Date → its UTC calendar day as 'YYYY-MM-DD'. */
export function formatDateAsIsoString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A new Date `numberOfDays` calendar days after `date` (UTC). Does not mutate `date`. */
export function addDays(date: Date, numberOfDays: number): Date {
  return new Date(date.getTime() + numberOfDays * 86400000);
}
