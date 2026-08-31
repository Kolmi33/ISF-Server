// Drag-to-resize the machine column (Phase 7 slice B10g). Faithful port of legacy's
// self-contained column-resize IIFE. `#colResize` is rendered by `ui/components/Grid.tsx`
// (B1); this module delegates on `document` (checking the mousedown target's id) so it works
// regardless of mount order, exactly like legacy's own listeners did.

const MIN_WIDTH = 110;
const MAX_WIDTH = 560;

interface DragState {
  x: number;
  w: number;
}

/** Wire the drag-to-resize listeners. Call once at boot. Faithful port of legacy's IIFE. */
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
