// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { askConfirm } from './confirm.ts';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="confirm2" role="dialog" aria-modal="true">
      <div class="cbox">
        <h3 id="cfTitle"></h3>
        <div id="cfBody"></div>
        <div class="modal-actions">
          <button class="btn" id="cfNo">Abbrechen</button>
          <button class="btn dangerfill" id="cfYes">Löschen</button>
        </div>
      </div>
    </div>`;
});

function box(): HTMLElement {
  return document.getElementById('confirm2')!;
}

describe('askConfirm', () => {
  // What: with no options given, the dialog opens with German default text, a danger-styled
  // confirm button, and keyboard focus starting on the safer "Abbrechen" (cancel) button.
  // How: calls askConfirm({}) against the stub dialog markup and checks the open class, the
  // default title/button texts, the destructive button styling, and document.activeElement.
  it('shows the dialog with defaults when no options are given, and focuses "Abbrechen"', () => {
    void askConfirm({});
    expect(box().classList.contains('open')).toBe(true);
    expect(document.getElementById('cfTitle')!.textContent).toBe('Wirklich löschen?');
    expect(document.getElementById('cfYes')!.textContent).toBe('Löschen');
    expect(document.getElementById('cfNo')!.textContent).toBe('Abbrechen');
    expect(document.getElementById('cfYes')!.className).toContain('bg-destructive/10');
    expect(document.activeElement).toBe(document.getElementById('cfNo'));
  });

  // What: given options override the defaults, and `body` is inserted as HTML (not escaped
  // text) so a caller can bold a count or similar.
  // How: calls askConfirm with all four customizable fields and checks each landed in the DOM,
  // with body specifically checked via innerHTML to confirm it wasn't escaped.
  it('fills in the given title, body (as HTML), and button labels', () => {
    void askConfirm({
      title: 'Sicher?',
      body: '<b>3</b> Einträge',
      yes: 'Ja klar',
      no: 'Doch nicht',
    });
    expect(document.getElementById('cfTitle')!.textContent).toBe('Sicher?');
    expect(document.getElementById('cfBody')!.innerHTML).toBe('<b>3</b> Einträge');
    expect(document.getElementById('cfYes')!.textContent).toBe('Ja klar');
    expect(document.getElementById('cfNo')!.textContent).toBe('Doch nicht');
  });

  // What: an explicit `danger: false` renders the confirm button as a neutral "primary" style
  // instead of the default red/danger style, for confirmations that aren't destructive.
  // How: calls askConfirm with danger:false and checks the confirm button's class name.
  it('renders the confirm button as neutral "primary" when danger is explicitly false', () => {
    void askConfirm({ danger: false });
    expect(document.getElementById('cfYes')!.className).toContain('bg-primary-deep');
  });

  // What: clicking the confirm ("Ja") button resolves the promise true, closes the dialog,
  // and clears both buttons' click handlers so a stale handler can't fire on a later reuse.
  // How: awaits the promise askConfirm returns after clicking cfYes, checking the resolved
  // value, the dialog's closed state, and that both buttons' onclick are cleared.
  it('resolves true on "Ja", closing the dialog and clearing both click handlers', async () => {
    const promise = askConfirm({});
    document.getElementById('cfYes')!.click();
    expect(await promise).toBe(true);
    expect(box().classList.contains('open')).toBe(false);
    expect(document.getElementById('cfYes')!.onclick).toBeNull();
    expect(document.getElementById('cfNo')!.onclick).toBeNull();
  });

  // What: clicking cancel ("Nein") resolves the promise false and closes the dialog, the
  // mirror case of confirming.
  // How: awaits the promise after clicking cfNo and checks both the resolved value and the
  // dialog's closed state.
  it('resolves false on "Nein", closing the dialog', async () => {
    const promise = askConfirm({});
    document.getElementById('cfNo')!.click();
    expect(await promise).toBe(false);
    expect(box().classList.contains('open')).toBe(false);
  });

  // What: the dialog markup is static and reused across calls — a second askConfirm() call
  // re-fills the same DOM nodes and re-wires fresh click handlers, independent of the first call.
  // How: runs a full confirm-then-resolve cycle, then starts a second call with different
  // text and checks the title updated and the second call resolves independently (false, via cfNo).
  it('a second, independent call re-fills and re-wires the same static dialog', async () => {
    const first = askConfirm({ title: 'Erste Frage' });
    document.getElementById('cfYes')!.click();
    expect(await first).toBe(true);

    const second = askConfirm({ title: 'Zweite Frage' });
    expect(document.getElementById('cfTitle')!.textContent).toBe('Zweite Frage');
    document.getElementById('cfNo')!.click();
    expect(await second).toBe(false);
  });
});
