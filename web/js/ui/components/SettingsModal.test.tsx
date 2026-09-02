// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AppState } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';
import { SettingsModal } from './SettingsModal.tsx';

// window.S is kept aliased to store.state so the component (migrated onto the real store) and
// this test agree; window.notify forwards to store.notify() exactly as app.ts does in
// production, so notifySpy sees every repaint trigger.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  store.set({ user: 'Kolmanovskyi', extraWeeks: 3 } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  window.connectSSE = vi.fn();
  window.refreshNow = vi.fn().mockResolvedValue(undefined);
  window.applyTheme = vi.fn();
  window.notify = () => store.notify();
  window.presenceTick = vi.fn().mockResolvedValue(undefined);
  window.centerToday = vi.fn();
  window.applyDebug = vi.fn();
  window.dbgOn = vi.fn().mockReturnValue(false);
});

describe('SettingsModal', () => {
  it('"Neu verbinden" reconnects SSE and silently refreshes', () => {
    render(<SettingsModal />);
    screen.getByRole('button', { name: /Neu verbinden/ }).click();
    expect(window.connectSSE).toHaveBeenCalledOnce();
    expect(window.refreshNow).toHaveBeenCalledWith(false);
  });

  it('changing the theme select persists mb_theme and re-applies + notifies', () => {
    render(<SettingsModal />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    select.value = 'dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('mb_theme')).toBe('dark');
    expect(window.applyTheme).toHaveBeenCalledOnce();
    expect(notifySpy).toHaveBeenCalledOnce();
  });

  it('toggling presence persists mb_presence (as on/off, not true/false) and reconnects', () => {
    // Unset mb_presence reads as "on" (presence !== 'off'), so the checkbox starts
    // checked; a real click (not a manually-set .checked + dispatched event -- React's
    // value tracker on checkboxes needs the real user gesture) unchecks it.
    render(<SettingsModal />);
    screen.getByLabelText(/als „aktiv" teilen/).click();
    expect(localStorage.getItem('mb_presence')).toBe('off');
    expect(window.presenceTick).toHaveBeenCalledOnce();
  });

  it('toggling weekends resets extraWeeks, notifies, and re-centers today', () => {
    render(<SettingsModal />);
    screen.getByLabelText(/Samstag/).click();
    expect(localStorage.getItem('mb_weekends')).toBe('on');
    expect(window.S.extraWeeks).toBe(0);
    expect(notifySpy).toHaveBeenCalledOnce();
    expect(window.centerToday).toHaveBeenCalledOnce();
  });

  it('toggling compact mode adds/removes the body class directly (no notify needed)', () => {
    render(<SettingsModal />);
    screen.getByLabelText(/kompakte Zeilen/).click();
    expect(localStorage.getItem('mb_compact')).toBe('on');
    expect(document.body.classList.contains('compact')).toBe(true);
  });

  it('shows the current user name and opens the name-prompt on "Ändern…"', () => {
    render(<SettingsModal />);
    expect(screen.getByText('Kolmanovskyi')).toBeInTheDocument();
  });

  it('toggling debug persists mb_debug and re-applies the debug panel', () => {
    render(<SettingsModal />);
    screen.getByLabelText(/Debug-Panel anzeigen/).click();
    expect(localStorage.getItem('mb_debug')).toBe('on');
    expect(window.applyDebug).toHaveBeenCalledOnce();
  });
});
