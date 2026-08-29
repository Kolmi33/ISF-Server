// The grid selection model (Phase 4.2). Excel-like rectangle selection over the visible
// grid: an anchor cell and a focus cell span a rectangle across the visible machine rows
// (`S.visM`) and date columns (`S.visD`). This module owns the pure geometry — which cells
// the rectangle covers, and where an arrow keypress lands after clamping to the grid bounds.
// The DOM side stays in the legacy adapter (E3/E5): painting `.sel`/`.kfocus`, the mouse/key
// listeners, auto-scroll, and the week-growth at the edges are genuine side effects on real
// elements and on `S.extraWeeks`, and belong with the interaction code, not here.

/** A single grid cell: a machine id (row) and an ISO date (column). */
export interface Cell {
  mid: string;
  date: string;
}

/**
 * The cells covered by the selection rectangle. The anchor and focus corners are located in
 * the visible row/column arrays (injected — E4); the result is every cell between them,
 * inclusive, in row-major order. If either corner is missing or no longer visible (its week
 * scrolled out, its machine filtered away), the selection is empty — faithful to legacy's
 * `indexOf < 0` guard. A reversed drag (focus above/left of anchor) yields the same rectangle.
 */
export function computeSelCells(
  anchor: Cell | null,
  focus: Cell | null,
  visM: readonly string[],
  visD: readonly string[],
): Cell[] {
  if (!anchor || !focus) return [];
  const r1 = visM.indexOf(anchor.mid);
  const r2 = visM.indexOf(focus.mid);
  const c1 = visD.indexOf(anchor.date);
  const c2 = visD.indexOf(focus.date);
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return [];
  const cells: Cell[] = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
      cells.push({ mid: visM[r]!, date: visD[c]! });
  return cells;
}

/**
 * Clamp an index into a valid position for an array of `len` items: negatives snap to 0,
 * anything at or past the end snaps to the last index. Faithful to the arrow-key math in
 * legacy (`Math.max(0, Math.min(len - 1, idx))`), which keeps the moved focus cell inside the
 * visible grid. `len` is assumed ≥ 1 — the caller guards against an empty grid before moving.
 */
export function clampIndex(idx: number, len: number): number {
  return Math.max(0, Math.min(len - 1, idx));
}
