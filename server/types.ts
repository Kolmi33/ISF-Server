// Backend-internal row shapes (the SQLite column layout) and the mutate request body.
// The *wire* shapes the API emits (Machine/Booking/ServerData) live in shared/types.ts;
// these are the storage-side types, kept faithful to the columns in db.ts's SCHEMA.

/** A row of the `machines` table. Column `grp` is the group (SQL-reserved `group`). */
export interface MachineRow {
  id: string;
  name: string;
  grp: string | null;
  cat: string | null;
  status: string | null;
  statusNote: string | null;
  statusFrom: string | null;
  statusUntil: string | null;
  info: string | null;
  redu: string | null;
  days: string | null;
  /** Maintenance slots as a JSON string, or null. */
  maint: string | null;
  sort: number | null;
}

/** A row of the `bookings` table (primary key `(mid, day)`). */
export interface BookingRow {
  mid: string;
  day: string;
  name: string;
  note: string | null;
  ts: string | null;
  gid: string | null;
  gtitle: string | null;
}

/** A row of the `log` table (activity log — `id` is the autoincrement, also the REST
 *  activity endpoint's pagination cursor). */
export interface LogRow {
  id: number;
  ts: string | null;
  user: string | null;
  action: string | null;
}

/** A machine as emitted on the wire (`group`, not the SQL column `grp`). */
export interface MachineOut {
  id: string;
  name: string;
  group: string | null;
  status: string;
  statusNote: string;
  info: string;
  cat?: string;
  statusFrom?: string;
  statusUntil?: string;
  redu?: string;
  days?: string;
  maint?: unknown[];
}

/** A booking as emitted on the wire. */
export interface BookingOut {
  name: string;
  ts: string | null;
  note?: string;
  gid?: string;
  gtitle?: string;
}

/** The full read model returned by `/api/state`. */
export interface StateOut {
  rev: number;
  groups: string[];
  machines: MachineOut[];
  bookings: Record<string, Record<string, BookingOut>>;
}

/** One cell in a cell-delta mutate: prev/val are the client's compare-and-set pair. */
export interface CellDelta {
  machineId: string;
  day: string;
  prev?: { name?: string } | null;
  val?: { name?: string; note?: string; ts?: string; gid?: string; gtitle?: string } | null;
}

/** The `/api/mutate` request body: either a cell-delta or a full structural machine list. */
export interface MutateBody {
  cells?: CellDelta[];
  machines?: unknown[];
  groups?: unknown[];
  log?: string;
  user?: string;
}

/** A day that could not be written (already booked by someone else, or blocked). */
export interface MutateConflict {
  machineId: string;
  day: string;
  by: string;
}

/** A cell that changed, broadcast to SSE clients (`val:null` = deleted). */
export interface MutateChange {
  machineId: string;
  day: string;
  val: BookingOut | null;
}

/** The result of {@link applyMutate}: an error, or an ok result with the new revision. */
export interface MutateResult {
  error?: string;
  ok?: boolean;
  rev?: number;
  structural?: boolean;
  applied?: number;
  conflicts?: MutateConflict[];
}
