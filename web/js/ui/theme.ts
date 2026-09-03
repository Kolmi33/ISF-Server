// =======================================================================================
// THEME MODULE (web/js/ui/theme.ts)
// =======================================================================================
//
// Dark/light theme application. The boot-time wiring (the initial call, the `matchMedia`
// "change" listener that re-applies it live, and the `mb_compact` class application) lives
// in `app.ts`'s boot orchestration, which calls this function directly.
//
// =======================================================================================

/** Applies the device's theme preference (`mb_theme`: 'light' | 'dark' | 'auto') to
 *  `<html data-theme>`. 'auto' follows the OS preference via `prefers-color-scheme`. */
export function applyTheme(): void {
  const preference = localStorage.getItem('mb_theme') || 'auto';
  const isDark =
    preference === 'dark' ||
    (preference === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
}
