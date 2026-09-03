// =======================================================================================
// HTML ESCAPING MODULE (web/js/ui/escape-html.ts)
// =======================================================================================
//
// HTML-escaping for the handful of places that still build an HTML string by hand.
//
// Key Principles:
// - A NARROW, DELIBERATE SEAM: `askConfirm`'s dialog (`ui/confirm.ts`) takes its `body` as
//   raw HTML (it does `innerHTML =`), so any user-entered value going into it — a booker's
//   name, a machine name, a group title — must be escaped here before interpolation.
//   Everywhere else in the app, React escapes text content automatically; this function
//   exists only for that one seam where a React component hands the confirm dialog a plain
//   HTML string instead of JSX.
//
// =======================================================================================

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes the five HTML-significant characters (`& < > " '`) in `value`, so it's safe to
 *  interpolate into an `innerHTML` string. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}
