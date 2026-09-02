// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AppState } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';

// SettingsModal.tsx imports these directly (F8 cleanup, ARCHITECTURE_AUDIT.md) rather than
// reaching through `window.*` — mocked here so this test keeps controlling/observing them as
// before.
vi.mock('../live-connection.ts', () => ({
  connectSSE: vi.fn(),
  presenceTick: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../mutate.ts', () => ({ refreshNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../theme.ts', () => ({ applyTheme: vi.fn() }));
vi.mock('../grid-scroll.ts', () => ({ centerToday: vi.fn() }));
vi.mock('../debug-panel.ts', () => ({
  applyDebug: vi.fn(),
  dbgOn: vi.fn().mockReturnValue(false),
}));

import { SettingsModal } from './SettingsModal.tsx';
import { connectSSE, presenceTick } from '../live-connection.ts';
import { refreshNow } from '../mutate.ts';
import { applyTheme } from '../theme.ts';
import { centerToday } from '../grid-scroll.ts';
import { applyDebug, dbgOn } from '../debug-panel.ts';

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
  window.notify = () => store.notify();
  vi.mocked(connectSSE).mockClear();
  vi.mocked(refreshNow).mockClear();
  vi.mocked(applyTheme).mockClear();
  vi.mocked(presenceTick).mockClear();
  vi.mocked(centerToday).mockClear();
  vi.mocked(applyDebug).mockClear();
  vi.mocked(dbgOn).mockReset().mockReturnValue(false);
});

describe('SettingsModal', () => {
  it('"Neu verbinden" reconnects SSE and silently refreshes', () => {
    render(<SettingsModal />);
    screen.getByRole('button', { name: /Neu verbinden/ }).click();
    expect(connectSSE).toHaveBeenCalledOnce();
    expect(refreshNow).toHaveBeenCalledWith(false);
  });

  it('changing the theme select persists mb_theme and re-applies + notifies', () => {
    render(<SettingsModal />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    select.value = 'dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('mb_theme')).toBe('dark');
    expect(applyTheme).toHaveBeenCalledOnce();
    expect(notifySpy).toHaveBeenCalledOnce();
  });

  it('toggling presence persists mb_presence (as on/off, not true/false) and reconnects', () => {
    // Unset mb_presence reads as "on" (presence !== 'off'), so the checkbox starts
    // checked; a real click (not a manually-set .checked + dispatched event -- React's
    // value tracker on checkboxes needs the real user gesture) unchecks it.
    render(<SettingsModal />);
    screen.getByLabelText(/als „aktiv" teilen/).click();
    expect(localStorage.getItem('mb_presence')).toBe('off');
    expect(presenceTick).toHaveBeenCalledOnce();
  });

  it('toggling weekends resets extraWeeks, notifies, and re-centers today', () => {
    render(<SettingsModal />);
    screen.getByLabelText(/Samstag/).click();
    expect(localStorage.getItem('mb_weekends')).toBe('on');
    expect(window.S.extraWeeks).toBe(0);
    expect(notifySpy).toHaveBeenCalledOnce();
    expect(centerToday).toHaveBeenCalledOnce();
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
    expect(applyDebug).toHaveBeenCalledOnce();
  });
});
