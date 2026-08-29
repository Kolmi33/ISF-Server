import { describe, it, expect } from 'vitest';
import { nextFreeDay, prevFreeDay, type FreeDay } from './navigation.ts';

// Deterministic anchors (TZ=UTC pinned): 2021-01-04 Mon … 2021-01-08 Fri,
// 2021-01-09 Sat, 2021-01-10 Sun, 2021-01-11 Mon.
const anyDay: FreeDay = () => true;
const busyExcept = (busy: string[]): FreeDay => {
  const set = new Set(busy);
  return (iso) => !set.has(iso);
};

describe('nextFreeDay', () => {
  it('includes today when no anchor is given (first jump)', () => {
    expect(nextFreeDay(null, '2021-01-04', anyDay)).toBe('2021-01-04');
  });

  it('starts strictly after the anchor when one is given', () => {
    expect(nextFreeDay('2021-01-04', '2021-01-04', anyDay)).toBe('2021-01-05');
  });

  it('skips the weekend (Fri → Mon)', () => {
    expect(nextFreeDay('2021-01-08', '2021-01-04', anyDay)).toBe('2021-01-11');
  });

  it('skips forward over a weekend start day', () => {
    expect(nextFreeDay(null, '2021-01-09', anyDay)).toBe('2021-01-11'); // Sat today → Mon
  });

  it('skips days the machine is not free', () => {
    expect(nextFreeDay('2021-01-04', '2021-01-04', busyExcept(['2021-01-05', '2021-01-06']))).toBe(
      '2021-01-07',
    );
  });

  it('returns null when nothing is free within the horizon', () => {
    expect(nextFreeDay(null, '2021-01-04', () => false, 5)).toBeNull();
  });
});

describe('prevFreeDay', () => {
  it('finds the free day strictly before the anchor', () => {
    expect(prevFreeDay('2021-01-07', '2021-01-04', anyDay)).toBe('2021-01-06');
  });

  it('skips the weekend going backward (Mon → Fri)', () => {
    expect(prevFreeDay('2021-01-11', '2021-01-04', anyDay)).toBe('2021-01-08');
  });

  it('skips busy days going backward', () => {
    expect(prevFreeDay('2021-01-07', '2021-01-04', busyExcept(['2021-01-06']))).toBe('2021-01-05');
  });

  it('never goes earlier than today (anchor is today → null)', () => {
    expect(prevFreeDay('2021-01-05', '2021-01-05', anyDay)).toBeNull();
  });

  it('returns null when no free day remains back to today', () => {
    expect(prevFreeDay('2021-01-06', '2021-01-04', () => false)).toBeNull();
  });
});
