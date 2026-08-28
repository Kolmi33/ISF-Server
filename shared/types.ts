// The domain contract: shapes that both the frontend and (from Phase 6) the backend
// share. Single source of truth (ARCHITECTURE §5). It grows as extraction surfaces more
// fields — every field here is one the code actually reads, kept faithful to the data.

/**
 * A maintenance or defect window on a machine. `from`/`until` are inclusive ISO date
 * strings ('YYYY-MM-DD'); an empty or absent bound means open-ended on that side.
 */
export interface MaintSlot {
  /** Free-form status, e.g. 'wartung' | 'defekt' — preserved verbatim from the data. */
  type: string;
  from?: string;
  until?: string;
  note?: string;
}

/** A bookable resource — a machine or a measurement device ('messtechnik'). */
export interface Machine {
  id: string;
  name: string;
  group: string;
  /** 'messtechnik' marks a measurement device; absent or anything else means 'maschine'. */
  cat?: string;
  /** 7-char Mo..So availability mask ('1' = available). Absent = available every day. */
  days?: string;
  /** Structured maintenance slots (the newer form). */
  maint?: MaintSlot[];
  /** Legacy single-status form; synthesized into a MaintSlot when no `maint` array exists. */
  status?: string;
  statusFrom?: string;
  statusUntil?: string;
  statusNote?: string;
  info?: string;
}

/** A machine's resource category, as returned by `catOf`. */
export type MachineCategory = 'messtechnik' | 'maschine';

/** A single booked day: who booked it (and when it was written). */
export interface Booking {
  name: string;
  ts?: string;
}

/** One machine's bookings, keyed by ISO date 'YYYY-MM-DD'. */
export type MachineBookings = Record<string, Booking>;

/** All bookings, keyed by machine id → that machine's bookings. */
export type Bookings = Record<string, MachineBookings>;

/** The subset of app state the pure booking/weekend logic reads. */
export interface BookingData {
  machines: Machine[];
  bookings: Bookings;
}

/** One audit-log line the client keeps in memory (newest first, capped at 500). */
export interface LogEntry {
  ts: string;
  user: string;
  action: string;
}

/**
 * The team-wide state mirrored from `/api/state`. On the wire the server sends
 * `{ rev, groups, machines, bookings }`; the client normalizes `revision = rev || 0`
 * and carries an in-memory `log` (see legacy `loadState`). Kept faithful to that shape.
 */
export interface ServerData extends BookingData {
  groups: string[];
  /** Server's monotonic revision under its wire name; present on server responses. */
  rev?: number;
  /** Client-normalized revision (`= rev || 0`). */
  revision: number;
  log: LogEntry[];
}

/**
 * The complete frontend runtime state — the object legacy code knows as the global `S`.
 * The store (`web/js/state.ts`) owns it; `app.ts` bridges it as `window.S` during the
 * strangler transition. Shape kept byte-identical to legacy `S` (ARCHITECTURE §14 D4),
 * including the now-dead `lastRaw` (removed with the rest of the FS-era code in Phase 5).
 */
export interface AppState {
  /** Server data (`/api/state`); `null` until the first load completes. */
  data: ServerData | null;
  readOnly: boolean;
  user: string;
  /** Monday of the currently displayed week block (a local-calendar `Date`). */
  startMonday: Date;
  /** Base weeks shown; further weeks auto-append while scrolling right. */
  weeks: number;
  extraWeeks: number;
  /** Machine-id filter (empty = all). */
  machSel: Set<string>;
  /** Group filter (empty = all). */
  groupsSel: Set<string>;
  /** Visible top-level categories, e.g. 'maschine' | 'messtechnik'. */
  cats: Set<string>;
  /** Collapsed group ids. */
  collapsed: Set<string>;
  /** Person filter (highlight). */
  person: string;
  /** Show only this person's rows. */
  personOnly: boolean;
  /** Favorite machine ids. */
  favs: Set<string>;
  /** Currently rendered machine ids (rows). */
  visM: string[];
  /** Currently rendered dates (columns), ISO 'YYYY-MM-DD'. */
  visD: string[];
  /** Raw snapshot for auto-refresh change detection (FS-era; dead — removed in Phase 5). */
  lastRaw: string;
}
