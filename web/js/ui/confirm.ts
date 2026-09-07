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

/* The two buttons are static markup, so they can't use the `Button` component — these are
   its `lg` ghost/primary/destructive variants written out once (docs/UI_STYLE_GUIDE.md §8). */
const BUTTON_BASE =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent px-4 text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px';
const BUTTON_GHOST = `${BUTTON_BASE} text-foreground hover:bg-muted`;
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-primary-deep text-primary-foreground hover:bg-primary-deep/90`;
const BUTTON_DESTRUCTIVE = `${BUTTON_BASE} bg-destructive/10 text-destructive hover:bg-destructive/20`;

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
    yesButton.className = options.danger === false ? BUTTON_PRIMARY : BUTTON_DESTRUCTIVE;
    const noButton = document.getElementById('cfNo')!;
    noButton.className = BUTTON_GHOST;
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
