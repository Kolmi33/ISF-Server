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
  // What: the very first jump (no anchor yet) can land ON today itself, if today is free —
  // it isn't forced to start searching from tomorrow.
  // How: calls with a null anchor and checks today's own date is returned.
  it('includes today when no anchor is given (first jump)', () => {
    expect(nextFreeDay(null, '2021-01-04', anyDay)).toBe('2021-01-04');
  });

  // What: once an anchor exists (a previous jump already landed somewhere), the next search
  // starts strictly AFTER that anchor, not on it again.
  // How: anchors on today and checks the result is tomorrow, not today again.
  it('starts strictly after the anchor when one is given', () => {
    expect(nextFreeDay('2021-01-04', '2021-01-04', anyDay)).toBe('2021-01-05');
  });

  // What: searching forward from a Friday skips straight over the weekend to the next Monday.
  // How: anchors on a Friday and checks the result is the following Monday, not Saturday.
  it('skips the weekend (Fri → Mon)', () => {
    expect(nextFreeDay('2021-01-08', '2021-01-04', anyDay)).toBe('2021-01-11');
  });

  // What: even with no anchor at all, if "today" itself happens to be a weekend day, the
  // search still skips forward to the next real workday rather than returning the weekend day.
  // How: calls with a null anchor but "today" set to a Saturday and checks the result is the
  // following Monday.
  it('skips forward over a weekend start day', () => {
    expect(nextFreeDay(null, '2021-01-09', anyDay)).toBe('2021-01-11'); // Sat today → Mon
  });

  // What: days the injected availability predicate marks busy are skipped over, continuing
  // the search until a genuinely free day is found.
  // How: marks two consecutive days busy right after the anchor and checks the result skips
  // past both to the next actually-free day.
  it('skips days the machine is not free', () => {
    expect(nextFreeDay('2021-01-04', '2021-01-04', busyExcept(['2021-01-05', '2021-01-06']))).toBe(
      '2021-01-07',
    );
  });

  // What: if nothing is free within the search horizon, the function gives up and returns
  // null rather than scanning forever.
  // How: gives an availability predicate that's always false and a short horizon (5 days),
  // checking the result is null.
  it('returns null when nothing is free within the horizon', () => {
    expect(nextFreeDay(null, '2021-01-04', () => false, 5)).toBeNull();
  });
});

describe('prevFreeDay', () => {
  // What: searching backward finds the nearest free day strictly BEFORE the anchor.
  // How: anchors a few days after today and checks the result is the day right before the anchor.
  it('finds the free day strictly before the anchor', () => {
    expect(prevFreeDay('2021-01-07', '2021-01-04', anyDay)).toBe('2021-01-06');
  });

  // What: searching backward from a Monday skips straight over the weekend to the preceding Friday.
  // How: anchors on a Monday and checks the result is the preceding Friday, not Sunday.
  it('skips the weekend going backward (Mon → Fri)', () => {
    expect(prevFreeDay('2021-01-11', '2021-01-04', anyDay)).toBe('2021-01-08');
  });

  // What: busy days are skipped going backward too, same as the forward search.
  // How: marks the day right before the anchor busy and checks the search continues past it
  // to the next free day further back.
  it('skips busy days going backward', () => {
    expect(prevFreeDay('2021-01-07', '2021-01-04', busyExcept(['2021-01-06']))).toBe('2021-01-05');
  });

  // What: the backward search never goes earlier than "today" — if the anchor is already
  // today, there's nowhere earlier to go, so it returns null instead of jumping into the past.
  // How: anchors exactly on today and checks the result is null.
  it('never goes earlier than today (anchor is today → null)', () => {
    expect(prevFreeDay('2021-01-05', '2021-01-05', anyDay)).toBeNull();
  });

  // What: if every day between the anchor and today is unavailable, the search returns null
  // rather than an incorrect day.
  // How: gives an availability predicate that's always false and checks the result is null.
  it('returns null when no free day remains back to today', () => {
    expect(prevFreeDay('2021-01-06', '2021-01-04', () => false)).toBeNull();
  });
});
