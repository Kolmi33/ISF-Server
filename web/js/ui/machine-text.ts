// =======================================================================================
// MACHINE STATUS TEXT MODULE (web/js/ui/machine-text.ts)
// =======================================================================================
//
// Small pure German-text formatters for machine status/availability, shared across the
// grid row headers, the admin list badges, and the machine form.
// This module provides:
// 1. `maintText`: one maintenance/defect slot as a German sentence fragment.
// 2. `statusRangeText`/`maintenanceKind`: a machine's overall status summary.
// 3. `daysMaskText`: a machine's available weekdays as text.
//
// Key Principles:
// - INJECTED "TODAY": `statusRangeText`/`maintenanceKind` take `today` as an optional
//   parameter defaulting to the real current date, so every call site can omit it (reading
//   naturally as "the status right now") while tests still pass a fixed date for
//   deterministic, reproducible results.
//
// =======================================================================================

import type { Machine, MaintSlot } from '../../../shared/types.ts';
import { formatDateLong, todayAsIsoDateString } from '../../../shared/dates.ts';
import {
  getMaintenanceSlots,
  isSlotCoveringDate,
  getMaintenanceSlotAtDate,
} from '../core/machines.ts';

/** Mo..So, matching the index order of a `Machine.days` mask. Shared by `daysMaskText` and the
 *  machine form's weekday checkboxes. */
export const WEEKDAY_SHORT_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** One maintenance/defect slot as German text, e.g. `Wartung: <from> – <until> (note)`. */
export function maintText(s: MaintSlot | null | undefined): string {
  if (!s) return '';
  const f = s.from ? formatDateLong(s.from) : 'sofort';
  const u = s.until ? formatDateLong(s.until) : 'unbegrenzt';
  return `${s.type === 'defekt' ? 'defekt' : 'Wartung'}: ${f} – ${u}${s.note ? ' (' + s.note + ')' : ''}`;
}

/**
 * Builds a machine's status summary.
 *
 * How it works: shows the slot covering `today` if one exists, else the earliest slot by
 * `from` (so an upcoming, not-yet-active slot is still surfaced rather than showing
 * nothing), plus a `· +N weitere` suffix when more than one slot exists. Empty when the
 * machine has no slots at all.
 */
export function statusRangeText(m: Machine, today: string = todayAsIsoDateString()): string {
  const ss = getMaintenanceSlots(m);
  if (!ss.length) return '';
  const active =
    ss.find((s) => isSlotCoveringDate(s, today)) ||
    ss.slice().sort((a, b) => ((a.from || '0') < (b.from || '0') ? -1 : 1))[0];
  return maintText(active) + (ss.length > 1 ? ` · +${ss.length - 1} weitere` : '');
}

/** The type (`'wartung'`/`'defekt'`/…) of the maintenance slot covering `today`, or null if
 *  none is active right now — used for the admin list's and the Assistant tree/checklist's
 *  status-badge colour/label. */
export function maintenanceKind(m: Machine, today: string = todayAsIsoDateString()): string | null {
  return getMaintenanceSlotAtDate(m, today)?.type ?? null;
}

/**
 * Formats the machine's available weekdays as text. `m.days` is a 7-char Mo..So mask
 * ('1' = available); absent, the wrong length, or all-on → 'jeden Tag', all-off → 'keine Tage'.
 */
export function daysMaskText(m: Machine): string {
  if (!m.days || m.days.length !== 7 || m.days === '1111111') return 'jeden Tag';
  const on = WEEKDAY_SHORT_LABELS.filter((_, i) => m.days!.charAt(i) === '1');
  return on.length ? on.join(', ') : 'keine Tage';
}
