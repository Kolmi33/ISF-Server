// =======================================================================================
// ASSISTANT WEEKDAY PRESENTATION (web/js/ui/assistant-weekdays.ts)
// =======================================================================================
//
// Presentation-only helpers for the "Buchbare Wochentage" weekday selector: display labels,
// mask toggling, and the duration helper-text variants. No DOM — the actual eligibility/
// continuity math lives in `core/assistant.ts` (`WeekdayMask`, `candidateDaysInRange`,
// `groupRuns`/`extendOpenRuns`); this module only decides what to show for a given mask.
//
// =======================================================================================

import { WEEKDAYS_ALL, WEEKDAYS_MON_FRI, type WeekdayMask } from '../core/assistant.ts';

export interface WeekdayOption {
  /** Monday-first index (0=Mo .. 6=So), matching `WeekdayMask`'s own character position. */
  index: number;
  /** Short German label shown on the toggle itself ("Mo", "Di", …). */
  short: string;
  /** Full German weekday name, used as the toggle's accessible name ("Montag", …). */
  full: string;
}

/** The seven weekday toggles in Monday-first display order. */
export const WEEKDAY_OPTIONS: readonly WeekdayOption[] = [
  { index: 0, short: 'Mo', full: 'Montag' },
  { index: 1, short: 'Di', full: 'Dienstag' },
  { index: 2, short: 'Mi', full: 'Mittwoch' },
  { index: 3, short: 'Do', full: 'Donnerstag' },
  { index: 4, short: 'Fr', full: 'Freitag' },
  { index: 5, short: 'Sa', full: 'Samstag' },
  { index: 6, short: 'So', full: 'Sonntag' },
];

/** The mask's selected weekday indices (Monday-first), for driving toggle "pressed" state. */
export function selectedWeekdayIndices(mask: WeekdayMask): number[] {
  return WEEKDAY_OPTIONS.filter((day) => mask.charAt(day.index) === '1').map((day) => day.index);
}

/** Builds a mask from a set of Monday-first indices (the shape a Base UI ToggleGroup's
 *  `onValueChange` naturally produces once each toggle's `value` is its index). */
export function maskFromSelectedIndices(indices: readonly number[]): WeekdayMask {
  const selected = new Set(indices);
  return WEEKDAY_OPTIONS.map((day) => (selected.has(day.index) ? '1' : '0')).join('');
}

/** Adapts the "Mind. Tage am Stück" helper text to the active weekday selection (feature 8):
 *  the plain Mon–Fri default keeps the original "Arbeitstage" wording, "alle Tage" reads as
 *  calendar days, and any other (gapped or partial) selection names itself explicitly rather
 *  than implying a specific business-day model that no longer applies. */
export function durationUnitHint(mask: WeekdayMask): string {
  if (mask === WEEKDAYS_MON_FRI) return 'Arbeitstage am Stück (Mo–Fr)';
  if (mask === WEEKDAYS_ALL) return 'Kalendertage am Stück';
  return 'Aufeinanderfolgende ausgewählte Wochentage';
}
