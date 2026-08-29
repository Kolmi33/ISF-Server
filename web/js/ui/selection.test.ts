import { describe, it, expect } from 'vitest';
import { computeSelCells, clampIndex, type Cell } from './selection.ts';

// A small visible grid: 3 machine rows × 3 date columns.
const visM = ['m1', 'm2', 'm3'];
const visD = ['2021-01-04', '2021-01-05', '2021-01-06'];
const cell = (mid: string, date: string): Cell => ({ mid, date });

describe('computeSelCells', () => {
  it('is empty when a corner is missing', () => {
    expect(computeSelCells(null, cell('m1', visD[0]!), visM, visD)).toEqual([]);
    expect(computeSelCells(cell('m1', visD[0]!), null, visM, visD)).toEqual([]);
  });

  it('is empty when a corner is no longer visible', () => {
    // each of the four indexOf guards, isolated
    expect(computeSelCells(cell('gone', visD[0]!), cell('m1', visD[0]!), visM, visD)).toEqual([]);
    expect(computeSelCells(cell('m1', visD[0]!), cell('gone', visD[0]!), visM, visD)).toEqual([]);
    expect(computeSelCells(cell('m1', '1999-01-01'), cell('m1', visD[0]!), visM, visD)).toEqual([]);
    expect(computeSelCells(cell('m1', visD[0]!), cell('m1', '1999-01-01'), visM, visD)).toEqual([]);
  });

  it('is a single cell when anchor and focus coincide', () => {
    expect(computeSelCells(cell('m2', visD[1]!), cell('m2', visD[1]!), visM, visD)).toEqual([
      cell('m2', visD[1]!),
    ]);
  });

  it('covers the inclusive rectangle in row-major order', () => {
    const cells = computeSelCells(cell('m1', visD[0]!), cell('m2', visD[1]!), visM, visD);
    expect(cells).toEqual([
      cell('m1', visD[0]!),
      cell('m1', visD[1]!),
      cell('m2', visD[0]!),
      cell('m2', visD[1]!),
    ]);
  });

  it('normalizes a reversed drag to the same rectangle', () => {
    const forward = computeSelCells(cell('m1', visD[0]!), cell('m3', visD[2]!), visM, visD);
    const reversed = computeSelCells(cell('m3', visD[2]!), cell('m1', visD[0]!), visM, visD);
    expect(reversed).toEqual(forward);
    expect(forward).toHaveLength(9); // the whole 3×3 grid
  });
});

describe('clampIndex', () => {
  it('snaps a negative index to 0', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(-99, 3)).toBe(0);
  });
  it('snaps an over-the-end index to the last position', () => {
    expect(clampIndex(3, 3)).toBe(2);
    expect(clampIndex(99, 3)).toBe(2);
  });
  it('leaves an in-range index unchanged', () => {
    expect(clampIndex(0, 3)).toBe(0);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(2, 3)).toBe(2);
  });
});
