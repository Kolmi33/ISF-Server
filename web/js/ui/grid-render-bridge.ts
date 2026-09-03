// =======================================================================================
// GRID RENDER BRIDGE MODULE (web/js/ui/grid-render-bridge.ts)
// =======================================================================================
//
// Lets imperative, non-React modules (`grid-scroll.ts`, `grid-interaction.ts`) trigger a
// repaint of the mounted `Grid` component without importing it directly.
//
// Key Principles:
// - BREAKS A GENUINE IMPORT CYCLE: `Grid.tsx` already imports both of those modules itself
//   (for `daysPerWeek`/`paintSelection`); a reverse direct import for the render trigger
//   would be a real two-way cycle, not just an unwired convenience. This tiny module breaks
//   that: `Grid.tsx` registers its force-update trigger here once, on mount, and everyone
//   else calls `triggerGridRender()` instead of importing `Grid.tsx` at all.
//
// =======================================================================================

let renderTrigger: (() => void) | null = null;

/** Registers the mounted `Grid` component's force-update function — cleared again on
 *  unmount, though `Grid` mounts once at boot and never unmounts in practice. */
export function registerGridRenderTrigger(trigger: (() => void) | null): void {
  renderTrigger = trigger;
}

/** Requests a repaint of the mounted `Grid`. A no-op before `Grid` has mounted — never
 *  happens in practice, since `Grid` mounts at boot before any of this module's callers
 *  can possibly run. */
export function triggerGridRender(): void {
  renderTrigger?.();
}
