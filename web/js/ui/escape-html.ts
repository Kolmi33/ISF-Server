// HTML-escaping for the handful of places that still build an HTML string by hand — the
// `askConfirm(opts)` dialog (`ui/confirm.ts`, B10c) takes `opts.body` as raw HTML (it does
// `innerHTML=`), so any user-entered value going into it (a booker's name, a machine name, a
// group title) must be escaped here before interpolation. Everywhere else, React does this
// automatically — this is only for the seam where a React component hands the confirm dialog
// a plain HTML string. Faithful port of legacy `esc`.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}
