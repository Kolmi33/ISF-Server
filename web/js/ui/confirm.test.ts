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
  it('shows the dialog with defaults when no options are given, and focuses "Abbrechen"', () => {
    void askConfirm({});
    expect(box().classList.contains('open')).toBe(true);
    expect(document.getElementById('cfTitle')!.textContent).toBe('Wirklich löschen?');
    expect(document.getElementById('cfYes')!.textContent).toBe('Löschen');
    expect(document.getElementById('cfNo')!.textContent).toBe('Abbrechen');
    expect(document.getElementById('cfYes')!.className).toBe('btn dangerfill');
    expect(document.activeElement).toBe(document.getElementById('cfNo'));
  });

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

  it('renders the confirm button as neutral "primary" when danger is explicitly false', () => {
    void askConfirm({ danger: false });
    expect(document.getElementById('cfYes')!.className).toBe('btn primary');
  });

  it('resolves true on "Ja", closing the dialog and clearing both click handlers', async () => {
    const promise = askConfirm({});
    document.getElementById('cfYes')!.click();
    expect(await promise).toBe(true);
    expect(box().classList.contains('open')).toBe(false);
    expect(document.getElementById('cfYes')!.onclick).toBeNull();
    expect(document.getElementById('cfNo')!.onclick).toBeNull();
  });

  it('resolves false on "Nein", closing the dialog', async () => {
    const promise = askConfirm({});
    document.getElementById('cfNo')!.click();
    expect(await promise).toBe(false);
    expect(box().classList.contains('open')).toBe(false);
  });

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
