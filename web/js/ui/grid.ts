// The grid view layer (Phase 4.1). Starts with the per-cell decision that was duplicated
// between the full renderer `render()` and the targeted `refreshCell()` in legacy: which of
// the four states a cell is in, whether a booking is the current user's, and the resulting
// CSS class stem. These are pure functions of their inputs (DOM-free, unit-tested to 100%),
// so both callers share one source of truth. The HTML/attribute assembly and the DOM writes
// stay in the legacy adapter for now (E3/E5); they legitimately differ per caller (the full
// render carries aria/data attributes and richer titles that the patch path does not).

import type { Booking } from '../../../shared/types.ts';

/** The four mutually exclusive states a grid cell can be in, in priority order. */
export type CellState = 'blocked' | 'booked' | 'unavail' | 'free';

/**
 * Classify a cell. Priority (faithful to legacy): a maintenance/defect block wins, then a
 * booking, then day-unavailability, else free. The impure inputs are injected (E4).
 */
export function classifyCell(
  blocked: boolean,
  booking: Booking | null | undefined,
  available: boolean,
): CellState {
  if (blocked) return 'blocked';
  if (booking) return 'booked';
  if (!available) return 'unavail';
  return 'free';
}

/** Whether a booking name belongs to the current user (case-insensitive; empty user = no). */
export function isMine(user: string, name: string): boolean {
  return !!user && name.toLowerCase() === user.toLowerCase();
}

export interface CellClassOpts {
  /** Only meaningful for the 'booked' state (a booking of the current user). */
  mine?: boolean;
  today?: boolean;
  weekend?: boolean;
}

/**
 * The cell's CSS class stem, e.g. `cell booked mine today`. `mine` applies only to 'booked';
 * `weekend` is added by the full render but not by the patch path — pass it accordingly to
 * preserve that asymmetry (see ARCHITECTURE §15).
 */
export function cellClass(state: CellState, opts: CellClassOpts = {}): string {
  let c = 'cell ' + state;
  if (state === 'booked' && opts.mine) c += ' mine';
  if (opts.today) c += ' today';
  if (opts.weekend) c += ' wknd';
  return c;
}
