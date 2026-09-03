// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { AppState } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';

// AskUserNameModal.tsx imports `updateUserChip`/`dbg`/`presenceTick` directly (F8 cleanup,
// ARCHITECTURE_AUDIT.md) rather than reaching through `window.*` — mocked here so this test
// keeps controlling/observing them as before.
vi.mock('../user-chip.ts', () => ({ updateUserChip: vi.fn() }));
vi.mock('../debug-panel.ts', () => ({ dbg: vi.fn() }));
vi.mock('../live-connection.ts', () => ({ presenceTick: vi.fn().mockResolvedValue(undefined) }));

import { AskUserNameModal, askUserName } from './AskUserNameModal.tsx';
import { updateUserChip } from '../user-chip.ts';
import { dbg } from '../debug-panel.ts';
import { presenceTick } from '../live-connection.ts';

// window.S is kept aliased to store.state so the component (migrated onto the real store) and
// this test agree; window.notify forwards to store.notify() exactly as app.ts does in
// production, so notifySpy sees every repaint trigger.
const notifySpy = vi.spyOn(store, 'notify');

function stubWindowGlobals(): void {
  store.set({ user: '' } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  window.notify = () => store.notify();
  vi.mocked(updateUserChip).mockClear();
  vi.mocked(dbg).mockClear();
  vi.mocked(presenceTick).mockClear();
}

// Every test needs the real #overlay/#modal DOM structure, not just the ones that open the
// modal through `askUserName` — clicking "Speichern" calls closeReactModal() regardless of
// how the component was mounted, and that reaches into #overlay unconditionally.
beforeEach(() => {
  document.body.innerHTML = `
    <div id="overlay"><div id="modal" tabindex="-1"></div></div>
    <div id="modalReopen"></div>`;
  stubWindowGlobals();
});

describe('AskUserNameModal', () => {
  // What: the modal shows a "Cancel" button on a repeat visit (the user already has a name
  // and is just changing it), but hides it on the very first run (there's nothing to cancel
  // back to — a name is required to proceed).
  // How: renders with firstRun:false (Cancel present), then re-renders with firstRun:true and
  // checks Cancel is gone.
  it('shows Cancel on a repeat visit but not on the first run', () => {
    const { rerender } = render(<AskUserNameModal firstRun={false} />);
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
    rerender(<AskUserNameModal firstRun={true} />);
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();
  });

  // What: clicking Save with an empty name field does nothing — no user is set, no side
  // effects run, the modal presumably stays open for a real name.
  // How: renders, clicks Save with the input left empty, and checks the user stayed empty and
  // the chip update never fired.
  it('Speichern with an empty name does nothing (no user set, modal stays open)', () => {
    render(<AskUserNameModal firstRun={false} />);
    screen.getByRole('button', { name: 'Speichern' }).click();
    expect(window.S.user).toBe('');
    expect(updateUserChip).not.toHaveBeenCalled();
  });

  // What: saving with a real name sets it as the current user (trimmed), persists it to
  // localStorage, updates the user-chip display, triggers a repaint, and kicks off a
  // presence check-in.
  // How: types a padded name into the input, clicks Save, and checks all five effects landed.
  it('Speichern with a name sets window.S.user, persists it, and notifies', () => {
    render(<AskUserNameModal firstRun={false} />);
    const input = screen.getByPlaceholderText('Nachname') as HTMLInputElement;
    input.value = '  Kolmanovskyi  '.trim();
    screen.getByRole('button', { name: 'Speichern' }).click();
    expect(window.S.user).toBe('Kolmanovskyi');
    expect(localStorage.getItem('mb_user')).toBe('Kolmanovskyi');
    expect(updateUserChip).toHaveBeenCalledOnce();
    expect(notifySpy).toHaveBeenCalledOnce();
    expect(presenceTick).toHaveBeenCalledOnce();
  });
});

describe('askUserName', () => {
  // What: unlike some other first-run modals, this one is never "sticky" — Escape always
  // dismisses it, even on the very first run where a name would otherwise be required.
  // How: opens the modal in first-run mode, fires Escape, and checks the overlay closed.
  it('is not sticky even on first run — Escape still dismisses it', () => {
    act(() => askUserName(true));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});
