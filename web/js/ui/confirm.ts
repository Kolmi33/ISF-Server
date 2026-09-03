// =======================================================================================
// CONFIRM DIALOG MODULE (web/js/ui/confirm.ts)
// =======================================================================================
//
// The Ja/Nein confirm dialog every destructive action in the app goes through.
//
// Key Principles:
// - PLAIN MODULE, NOT REACT: `#confirm2` is fully static markup already in `index.html`
//   (like the collision banner) — a plain module targeting it directly, not a component.
// - STABLE CONTRACT: every caller across the app depends on the exact
//   `(options) => Promise<boolean>` shape via `window.askConfirm` — preserved verbatim so
//   no call site needs to change if this module's internals ever do.
//
// =======================================================================================

export interface AskConfirmOptions {
  title?: string;
  body?: string;
  yes?: string;
  no?: string;
  /** `false` renders the confirm button as a neutral "primary" action instead of the default
   *  destructive "dangerfill" one — for a plain yes/no question rather than a delete. */
  danger?: boolean;
}

/**
 * Shows `#confirm2` populated with `options`, resolving `true`/`false` for Ja/Nein.
 *
 * `options.body` is raw HTML (it's set via `innerHTML`) — callers must escape any
 * user-entered value themselves via `escapeHtml` (`ui/escape-html.ts`) before interpolating
 * it into `body`; this function does no escaping of its own.
 */
export function askConfirm(options: AskConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    document.getElementById('cfTitle')!.textContent = options.title || 'Wirklich löschen?';
    document.getElementById('cfBody')!.innerHTML = options.body || '';
    const yesButton = document.getElementById('cfYes')!;
    yesButton.textContent = options.yes || 'Löschen';
    yesButton.className = options.danger === false ? 'btn primary' : 'btn dangerfill';
    const noButton = document.getElementById('cfNo')!;
    noButton.textContent = options.no || 'Abbrechen';
    const box = document.getElementById('confirm2')!;
    box.classList.add('open');
    noButton.focus();
    const done = (value: boolean): void => {
      box.classList.remove('open');
      yesButton.onclick = null;
      noButton.onclick = null;
      resolve(value);
    };
    yesButton.onclick = () => done(true);
    noButton.onclick = () => done(false);
  });
}
