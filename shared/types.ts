// =======================================================================================
// DOMAIN DATA CONTRACTS (shared/types.ts)
// =======================================================================================
//
// Core domain interfaces and data shapes shared verbatim across frontend and backend.
//
// Architecture & Data Flow:
// 1. Storage & Wire Model: BookingData and ServerData represent the persisted state stored
//    in SQLite on the server and synchronized to the browser via `/api/state` and SSE push.
// 2. Resource Hierarchy: Machines belong to Groups (e.g. "Fräsen", "Drehen") and Categories
//    ('maschine' | 'messtechnik').
// 3. Grid Coordinates: Bookings are indexed in a 2D map: bookings[machineId][isoDate] = Booking.
// 4. Runtime Store: AppState represents the complete client-side application state,
//    combining server data with local UI filters, pagination, and user preferences.
//
// =======================================================================================

/**
 * A scheduled maintenance or defect window on a machine.
 *
 * Date Bounds:
 * - `from` and `until` are inclusive ISO date strings ('YYYY-MM-DD').
 * - An empty or omitted bound represents an open-ended window (no start or end date).
 */
export interface MaintSlot {
  /** The status/type label, e.g. 'wartung' (maintenance) or 'defekt' (breakdown). */
  type: string;
  /** Start date of maintenance in ISO format 'YYYY-MM-DD'. */
  from?: string;
  /** End date of maintenance in ISO format 'YYYY-MM-DD'. */
  until?: string;
  /** Optional descriptive note or reason for the maintenance. */
  note?: string;
}

/** Explicit domain alias for MaintSlot. */
export type MaintenanceSlot = MaintSlot;

/**
 * A bookable resource (machine or measurement device).
 */
export interface Machine {
  /** Unique, URL-safe identifier (e.g. 'dmu-50' or 'm_k8f92a'). */
  id: string;
  /** Display name shown in UI headers and table rows (e.g. "5-Achs Fräse DMU 50"). */
  name: string;
  /** Group / department name (e.g. "Fräsen", "Drehen", "Messtechnik"). */
  group: string;
  /** Category marker: 'messtechnik' for measurement tools; absent defaults to 'maschine'. */
  cat?: string;
  /** 7-character Mo..So availability mask ('1' = available, '0' = off). */
  days?: string;
  /** Structured maintenance and defect date ranges. */
  maint?: MaintSlot[];
  /** Redundancy marker label used for machine substitution in the Assistant. */
  redu?: string;
  /** Legacy single-status field; synthesized into maint when maint is missing. */
  status?: string;
  statusFrom?: string;
  statusUntil?: string;
  statusNote?: string;
  /** Free-form descriptive information or notes about the machine. */
  info?: string;
}

/** Resource category identifier: 'maschine' (production machine) or 'messtechnik' (measurement). */
export type MachineCategory = 'messtechnik' | 'maschine';

/**
 * A single booked cell representing a machine reservation on a specific calendar day.
 */
export interface Booking {
  /** Name of the person who booked the cell. */
  name: string;
  /** ISO timestamp when the reservation was created. */
  ts?: string;
  /** Optional description or project note for this booking. */
  note?: string;
  /** Booking group ID, shared across multiple cells booked together. */
  gid?: string;
  /** Optional title for the entire booking group (e.g. "Projekt Alpha"). */
  gtitle?: string;
}

/** A single machine's bookings, indexed by ISO date ('YYYY-MM-DD'). */
export type MachineBookings = Record<string, Booking>;

/** Full matrix of all bookings across all machines: `bookings[machineId][isoDate] = Booking`. */
export type Bookings = Record<string, MachineBookings>;

/**
 * The core domain dataset required for calendar computations and business rules.
 */
export interface BookingData {
  machines: Machine[];
  bookings: Bookings;
}

/**
 * An audit log entry recording a user action (e.g. booking, deletion, machine edit).
 */
export interface LogEntry {
  ts: string;
  user: string;
  action: string;
}

/**
 * The authoritative dataset received from the server (`/api/state`).
 */
export interface ServerData extends BookingData {
  /** Ordered list of distinct group names. */
  groups: string[];
  /** Monotonic revision number from the server used for optimistic concurrency control. */
  rev?: number;
  /** Normalized client revision number. */
  revision: number;
  /** In-memory audit log entries (newest first, capped at 500). */
  log: LogEntry[];
}

/**
 * The complete frontend application runtime state managed by the reactive Store.
 */
export interface AppState {
  /** Server data payload; null until the initial load completes. */
  data: ServerData | null;
  /** When true, editing actions are disabled (e.g. for guest / read-only views). */
  readOnly: boolean;
  /** Current user's name entered in the UI. */
  user: string;
  /** Monday of the currently focused week block. */
  startMonday: Date;
  /** Number of base weeks visible on the screen. */
  weeks: number;
  /** Additional weeks appended dynamically during infinite horizontal scrolling. */
  extraWeeks: number;
  /** Filter: selected machine IDs (empty Set = show all). */
  machSel: Set<string>;
  /** Filter: selected group names (empty Set = show all). */
  groupsSel: Set<string>;
  /** Filter: visible top-level categories (e.g. 'maschine', 'messtechnik'). */
  cats: Set<string>;
  /** Collapsed group names. */
  collapsed: Set<string>;
  /** Filter: person name highlight. */
  person: string;
  /** Filter: when true, hides all rows not booked by the selected person. */
  personOnly: boolean;
  /** Set of favorite machine IDs pinned for quick navigation. */
  favs: Set<string>;
  /** IDs of currently visible machine rows in top-to-bottom rendering order. */
  visM: string[];
  /** ISO dates of currently visible calendar day columns in left-to-right order. */
  visD: string[];
}
