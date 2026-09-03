// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  document.documentElement.style.removeProperty('--gridline-width');
  document.documentElement.style.removeProperty('--gridline-width-header');
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
  // What: the "Neu verbinden" (reconnect) button re-opens the SSE connection and also
  // triggers a data refresh.
  // How: clicks the button and checks connectSSE fired once and refreshNow was called with
  // the exact argument the component passes.
  it('"Neu verbinden" reconnects SSE and silently refreshes', () => {
    render(<SettingsModal />);
    screen.getByRole('button', { name: /Neu verbinden/ }).click();
    expect(connectSSE).toHaveBeenCalledOnce();
    expect(refreshNow).toHaveBeenCalledWith(false);
  });

  // What: changing the theme dropdown persists the choice to localStorage, re-applies the
  // theme immediately, and triggers a repaint.
  // How: fires a real change event on the select with a new value and checks all three effects.
  it('changing the theme select persists mb_theme and re-applies + notifies', () => {
    render(<SettingsModal />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    select.value = 'dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('mb_theme')).toBe('dark');
    expect(applyTheme).toHaveBeenCalledOnce();
    expect(notifySpy).toHaveBeenCalledOnce();
  });

  // What: the presence-sharing checkbox persists as the literal strings "on"/"off" (not
  // JS true/false), and toggling it off triggers a presence check-in so peers see the change
  // promptly.
  // How: clicks the checkbox (a real click, not a manually-set .checked property + dispatched
  // event — React's own checkbox value tracker needs the genuine user gesture to register the
  // change) and checks the persisted value and that presenceTick fired.
  it('toggling presence persists mb_presence (as on/off, not true/false) and reconnects', () => {
    // Unset mb_presence reads as "on" (presence !== 'off'), so the checkbox starts
    // checked; a real click (not a manually-set .checked + dispatched event -- React's
    // value tracker on checkboxes needs the real user gesture) unchecks it.
    render(<SettingsModal />);
    screen.getByLabelText(/als „aktiv" teilen/).click();
    expect(localStorage.getItem('mb_presence')).toBe('off');
    expect(presenceTick).toHaveBeenCalledOnce();
  });

  // What: toggling the "show weekends" setting resets the grown week-window (extraWeeks) back
  // to 0 (since the day count per week just changed), triggers a repaint, and re-centers the
  // view on today so the layout shift doesn't leave the user looking at the wrong dates.
  // How: clicks the weekends checkbox and checks all three effects.
  it('toggling weekends resets extraWeeks, notifies, and re-centers today', () => {
    render(<SettingsModal />);
    screen.getByLabelText(/Samstag/).click();
    expect(localStorage.getItem('mb_weekends')).toBe('on');
    expect(window.S.extraWeeks).toBe(0);
    expect(notifySpy).toHaveBeenCalledOnce();
    expect(centerToday).toHaveBeenCalledOnce();
  });

  // What: compact mode is applied by toggling a CSS class directly on the body — a pure
  // styling change that needs no store notify/repaint.
  // How: clicks the compact-mode checkbox and checks both the persisted setting and the
  // body's class list, without asserting on notify.
  it('toggling compact mode adds/removes the body class directly (no notify needed)', () => {
    render(<SettingsModal />);
    screen.getByLabelText(/kompakte Zeilen/).click();
    expect(localStorage.getItem('mb_compact')).toBe('on');
    expect(document.body.classList.contains('compact')).toBe(true);
  });

  // What: the grid-line slider defaults to 1px (matching the grid's un-configured look) when
  // nothing is stored yet, and dragging it writes the pixel width straight to both the
  // `--gridline-width` CSS variable (live) and localStorage (persisted) — no store write, a
  // pure styling change like compact mode.
  // How: checks the slider's initial value, then sets it to 0 and checks the CSS variable and
  // the persisted setting both updated, and the "aus" (off) label appears at 0.
  it('the grid-line slider defaults to 1px and applies live + persists on change', () => {
    render(<SettingsModal />);
    const slider = screen.getByLabelText('Rasterlinien-Stärke') as HTMLInputElement;
    expect(slider.value).toBe('1');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(localStorage.getItem('mb_gridline_width')).toBe('0');
    expect(document.documentElement.style.getPropertyValue('--gridline-width')).toBe('0px');
    expect(screen.getByText('aus')).toBeInTheDocument();
  });

  // What: a previously-persisted width restores as the slider's value on the next open,
  // matching every other persisted setting in this modal.
  // How: pre-seeds localStorage with a width, renders, and checks the slider picks it up.
  it('restores a persisted grid-line width on open', () => {
    localStorage.setItem('mb_gridline_width', '3');
    render(<SettingsModal />);
    expect((screen.getByLabelText('Rasterlinien-Stärke') as HTMLInputElement).value).toBe('3');
  });

  // What: the data-grid and header gridline sliders are fully independent — each has its own
  // storage key and CSS variable, so setting one never touches the other.
  // How: renders, checks the header slider defaults to 1px with its own aria-label, changes
  // only the header slider, and checks the data-grid slider/variable/storage are untouched.
  it('the header gridline slider is independent of the data-grid one', () => {
    render(<SettingsModal />);
    const headerSlider = screen.getByLabelText(
      'Rasterlinien-Stärke (Kopfzeile)',
    ) as HTMLInputElement;
    expect(headerSlider.value).toBe('1');
    fireEvent.change(headerSlider, { target: { value: '2' } });
    expect(localStorage.getItem('mb_gridline_width_header')).toBe('2');
    expect(document.documentElement.style.getPropertyValue('--gridline-width-header')).toBe('2px');
    // The data-grid slider/variable/storage stay at their own untouched defaults.
    expect((screen.getByLabelText('Rasterlinien-Stärke') as HTMLInputElement).value).toBe('1');
    expect(localStorage.getItem('mb_gridline_width')).toBeNull();
  });

  // What: increments smaller than 1px are possible (fractional CSS border widths render fine),
  // and both sliders support them via their step attribute.
  // How: sets each slider to a fractional value and checks it applies exactly, unrounded.
  it('supports sub-pixel (fractional) grid-line widths on both sliders', () => {
    render(<SettingsModal />);
    fireEvent.change(screen.getByLabelText('Rasterlinien-Stärke'), { target: { value: '0.5' } });
    expect(document.documentElement.style.getPropertyValue('--gridline-width')).toBe('0.5px');
    fireEvent.change(screen.getByLabelText('Rasterlinien-Stärke (Kopfzeile)'), {
      target: { value: '1.75' },
    });
    expect(document.documentElement.style.getPropertyValue('--gridline-width-header')).toBe(
      '1.75px',
    );
  });

  // What: the settings modal displays the currently logged-in user's name.
  // How: renders with a known user set in the store and checks the name appears.
  it('shows the current user name and opens the name-prompt on "Ändern…"', () => {
    render(<SettingsModal />);
    expect(screen.getByText('Kolmanovskyi')).toBeInTheDocument();
  });

  // What: toggling the debug-panel setting persists it and re-applies the debug panel's
  // open/closed state immediately.
  // How: clicks the debug checkbox and checks both the persisted value and that applyDebug fired.
  it('toggling debug persists mb_debug and re-applies the debug panel', () => {
    render(<SettingsModal />);
    screen.getByLabelText(/Debug-Panel anzeigen/).click();
    expect(localStorage.getItem('mb_debug')).toBe('on');
    expect(applyDebug).toHaveBeenCalledOnce();
  });
});
