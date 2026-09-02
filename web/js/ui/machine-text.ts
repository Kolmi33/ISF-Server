// Machine status/availability presentation text (Phase 4.3). Small pure German-text formatters
// shared across the grid row headers, the admin list badges and the machine form: a single
// maintenance slot's text, a machine's overall status summary, and its available-weekday mask.
// Pure over `core/dates` + `core/machines`; `statusRangeText` injects "today" with a default so the
// legacy call sites (`statusRangeText(m)`) are unchanged while tests stay deterministic (E4/E6).

import type { Machine, MaintSlot } from '../../../shared/types.ts';
import { formatDateLong, todayAsIsoDateString } from '../../../shared/dates.ts';
import { maintenanceSlots, slotCovers, maintenanceSlotAt } from '../core/machines-queries.ts';

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
 * A machine's status summary: the slot covering `today` if any, else the earliest slot by `from`,
 * plus a `· +N weitere` suffix when more than one slot exists. Empty when the machine has no slots.
 */
export function statusRangeText(m: Machine, today: string = todayAsIsoDateString()): string {
  const ss = maintenanceSlots(m);
  if (!ss.length) return '';
  const active =
    ss.find((s) => slotCovers(s, today)) ||
    ss.slice().sort((a, b) => ((a.from || '0') < (b.from || '0') ? -1 : 1))[0];
  return maintText(active) + (ss.length > 1 ? ` · +${ss.length - 1} weitere` : '');
}

/**
 * The type (`'wartung'`/`'defekt'`/…) of the maintenance slot covering `today`, or null if none
 * is active right now. Used for the admin list's status-badge colour/label. Faithful port of
 * legacy `maintKind` — kept there too, under its old name, for two not-yet-ported call sites
 * (the grid row header and the machine-filter dropdown).
 */
export function maintenanceKind(m: Machine, today: string = todayAsIsoDateString()): string | null {
  return maintenanceSlotAt(m, today)?.type ?? null;
}

/**
 * The machine's available weekdays as text. `m.days` is a 7-char Mo..So mask ('1' = available);
 * absent / wrong length / all-on → 'jeden Tag', all-off → 'keine Tage'. Faithful port.
 */
export function daysMaskText(m: Machine): string {
  if (!m.days || m.days.length !== 7 || m.days === '1111111') return 'jeden Tag';
  const on = WEEKDAY_SHORT_LABELS.filter((_, i) => m.days!.charAt(i) === '1');
  return on.length ? on.join(', ') : 'keine Tage';
}
