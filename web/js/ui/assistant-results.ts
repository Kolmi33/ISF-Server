// =======================================================================================
// ASSISTANT RESULTS MODULE (web/js/ui/assistant-results.ts)
// =======================================================================================
//
// The Assistant's results-list shape — pure over `core/assistant`'s scheduling output; no
// DOM. The scheduling itself (`freeDays`/`groupRuns`/`extendOpenRuns`/`chooseDevicesForTree`)
// already lives in `core/assistant.ts`; this module just caps the list and derives each
// row's static display data.
//
// Key Principles:
// - DISPLAY DATA ONLY: each row's "days to book" is edited live in component state, not
//   modeled here — this module only computes the read-only defaults a fresh render starts from.
//
// =======================================================================================

const MAX_RESULTS = 30;

export interface AssistantResultRow {
  /** The full free run (weekday-contiguous dates), already capped to `MAX_RESULTS` runs. */
  dates: readonly string[];
  /** True if this run reached the search window's end and was extended (open-ended). */
  isOpenEnded: boolean;
  /** The initial "days to book" count: `minDays`, clamped to the run's own length. */
  defaultDays: number;
  /** Booking bounds frozen with the search; the full availability window remains visible. */
  minDays: number;
  maxDays: number;
}

/**
 * Caps the free runs to `MAX_RESULTS` and pairs each with its open-ended flag and default
 * day count (`minDays`, clamped so it never exceeds that particular run's own length).
 */
export function buildAssistantResults(
  runs: readonly (readonly string[])[],
  openRuns: ReadonlySet<readonly string[]>,
  minDays: number,
  maxDays = Number.POSITIVE_INFINITY,
): AssistantResultRow[] {
  return runs.slice(0, MAX_RESULTS).map((dates) => ({
    dates,
    isOpenEnded: openRuns.has(dates),
    defaultDays: Math.min(minDays, dates.length),
    minDays: Math.min(minDays, dates.length),
    maxDays: Math.min(maxDays, dates.length),
  }));
}
