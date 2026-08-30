// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AskUserNameModal, askUserName } from './AskUserNameModal.tsx';

function stubWindowGlobals(): void {
  window.S = { user: '' } as never;
  window.updateUserChip = vi.fn();
  window.notify = vi.fn();
  window.dbg = vi.fn();
  window.presenceTick = vi.fn().mockResolvedValue(undefined);
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
  it('shows Cancel on a repeat visit but not on the first run', () => {
    const { rerender } = render(<AskUserNameModal firstRun={false} />);
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
    rerender(<AskUserNameModal firstRun={true} />);
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();
  });

  it('Speichern with an empty name does nothing (no user set, modal stays open)', () => {
    render(<AskUserNameModal firstRun={false} />);
    screen.getByRole('button', { name: 'Speichern' }).click();
    expect(window.S.user).toBe('');
    expect(window.updateUserChip).not.toHaveBeenCalled();
  });

  it('Speichern with a name sets window.S.user, persists it, and notifies', () => {
    render(<AskUserNameModal firstRun={false} />);
    const input = screen.getByPlaceholderText('Nachname') as HTMLInputElement;
    input.value = '  Kolmanovskyi  '.trim();
    screen.getByRole('button', { name: 'Speichern' }).click();
    expect(window.S.user).toBe('Kolmanovskyi');
    expect(localStorage.getItem('mb_user')).toBe('Kolmanovskyi');
    expect(window.updateUserChip).toHaveBeenCalledOnce();
    expect(window.notify).toHaveBeenCalledOnce();
    expect(window.presenceTick).toHaveBeenCalledOnce();
  });
});

describe('askUserName', () => {
  it('is not sticky even on first run — Escape still dismisses it', () => {
    act(() => askUserName(true));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});
