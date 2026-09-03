// =======================================================================================
// COLUMN RESIZE MODULE (web/js/ui/column-resize.ts)
// =======================================================================================
//
// Drag-to-resize the machine (leftmost) column's width.
//
// Key Principles:
// - DELEGATES ON `document`: `#colResize` is rendered by `ui/components/Grid.tsx`, but this
//   module listens on `document` (checking the mousedown target's id) rather than attaching
//   directly to the element, so it works regardless of mount order — it doesn't matter
//   whether the Grid has painted `#colResize` yet when this module's listeners are wired.
//
// =======================================================================================

const MIN_WIDTH = 110;
const MAX_WIDTH = 560;

interface DragState {
  x: number;
  w: number;
}

/**
 * Wires the drag-to-resize listeners. Call once at boot.
 *
 * How it works: a mousedown on `#colResize` starts a drag, recording the pointer's x and
 * the column's current width; mousemove clamps the new width to `MIN_WIDTH..MAX_WIDTH` and
 * writes it live to the `--machw` CSS variable every column reads from; mouseup persists
 * the final width to `localStorage` and ends the drag.
 */
export function initColumnResize(): void {
  const saved = localStorage.getItem('mb_machw');
  if (saved) document.documentElement.style.setProperty('--machw', saved);
  let drag: DragState | null = null;

  document.addEventListener('mousedown', (event) => {
    if ((event.target as HTMLElement).id !== 'colResize') return;
    event.preventDefault();
    const current =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--machw')) || 230;
    drag = { x: event.clientX, w: current };
  });

  document.addEventListener('mousemove', (event) => {
    if (!drag) return;
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, drag.w + event.clientX - drag.x));
    document.documentElement.style.setProperty('--machw', width + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!drag) return;
    localStorage.setItem(
      'mb_machw',
      getComputedStyle(document.documentElement).getPropertyValue('--machw').trim(),
    );
    drag = null;
  });
}
