// =======================================================================================
// GRID SELECTION GEOMETRY MODULE (web/js/ui/selection.ts)
// =======================================================================================
//
// Excel-like rectangle selection over the visible grid: an anchor cell and a focus cell
// span a rectangle across the visible machine rows and date columns. This module owns the
// pure geometry — which cells the rectangle covers, and where an arrow keypress lands after
// clamping to the grid bounds.
//
// Key Principles:
// - GEOMETRY ONLY, NO DOM: painting `.sel`/`.kfocus`, the mouse/key listeners, auto-scroll,
//   and the week-growth at the edges are genuine side effects on real elements and on the
//   store — that all lives in `ui/grid-interaction.ts`, not here.
//
// =======================================================================================

/** A single grid cell: a machine id (row) and an ISO date (column). */
export interface Cell {
  machineId: string;
  date: string;
}

/**
 * Computes the cells covered by the selection rectangle.
 *
 * How it works: locates the anchor and focus corners in the visible row/column arrays
 * (injected, so this stays a pure function of its inputs), then returns every cell between
 * them, inclusive, in row-major order. If either corner is missing or no longer visible
 * (its week scrolled out, its machine filtered away), the selection is empty rather than
 * throwing. A reversed drag (focus above/left of anchor) yields the same rectangle either way.
 */
export function computeSelCells(
  anchor: Cell | null,
  focus: Cell | null,
  visM: readonly string[],
  visD: readonly string[],
): Cell[] {
  if (!anchor || !focus) return [];
  const r1 = visM.indexOf(anchor.machineId);
  const r2 = visM.indexOf(focus.machineId);
  const c1 = visD.indexOf(anchor.date);
  const c2 = visD.indexOf(focus.date);
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return [];
  const cells: Cell[] = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
      cells.push({ machineId: visM[r]!, date: visD[c]! });
  return cells;
}

/**
 * Clamps an index into a valid position for an array of `length` items: negatives snap to
 * 0, anything at or past the end snaps to the last index — this is what keeps an
 * arrow-key-moved focus cell inside the visible grid instead of running off either edge.
 * `length` is assumed ≥ 1 — the caller guards against an empty grid before moving.
 */
export function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}
