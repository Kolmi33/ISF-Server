// The grid view layer (Phase 4.1). Starts with the per-cell decision that was duplicated
// between the full renderer `render()` and the targeted `refreshCell()` in legacy: which of
// the four states a cell is in, whether a booking is the current user's, and the resulting
// CSS class stem. These are pure functions of their inputs (DOM-free, unit-tested to 100%),
// so both callers share one source of truth. The HTML/attribute assembly and the DOM writes
// stay in the legacy adapter for now (E3/E5); they legitimately differ per caller (the full
// render carries aria/data attributes and richer titles that the patch path does not).

import type { Booking } from '../../../shared/types.ts';
import { parseYmd, isWeekend, isoWeek, weekdayName, fmtShort } from '../core/dates.ts';

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

/**
 * Build the two grid header rows' date columns (the `KW …` row and the weekday/date row) from
 * the visible weeks. Pure over `core/dates` — the machine-column head (category toggles) and the
 * `<tr>`/`</tr>` framing stay in the legacy adapter. Faithful port of the header loop in
 * `render()`: the `KW` row carries a rowspan-2 gap `<th>` between weeks; the weekday row does not.
 */
export function weekHeaderCells(
  weeks: readonly string[][],
  daysPerWeek: number,
  today: string,
): { kwRow: string; dayRow: string } {
  let kwRow = '';
  let dayRow = '';
  weeks.forEach((wk, i) => {
    if (i > 0) kwRow += '<th class="gap" rowspan="2" aria-hidden="true"></th>';
    kwRow += `<th colspan="${daysPerWeek}" role="columnheader">KW ${isoWeek(parseYmd(wk[0]!))}</th>`;
    for (const d of wk) {
      const dd = parseYmd(d);
      dayRow += `<th class="${d === today ? 'today' : ''} ${isWeekend(dd) ? 'wknd' : ''}" role="columnheader">${weekdayName(dd)}<br>${fmtShort(dd)}</th>`;
    }
  });
  return { kwRow, dayRow };
}

/** The state of a machine's "today" indicator dot in its row header. */
export type DotState = 'defekt' | 'maint' | 'busy' | 'unavail' | 'free';

/**
 * Classify the today-dot. Priority (faithful to legacy): an active maintenance/defect slot wins
 * (a `defekt` type → 'defekt', any other → 'maint'; both render as the static `statdot`), then a
 * booking → 'busy', then day-unavailability → 'unavail', else 'free'. `maintType` is the type of
 * the slot active today, or null/undefined when none (the patch path passes null — a row with a
 * maintenance slot shows a `statdot`, not a `dot`, so `refreshDot` never runs on it).
 */
export function classifyDot(
  maintType: string | null | undefined,
  booking: Booking | null | undefined,
  available: boolean,
): DotState {
  if (maintType) return maintType === 'defekt' ? 'defekt' : 'maint';
  if (booking) return 'busy';
  if (!available) return 'unavail';
  return 'free';
}
