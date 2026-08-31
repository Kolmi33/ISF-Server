// Dark/light theme application (Phase 7 slice B10f). Faithful port of legacy `applyTheme`.
// The boot-time initialization (the initial call, the `matchMedia` "change" listener that
// re-applies it live, and the `mb_compact` class application) stays in legacy.js for now —
// absorbed into `app.ts`'s boot orchestration in Phase 7 slice B10g, when `start`/`startUI`/
// `init` move; it keeps calling this function by its (now window-bridged) bare name unchanged.

/** Apply the device's theme preference (`mb_theme`: 'light' | 'dark' | 'auto') to
 *  `<html data-theme>`. 'auto' follows the OS preference. */
export function applyTheme(): void {
  const preference = localStorage.getItem('mb_theme') || 'auto';
  const isDark =
    preference === 'dark' ||
    (preference === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
}
