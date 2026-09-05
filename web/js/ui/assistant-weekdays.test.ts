import { describe, it, expect } from 'vitest';
import { WEEKDAYS_MON_FRI, WEEKDAYS_ALL } from '../core/assistant.ts';
import {
  WEEKDAY_OPTIONS,
  selectedWeekdayIndices,
  maskFromSelectedIndices,
  durationUnitHint,
} from './assistant-weekdays.ts';

describe('WEEKDAY_OPTIONS', () => {
  it('lists all seven weekdays, Monday-first, with short and full German labels', () => {
    expect(WEEKDAY_OPTIONS.map((day) => day.short)).toEqual([
      'Mo',
      'Di',
      'Mi',
      'Do',
      'Fr',
      'Sa',
      'So',
    ]);
    expect(WEEKDAY_OPTIONS[0]).toEqual({ index: 0, short: 'Mo', full: 'Montag' });
    expect(WEEKDAY_OPTIONS[6]).toEqual({ index: 6, short: 'So', full: 'Sonntag' });
  });
});

describe('selectedWeekdayIndices / maskFromSelectedIndices', () => {
  it('round-trips the default Mon–Fri mask to indices 0..4 and back', () => {
    expect(selectedWeekdayIndices(WEEKDAYS_MON_FRI)).toEqual([0, 1, 2, 3, 4]);
    expect(maskFromSelectedIndices([0, 1, 2, 3, 4])).toBe(WEEKDAYS_MON_FRI);
  });

  it('round-trips a custom gapped selection (Mo/Mi/Fr)', () => {
    const mask = '1010100';
    expect(selectedWeekdayIndices(mask)).toEqual([0, 2, 4]);
    expect(maskFromSelectedIndices([4, 0, 2])).toBe(mask); // order-independent
  });

  it('an empty selection round-trips to the all-zero mask', () => {
    expect(maskFromSelectedIndices([])).toBe('0000000');
    expect(selectedWeekdayIndices('0000000')).toEqual([]);
  });
});

describe('durationUnitHint', () => {
  it('names the Mon–Fri default as Arbeitstage', () => {
    expect(durationUnitHint(WEEKDAYS_MON_FRI)).toBe('Arbeitstage am Stück (Mo–Fr)');
  });
  it('names "alle Tage" as Kalendertage', () => {
    expect(durationUnitHint(WEEKDAYS_ALL)).toBe('Kalendertage am Stück');
  });
  it('names any other custom selection generically', () => {
    expect(durationUnitHint('1010100')).toBe('Aufeinanderfolgende ausgewählte Wochentage');
    expect(durationUnitHint('1111110')).toBe('Aufeinanderfolgende ausgewählte Wochentage');
  });
});
