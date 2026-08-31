// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { AppState } from '../../../../shared/types.ts';
import { Grid, render as renderGrid } from './Grid.tsx';

// A real Monday (TZ pinned to UTC in test/setup.ts, so local date === this UTC date).
const TODAY = '2021-01-04';

function stubWindowGlobals(): void {
  window.nextFreePtr = {};
  window.prevFreeBefore = vi.fn().mockReturnValue(null);
  window.paintSel = vi.fn();
  window.syncJumpControls = vi.fn();
  window.ensureOverflow = vi.fn();
  window.notify = vi.fn();
}

/** A minimal but realistic `AppState`, covering the branches the grid's row/cell rendering
 *  takes: a booked cell (mine and not-mine), a blocked cell, an unavailable cell, a free
 *  favorited machine with an info note and a reachable "jump back" button, and a machine with
 *  only a *planned* (not yet active) maintenance slot. */
function buildAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    data: {
      machines: [
        { id: 'm-mine', name: 'Fräse', group: 'Halle 1' },
        { id: 'm-other', name: 'Drehbank', group: 'Halle 1' },
        {
          id: 'm-blocked',
          name: 'Messgerät',
          group: 'Halle 1',
          cat: 'messtechnik',
          maint: [{ type: 'defekt', from: TODAY, until: TODAY, note: 'Achse fest' }],
        },
        { id: 'm-unavail', name: 'Presse', group: 'Halle 2', days: '0111111' }, // Mo off
        { id: 'm-favorite', name: 'Bohrer', group: 'Halle 2', info: 'Nur mit Einweisung' },
        {
          id: 'm-planned',
          name: 'Waage',
          group: 'Halle 2',
          maint: [{ type: 'wartung', from: '2099-01-01', until: '2099-12-31' }],
        },
      ],
      bookings: {
        'm-mine': { [TODAY]: { name: 'anna', note: 'dringend', gid: 'g1', gtitle: 'Projekt X' } },
        'm-other': { [TODAY]: { name: 'bob' } },
      },
      groups: ['Halle 1', 'Halle 2'],
      revision: 1,
      log: [],
    },
    readOnly: false,
    user: 'anna',
    startMonday: new Date(`${TODAY}T00:00:00Z`),
    weeks: 1,
    extraWeeks: 0,
    machSel: new Set(),
    groupsSel: new Set(),
    cats: new Set(['maschine', 'messtechnik']),
    collapsed: new Set(),
    person: '',
    personOnly: false,
    favs: new Set(['m-favorite']),
    visM: [],
    visD: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  // Run the grid's post-render `requestAnimationFrame(ensureOverflow)` synchronously rather
  // than relying on fake-timer support for it (varies by environment/version).
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    callback(0);
    return 0;
  });
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  stubWindowGlobals();
  window.S = buildAppState();
});

afterEach(() => {
  vi.useRealTimers();
});

/** `Grid` renders `<thead>`/`<tbody>` as siblings, mirroring how it's mounted directly onto
 *  `<table id="grid">` in app.ts — a real `<table>` container keeps jsdom from re-parenting them. */
function renderGridIntoTable() {
  const table = document.createElement('table');
  document.body.appendChild(table);
  return render(<Grid />, { container: table });
}

describe('Grid', () => {
  it('renders nothing before the first data load, matching the store-subscription guard', () => {
    window.S.data = null;
    const { container } = renderGridIntoTable();
    expect(container.querySelector('thead')).toBeNull();
    expect(container.querySelector('tbody')).toBeNull();
  });

  it('renders the date header: one KW column and a today-marked weekday column', () => {
    const { container } = renderGridIntoTable();
    expect(container.textContent).toContain('KW 1');
    const todayHeader = container.querySelector('thead tr:nth-child(2) th.today');
    expect(todayHeader).not.toBeNull();
  });

  it('renders a category header row and a group header row', () => {
    const { container } = renderGridIntoTable();
    expect(container.querySelector('tr[data-catgroup="maschine"]')).not.toBeNull();
    expect(container.querySelector('tr[data-catgroup="messtechnik"]')).not.toBeNull();
    expect(container.querySelector('tr[data-group="Halle 1"]')).not.toBeNull();
  });

  it('renders a booked cell owned by the current user as "mine"', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-mid="m-mine"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('booked');
    expect(cell.className).toContain('mine');
    expect(cell.textContent).toBe('anna');
    expect(cell.getAttribute('title')).toContain('dringend');
    expect(cell.getAttribute('title')).toContain('Projekt X');
  });

  it('renders a booked cell owned by someone else without the "mine" class', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-mid="m-other"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('booked');
    expect(cell.className).not.toContain('mine');
    expect(cell.textContent).toBe('bob');
  });

  it('renders a blocked cell with the maintenance note as its title', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-mid="m-blocked"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('blocked');
    expect(cell.getAttribute('title')).toContain('Achse fest');
  });

  it('renders an unavailable cell for a machine closed on that weekday', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-mid="m-unavail"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('unavail');
  });

  it('renders a free cell for an otherwise-unencumbered machine', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-mid="m-favorite"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('free');
  });

  it('shows the filled star and info icon for a favorited machine with an info note', () => {
    const { container } = renderGridIntoTable();
    const row = container.querySelector('td[title*="Bohrer"]')!;
    expect(row.querySelector('.favstar.fav')).not.toBeNull();
    expect(row.querySelector('.machinfo')).not.toBeNull();
  });

  it('shows "Sperre geplant" for a machine whose maintenance slot is not active yet', () => {
    const { container } = renderGridIntoTable();
    expect(container.textContent).toContain('Sperre geplant');
  });

  it('shows the "jump back" button once a next-free jump has been made and can be undone', () => {
    window.nextFreePtr['m-favorite'] = '2021-01-05';
    window.prevFreeBefore = vi.fn().mockReturnValue(TODAY);
    const { container } = renderGridIntoTable();
    expect(container.querySelector('span.nextfree.back[data-nb="m-favorite"]')).not.toBeNull();
  });

  it('a single click on a category button toggles it off after the debounce delay', () => {
    vi.useFakeTimers();
    const { container } = renderGridIntoTable();
    const button = container.querySelector(
      'button.catbtn[data-cat="maschine"]',
    ) as HTMLButtonElement;
    button.click();
    expect(window.S.cats.has('maschine')).toBe(true); // not yet — debounced
    vi.advanceTimersByTime(220);
    expect(window.S.cats.has('maschine')).toBe(false);
    vi.useRealTimers();
  });

  it('a double click cancels the pending single-click toggle and expands every group in the category', () => {
    vi.useFakeTimers();
    window.S.collapsed = new Set(['Halle 1']);
    const { container } = renderGridIntoTable();
    const button = container.querySelector(
      'button.catbtn[data-cat="maschine"]',
    ) as HTMLButtonElement;
    button.click(); // would toggle "maschine" off in 220ms
    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(window.S.cats.has('maschine')).toBe(true); // the pending single-click toggle never fired
    expect(window.S.collapsed.has('Halle 1')).toBe(false); // its group got expanded
    vi.useRealTimers();
  });

  it("mutates S.visM/S.visD to the machines and dates it actually rendered (legacy's contract)", () => {
    renderGridIntoTable();
    expect(window.S.visD).toEqual([TODAY, '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08']);
    expect(window.S.visM).toContain('m-mine');
    expect(window.S.visM).toContain('m-blocked');
  });

  it('calls the post-render legacy side effects (paintSel, syncJumpControls, ensureOverflow)', () => {
    renderGridIntoTable();
    expect(window.paintSel).toHaveBeenCalled();
    expect(window.syncJumpControls).toHaveBeenCalled();
    expect(window.ensureOverflow).toHaveBeenCalled();
  });
});

describe('render (bridged as window.render)', () => {
  it('is a no-op before any Grid has mounted', () => {
    expect(() => renderGrid()).not.toThrow();
  });

  it('re-renders the mounted grid to reflect a fresh window.S mutation', () => {
    const { container } = renderGridIntoTable();
    expect(
      container.querySelector(`td[data-mid="m-unavail"][data-date="${TODAY}"]`)!.className,
    ).toContain('unavail');

    window.S.data!.machines = window.S.data!.machines.map((m) =>
      m.id === 'm-unavail' ? { ...m, days: undefined } : m,
    );
    act(() => renderGrid());

    expect(
      container.querySelector(`td[data-mid="m-unavail"][data-date="${TODAY}"]`)!.className,
    ).toContain('free');
  });
});
