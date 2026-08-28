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
