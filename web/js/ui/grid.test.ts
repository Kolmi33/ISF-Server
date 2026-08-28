import { describe, it, expect } from 'vitest';
import type { Booking } from '../../../shared/types.ts';
import { classifyCell, isMine, cellClass } from './grid.ts';

const bk: Booking = { name: 'anna' };

describe('classifyCell', () => {
  it('ranks blocked highest, even over a booking', () => {
    expect(classifyCell(true, bk, true)).toBe('blocked');
    expect(classifyCell(true, null, false)).toBe('blocked');
  });
  it('is booked when not blocked and a booking exists', () => {
    expect(classifyCell(false, bk, false)).toBe('booked'); // booking wins over unavailability
  });
  it('is unavail when free of block/booking but the day is not available', () => {
    expect(classifyCell(false, null, false)).toBe('unavail');
    expect(classifyCell(false, undefined, false)).toBe('unavail');
  });
  it('is free otherwise', () => {
    expect(classifyCell(false, null, true)).toBe('free');
  });
});

describe('isMine', () => {
  it('matches case-insensitively', () => {
    expect(isMine('anna', 'ANNA')).toBe(true);
    expect(isMine('Anna', 'bob')).toBe(false);
  });
  it('is false when there is no current user', () => {
    expect(isMine('', 'anna')).toBe(false);
  });
});

describe('cellClass', () => {
  it('builds the stem for each state', () => {
    expect(cellClass('free')).toBe('cell free');
    expect(cellClass('blocked')).toBe('cell blocked');
    expect(cellClass('unavail')).toBe('cell unavail');
    expect(cellClass('booked')).toBe('cell booked');
  });
  it('adds mine only for booked cells', () => {
    expect(cellClass('booked', { mine: true })).toBe('cell booked mine');
    expect(cellClass('free', { mine: true })).toBe('cell free'); // mine ignored off booked
  });
  it('appends today then weekend, in that order', () => {
    expect(cellClass('booked', { mine: true, today: true, weekend: true })).toBe(
      'cell booked mine today wknd',
    );
    expect(cellClass('free', { today: true })).toBe('cell free today');
    expect(cellClass('free', { weekend: true })).toBe('cell free wknd');
  });
});
