import { describe, it, expect } from 'vitest';
import { buildAssistantResults } from './assistant-results.ts';

describe('buildAssistantResults', () => {
  it('pairs each run with its open-ended flag and a minDays-clamped default day count', () => {
    const short = ['2021-01-04'];
    const long = ['2021-01-04', '2021-01-05', '2021-01-06'];
    const results = buildAssistantResults([short, long], new Set([long]), 2);
    expect(results).toEqual([
      { dates: short, isOpenEnded: false, defaultDays: 1 }, // clamped to the run's own length
      { dates: long, isOpenEnded: true, defaultDays: 2 },
    ]);
  });

  it('caps the list at 30 runs', () => {
    const runs = Array.from({ length: 40 }, (_, i) => [
      `2021-01-${String(i + 1).padStart(2, '0')}`,
    ]);
    expect(buildAssistantResults(runs, new Set(), 1)).toHaveLength(30);
  });

  it('is empty for no runs', () => {
    expect(buildAssistantResults([], new Set(), 1)).toEqual([]);
  });
});
