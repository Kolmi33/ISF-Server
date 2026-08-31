// The Assistant's results-list shape — pure over `core/assistant`'s scheduling output; no DOM.
// The scheduling itself (freeDays/groupRuns/extendOpenRuns/chooseDevicesForTree) already lives
// in `core/assistant.ts`; this module just caps the list and derives each row's static
// display data. Each row's own "days to book" is edited live in component state — not modeled
// here. Faithful port of the `good.slice(0,30).map(...)` shape in legacy `runAssistant`.

const MAX_RESULTS = 30;

export interface AssistantResultRow {
  /** The full free run (weekday-contiguous dates), already capped to `MAX_RESULTS` runs. */
  dates: readonly string[];
  /** True if this run reached the search window's end and was extended (open-ended). */
  isOpenEnded: boolean;
  /** The initial "days to book" count: `minDays`, clamped to the run's own length. */
  defaultDays: number;
}

/**
 * Cap the free runs to `MAX_RESULTS` and pair each with its open-ended flag and default day
 * count. Faithful port of legacy `runAssistant`'s `good.slice(0,30).map((r,i)=>{ const
 * def=Math.min(minDays,r.length); ... })`.
 */
export function buildAssistantResults(
  runs: readonly (readonly string[])[],
  openRuns: ReadonlySet<readonly string[]>,
  minDays: number,
): AssistantResultRow[] {
  return runs.slice(0, MAX_RESULTS).map((dates) => ({
    dates,
    isOpenEnded: openRuns.has(dates),
    defaultDays: Math.min(minDays, dates.length),
  }));
}
