import { describe, it, expect } from 'vitest';
import { computeSelCells, clampIndex, type Cell } from './selection.ts';

// A small visible grid: 3 machine rows × 3 date columns.
const visM = ['m1', 'm2', 'm3'];
const visD = ['2021-01-04', '2021-01-05', '2021-01-06'];
const cell = (machineId: string, date: string): Cell => ({ machineId, date });

describe('computeSelCells', () => {
  // What: a rectangle needs both corners to compute — a missing anchor or focus yields no
  // selection at all rather than guessing.
  // How: checks a null anchor and a null focus (each paired with a real corner) both yield [].
  it('is empty when a corner is missing', () => {
    expect(computeSelCells(null, cell('m1', visD[0]!), visM, visD)).toEqual([]);
    expect(computeSelCells(cell('m1', visD[0]!), null, visM, visD)).toEqual([]);
  });

  // What: a corner referencing a machine or date no longer in the visible grid (e.g. scrolled
  // away, or the machine got filtered out) makes the whole selection empty — each of the four
  // possible "corner not visible" cases is checked independently.
  // How: tries an unknown machine id and an out-of-range date on each of the two corners in turn.
  it('is empty when a corner is no longer visible', () => {
    // each of the four indexOf guards, isolated
    expect(computeSelCells(cell('gone', visD[0]!), cell('m1', visD[0]!), visM, visD)).toEqual([]);
    expect(computeSelCells(cell('m1', visD[0]!), cell('gone', visD[0]!), visM, visD)).toEqual([]);
    expect(computeSelCells(cell('m1', '1999-01-01'), cell('m1', visD[0]!), visM, visD)).toEqual([]);
    expect(computeSelCells(cell('m1', visD[0]!), cell('m1', '1999-01-01'), visM, visD)).toEqual([]);
  });

  // What: when the anchor and focus are the same cell (a click with no drag), the selection
  // is just that one cell.
  // How: passes the same cell as both anchor and focus and checks a single-element result.
  it('is a single cell when anchor and focus coincide', () => {
    expect(computeSelCells(cell('m2', visD[1]!), cell('m2', visD[1]!), visM, visD)).toEqual([
      cell('m2', visD[1]!),
    ]);
  });

  // What: a genuine drag between two distinct corners selects the full inclusive rectangle
  // between them, listed in row-major (row by row, left to right) order.
  // How: drags from the top-left-ish corner to a middle cell and checks all four cells of
  // that 2×2 rectangle come back in row-major order.
  it('covers the inclusive rectangle in row-major order', () => {
    const cells = computeSelCells(cell('m1', visD[0]!), cell('m2', visD[1]!), visM, visD);
    expect(cells).toEqual([
      cell('m1', visD[0]!),
      cell('m1', visD[1]!),
      cell('m2', visD[0]!),
      cell('m2', visD[1]!),
    ]);
  });

  // What: dragging "backward" (from bottom-right to top-left) produces the exact same
  // rectangle as dragging forward — direction doesn't matter, only the two corners do.
  // How: computes the same corner pair in both orders and checks the results are identical,
  // covering the whole 3×3 grid.
  it('normalizes a reversed drag to the same rectangle', () => {
    const forward = computeSelCells(cell('m1', visD[0]!), cell('m3', visD[2]!), visM, visD);
    const reversed = computeSelCells(cell('m3', visD[2]!), cell('m1', visD[0]!), visM, visD);
    expect(reversed).toEqual(forward);
    expect(forward).toHaveLength(9); // the whole 3×3 grid
  });
});

describe('clampIndex', () => {
  // What: a negative index (moved past the start) clamps to 0, however far negative it is.
  // How: checks -1 and a much more negative value both clamp to 0 for a length-3 list.
  it('snaps a negative index to 0', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(-99, 3)).toBe(0);
  });
  // What: an index at or past the end clamps to the last valid position.
  // How: checks an index exactly at the length and one far past it both clamp to index 2
  // (the last position of a length-3 list).
  it('snaps an over-the-end index to the last position', () => {
    expect(clampIndex(3, 3)).toBe(2);
    expect(clampIndex(99, 3)).toBe(2);
  });
  // What: an index already inside the valid range passes through unchanged.
  // How: checks all three valid indices of a length-3 list stay the same.
  it('leaves an in-range index unchanged', () => {
    expect(clampIndex(0, 3)).toBe(0);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(2, 3)).toBe(2);
  });
});
