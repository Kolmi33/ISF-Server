import { describe, it, expect } from 'vitest';
import { buildAssistantResults } from './assistant-results.ts';

describe('buildAssistantResults', () => {
  // What: each run is paired with whether it's open-ended (still extending) and a default
  // day count that's clamped down to the run's own length when the run is shorter than the
  // requested minimum.
  // How: builds one short run (shorter than minDays=2, so its default clamps to its actual
  // length of 1) and one long open-ended run, checking both results' shape.
  it('pairs each run with its open-ended flag and a minDays-clamped default day count', () => {
    const short = ['2021-01-04'];
    const long = ['2021-01-04', '2021-01-05', '2021-01-06'];
    const results = buildAssistantResults([short, long], new Set([long]), 2);
    expect(results).toEqual([
      { dates: short, isOpenEnded: false, defaultDays: 1, minDays: 1, maxDays: 1 },
      { dates: long, isOpenEnded: true, defaultDays: 2, minDays: 2, maxDays: 3 },
    ]);
  });

  // What: the results list is capped at 30 runs even when far more candidate runs are given,
  // so the assistant never renders an unbounded list.
  // How: builds 40 distinct single-day runs and checks the result has exactly 30.
  it('caps the list at 30 runs', () => {
    const runs = Array.from({ length: 40 }, (_, i) => [
      `2021-01-${String(i + 1).padStart(2, '0')}`,
    ]);
    expect(buildAssistantResults(runs, new Set(), 1)).toHaveLength(30);
  });

  // What: with no runs at all, the result is an empty list, not an error.
  // How: calls with an empty runs array.
  it('is empty for no runs', () => {
    expect(buildAssistantResults([], new Set(), 1)).toEqual([]);
  });

  it('caps booking duration without dropping or shortening a longer available window', () => {
    const dates = ['2021-01-08', '2021-01-11', '2021-01-12', '2021-01-13'];
    expect(buildAssistantResults([dates], new Set([dates]), 2, 3)).toEqual([
      { dates, isOpenEnded: true, defaultDays: 2, minDays: 2, maxDays: 3 },
    ]);
    expect(buildAssistantResults([dates], new Set(), 2, 2)[0]?.maxDays).toBe(2);
    expect(buildAssistantResults([dates], new Set(), 2, 10)[0]?.maxDays).toBe(4);
  });
});
