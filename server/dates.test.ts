import { describe, it, expect } from 'vitest';
import { parseIsoDateString, formatDateAsIsoString, addDays } from './dates.ts';

describe('parseIsoDateString / formatDateAsIsoString', () => {
  it('round-trips an ISO date at UTC midnight', () => {
    const date = parseIsoDateString('2021-01-08');
    expect(date.getUTCFullYear()).toBe(2021);
    expect(date.getUTCMonth()).toBe(0); // 0-indexed: January
    expect(date.getUTCDate()).toBe(8);
    expect(date.getUTCHours()).toBe(0);
    expect(formatDateAsIsoString(date)).toBe('2021-01-08');
  });
});

describe('addDays', () => {
  it('adds calendar days without mutating the input, crossing a year boundary', () => {
    const date = parseIsoDateString('2021-12-30');
    const later = addDays(date, 3);
    expect(formatDateAsIsoString(later)).toBe('2022-01-02');
    expect(formatDateAsIsoString(date)).toBe('2021-12-30'); // unchanged
  });

  it('supports negative offsets', () => {
    expect(formatDateAsIsoString(addDays(parseIsoDateString('2021-01-08'), -1))).toBe('2021-01-07');
  });
});
