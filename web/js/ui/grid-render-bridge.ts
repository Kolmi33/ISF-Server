// Lets imperative, non-React modules (`grid-scroll.ts`, `grid-interaction.ts`) trigger a
// repaint of the mounted `Grid` component without importing it directly (F8 cleanup,
// ARCHITECTURE_AUDIT.md). `Grid.tsx` already imports both of those modules itself
// (`daysPerWeek`/`paintSelection`) — a reverse direct import for the render trigger would be a
// genuine two-way cycle in both directions, not just an unwired convenience. This tiny module
// breaks that: `Grid.tsx` registers its force-update trigger here once, on mount; everyone
// else calls `triggerGridRender()`. Same shape as `Grid.tsx`'s own (still-local)
// `windowRenderTrigger` ref, just factored out so it has no dependents of its own.

let renderTrigger: (() => void) | null = null;

/** Registered by the mounted `Grid` component (Phase 7 slice B1) — cleared again on unmount,
 *  though `Grid` mounts once at boot and never unmounts in practice. */
export function registerGridRenderTrigger(trigger: (() => void) | null): void {
  renderTrigger = trigger;
}

/** Request a repaint of the mounted `Grid`. A no-op before `Grid` has mounted — never happens
 *  in practice, since `Grid` mounts at boot before any of this module's callers can run. */
export function triggerGridRender(): void {
  renderTrigger?.();
}
