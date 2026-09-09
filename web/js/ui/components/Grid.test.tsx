// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { AppState } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';

// GridBody.tsx imports `nextFreePtr`/`prevFreeBefore` directly from `../favorite-jump.ts`, and
// Grid.tsx imports `syncJumpControls`/`ensureOverflow` directly from `../grid-scroll.ts` (F8
// cleanup, ARCHITECTURE_AUDIT.md) rather than reaching through `window.*` — mocked here so
// this test keeps controlling/observing them as before. `../grid-scroll.ts` keeps its other
// real exports (`daysPerWeek`, used by `computeGridViewModel`); only these two are replaced.
vi.mock('../favorite-jump.ts', () => ({
  nextFreePtr: {} as Record<string, string>,
  prevFreeBefore: vi.fn().mockReturnValue(null),
}));
vi.mock('../grid-scroll.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../grid-scroll.ts')>()),
  syncJumpControls: vi.fn(),
  ensureOverflow: vi.fn(),
}));

import { Grid, render as renderGrid } from './Grid.tsx';
import { nextFreePtr, prevFreeBefore } from '../favorite-jump.ts';
import { syncJumpControls, ensureOverflow } from '../grid-scroll.ts';

// A real Monday (TZ pinned to UTC in test/setup.ts, so local date === this UTC date).
const TODAY = '2021-01-04';

function stubWindowGlobals(): void {
  for (const key of Object.keys(nextFreePtr)) delete nextFreePtr[key];
  vi.mocked(prevFreeBefore).mockReset().mockReturnValue(null);
  vi.mocked(syncJumpControls).mockClear();
  vi.mocked(ensureOverflow).mockClear();
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
    gridQuery: '',
    gridAvailableOnly: false,
    gridOperationalOnly: false,
    gridFavoritesOnly: false,
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
  // Grid.tsx exercises category-fold.ts (toggleCategory/toggleAllGroupsInCategory), which now
  // reads/writes state via the real `store` singleton, not a disconnected window.S object —
  // window.S is kept aliased to the same object so both sides agree.
  store.set(buildAppState());
  window.S = store.state;
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
  // What: before the first server data load (S.data is null), the grid renders neither a
  // header nor a body — matching the store-subscription guard that keeps it from painting
  // against nonexistent data.
  // How: sets S.data to null before rendering and checks neither thead nor tbody exist.
  it('renders nothing before the first data load, matching the store-subscription guard', () => {
    window.S.data = null;
    const { container } = renderGridIntoTable();
    expect(container.querySelector('thead')).toBeNull();
    expect(container.querySelector('tbody')).toBeNull();
  });

  // What: the header shows the ISO week number and marks today's own weekday column.
  // How: renders and checks the "KW 1" text and a `th.today` element both appear.
  it('renders the date header: one KW column and a today-marked weekday column', () => {
    const { container } = renderGridIntoTable();
    expect(container.textContent).toContain('KW 1');
    const todayHeader = container.querySelector('thead tr:nth-child(2) th.today');
    expect(todayHeader).not.toBeNull();
  });

  // What: the "KW X" header carries its own pinning class (app.css sticks it to the left edge,
  // right after the machine column, while its week is being scrolled through) — otherwise it
  // would scroll away with its columns and there'd be no visible way to tell which week is
  // currently in view once scrolled past the very first column.
  // How: renders and checks the KW header cell has the "kwhead" class.
  it('gives the "KW X" header its own pinning class', () => {
    const { container } = renderGridIntoTable();
    const kwHeader = container.querySelector('thead tr:first-child th.kwhead');
    expect(kwHeader).not.toBeNull();
    expect(kwHeader!.textContent).toContain('KW 1');
  });

  // Categories live exclusively in the segmented switch; the body begins with group rows.
  it('renders group rows without redundant category header rows', () => {
    const { container } = renderGridIntoTable();
    expect(container.querySelector('tr[data-catgroup]')).toBeNull();
    expect(container.querySelector('tr[data-group="Halle 1"]')).not.toBeNull();
  });

  it('covers every physical date and week-gap column in sticky group rows', () => {
    const { container } = renderGridIntoTable();
    const group = container.querySelector<HTMLTableRowElement>('tr[data-group="Halle 1"]')!;
    const dateColumns = container.querySelectorAll('thead tr:nth-child(2) th').length;
    const weekGaps = container.querySelectorAll('thead th.gap').length;
    expect(group.cells).toHaveLength(1 + dateColumns + weekGaps);
    expect(group.querySelectorAll('td.group-fill')).toHaveLength(dateColumns + weekGaps);
    expect(group.querySelector('[colspan]')).toBeNull();
  });

  it('renders favorites with the same group-row treatment as every machine group', () => {
    const { container } = renderGridIntoTable();
    const favorites = container.querySelector<HTMLTableRowElement>('tr[data-group="★ Favoriten"]')!;
    const regularGroup = container.querySelector<HTMLTableRowElement>('tr[data-group="Halle 1"]')!;
    expect(favorites).not.toBeNull();
    expect(favorites.classList.contains('grouprow')).toBe(true);
    expect(favorites.classList.contains('catrow')).toBe(false);
    expect(favorites.querySelectorAll('td.group-fill')).toHaveLength(
      regularGroup.querySelectorAll('td.group-fill').length,
    );
  });

  // What: a cell booked by the current logged-in user gets the "mine" class in addition to
  // "booked", shows the booker's name as text, and carries the note/group title in its hover title.
  // How: renders the fixture's "m-mine" cell (booked by 'anna', the logged-in user) and
  // checks the class, text, and title.
  it('renders a booked cell owned by the current user as "mine"', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-machine-id="m-mine"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('booked');
    expect(cell.className).toContain('mine');
    expect(cell.textContent).toBe('anna');
    expect(cell.getAttribute('title')).toContain('dringend');
    expect(cell.getAttribute('title')).toContain('Projekt X');
  });

  // Semantic booking surfaces are class-driven, so live patches cannot leave stale person colours.
  it('uses the mine class without inline booking colours', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector<HTMLElement>(
      `td[data-machine-id="m-mine"][data-date="${TODAY}"]`,
    )!;
    expect(cell.className).toContain('mine');
    expect(cell.getAttribute('style')).toBeNull();
  });

  // What: a cell booked by someone else than the current user shows "booked" but never "mine".
  // How: renders the fixture's "m-other" cell (booked by 'bob', not the logged-in 'anna') and
  // checks the class and text.
  it('renders a booked cell owned by someone else without the "mine" class', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-machine-id="m-other"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('booked');
    expect(cell.className).not.toContain('mine');
    expect(cell.textContent).toBe('bob');
  });

  // What: a multi-day booking under one name merges into a single continuous bar — the run's
  // interior/end cells drop the border toward whichever neighbor shares their run (so the two
  // visually join), and only the run's middle cell prints the booker's name; the others stay
  // blank rather than repeating it.
  // How: books "m-favorite" solid across three consecutive days (Mon–Wed, all in week 1) and
  // checks each of the three cells' text and merge-left/merge-right classes individually.
  it('merges a multi-day booking into one continuous bar, naming only its middle cell', () => {
    window.S.data!.bookings['m-favorite'] = {
      '2021-01-04': { name: 'carla' }, // Mon
      '2021-01-05': { name: 'carla' }, // Tue — the run's middle day
      '2021-01-06': { name: 'carla' }, // Wed
    };
    const { container } = renderGridIntoTable();
    const cellFor = (date: string) =>
      container.querySelector(`td[data-machine-id="m-favorite"][data-date="${date}"]`)!;
    const mon = cellFor('2021-01-04');
    const tue = cellFor('2021-01-05');
    const wed = cellFor('2021-01-06');

    expect(mon.textContent).toBe('');
    expect(tue.textContent).toBe('carla');
    expect(wed.textContent).toBe('');

    expect(mon.className).not.toContain('merge-left');
    expect(mon.className).toContain('merge-right');
    expect(tue.className).toContain('merge-left');
    expect(tue.className).toContain('merge-right');
    expect(wed.className).toContain('merge-left');
    expect(wed.className).not.toContain('merge-right');
  });

  // What: each resource remains its own horizontal occupancy lane, matching the supplied model.
  // How: books adjacent machines for the same dates and checks that both retain a separate bar
  // and label instead of collapsing into one tall block.
  it('keeps identical bookings on adjacent machines as separate resource bars', () => {
    const days = { '2021-01-04': { name: 'carla' }, '2021-01-05': { name: 'carla' } };
    window.S.data!.bookings['m-mine'] = days;
    window.S.data!.bookings['m-other'] = days;
    const { container } = renderGridIntoTable();
    const cellFor = (machineId: string, date: string) =>
      container.querySelector(`td[data-machine-id="${machineId}"][data-date="${date}"]`)!;

    expect(cellFor('m-mine', '2021-01-04').className).not.toContain('merge-down');
    expect(cellFor('m-mine', '2021-01-04').className).not.toContain('merge-up');
    expect(cellFor('m-other', '2021-01-04').className).not.toContain('merge-up');
    expect(cellFor('m-other', '2021-01-04').className).not.toContain('merge-down');

    expect(cellFor('m-mine', '2021-01-04').textContent).toBe('carla');
    expect(cellFor('m-other', '2021-01-04').textContent).toBe('carla');
    expect(cellFor('m-mine', '2021-01-05').textContent).toBe('');
    expect(cellFor('m-other', '2021-01-05').textContent).toBe('');
  });

  // What: a category/group header sitting between two machine rows genuinely breaks their
  // visual adjacency — two machines separated by one never merge, even booked identically,
  // since there really is a header row between their <tr>s in the rendered table.
  // How: books "m-other" and "m-unavail" (separated by the "Halle 2" group header in the
  // fixture's rendered order) identically and checks neither reports merging toward the other.
  it('does not merge two machine rows separated by a category/group header', () => {
    const day = { [TODAY]: { name: 'carla' } };
    window.S.data!.bookings['m-other'] = day;
    window.S.data!.bookings['m-unavail'] = day;
    const { container } = renderGridIntoTable();
    const cellFor = (machineId: string) =>
      container.querySelector(`td[data-machine-id="${machineId}"][data-date="${TODAY}"]`)!;

    expect(cellFor('m-other').className).not.toContain('merge-down');
    expect(cellFor('m-unavail').className).not.toContain('merge-up');
    // Each row is its own independent 1-cell block, so each shows its own name.
    expect(cellFor('m-other').textContent).toBe('carla');
    expect(cellFor('m-unavail').textContent).toBe('carla');
  });

  // What: a cell blocked by an active maintenance slot renders as "blocked" with the slot's
  // note visible as a hover title.
  // How: renders the fixture's "m-blocked" cell (an active 'defekt' slot with a note) and
  // checks the class and title.
  it('renders a blocked cell with the maintenance note as its title', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-machine-id="m-blocked"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('blocked');
    expect(cell.getAttribute('title')).toContain('Achse fest');
  });

  // What: a cell on a weekday the machine isn't scheduled to work renders as "unavail".
  // How: renders the fixture's "m-unavail" cell (a mask with Monday off, and today is Monday)
  // and checks the class.
  it('renders an unavailable cell for a machine closed on that weekday', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-machine-id="m-unavail"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('unavail');
  });

  // What: a cell with none of the blocking conditions (not booked, not blocked, available
  // that weekday) renders "free".
  // How: renders the fixture's "m-favorite" cell (unbooked, unblocked, no mask restriction)
  // and checks the class.
  it('renders a free cell for an otherwise-unencumbered machine', () => {
    const { container } = renderGridIntoTable();
    const cell = container.querySelector(`td[data-machine-id="m-favorite"][data-date="${TODAY}"]`)!;
    expect(cell.className).toContain('free');
  });

  // What: a favorited machine's row shows a filled favorite star, and one with an info note
  // also shows an info icon (distinct row-decoration concerns, both checked in the same row).
  // How: renders and checks the fixture's favorited, info-bearing machine row has both a
  // filled favstar and a machinfo icon.
  it('shows the filled star and info icon for a favorited machine with an info note', () => {
    const { container } = renderGridIntoTable();
    const row = container.querySelector('td[title*="Bohrer"]')!;
    expect(row.querySelector('.favstar.fav')).not.toBeNull();
    expect(row.querySelector('.machinfo')).not.toBeNull();
  });

  // What: a machine with a maintenance slot scheduled for the future (not covering today
  // yet) shows a "block planned" indicator, distinct from an actually-active block.
  // How: renders the fixture's machine with a far-future maintenance slot and checks the
  // "Sperre geplant" text appears somewhere in the render.
  it('shows "Sperre geplant" for a machine whose maintenance slot is not active yet', () => {
    const { container } = renderGridIntoTable();
    expect(container.textContent).toContain('Sperre geplant');
  });

  // What: the "jump back" (undo the last next-free jump) button only appears once a jump has
  // actually been made for that machine AND there's somewhere to jump back to.
  // How: seeds a pending forward pointer and stubs the "is there an earlier free day" check
  // to return one, then checks the jump-back button renders for that machine.
  it('shows the "jump back" button once a next-free jump has been made and can be undone', () => {
    nextFreePtr['m-favorite'] = '2021-01-05';
    vi.mocked(prevFreeBefore).mockReturnValue(TODAY);
    const { container } = renderGridIntoTable();
    expect(container.querySelector('span.nextfree.back[data-nb="m-favorite"]')).not.toBeNull();
  });

  // The reference uses an exclusive segmented control: selecting one category immediately
  // replaces the other and persists the selection.
  it('selects exactly one category from the segmented control', () => {
    const { container } = renderGridIntoTable();
    const button = container.querySelector<HTMLButtonElement>(
      'button.catbtn[data-cat="messtechnik"]',
    )!;
    button.click();
    expect(window.S.cats).toEqual(new Set(['messtechnik']));
    expect(JSON.parse(localStorage.getItem('mb_cats')!)).toEqual(['messtechnik']);
  });

  it('marks only the selected category button as pressed', () => {
    window.S.cats = new Set(['maschine']);
    const { container } = renderGridIntoTable();
    expect(container.querySelector('[data-cat="maschine"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(container.querySelector('[data-cat="messtechnik"]')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  // What: rendering the grid writes back which machines/dates it actually rendered into
  // S.visM/S.visD — a contract other modules (selection, navigation, jump-to-free) rely on to
  // know what's currently visible, without needing their own separate visibility computation.
  // How: renders and checks S.visD covers the full rendered week's dates and S.visM includes
  // machines known to be in that render.
  it("mutates S.visM/S.visD to the machines and dates it actually rendered (legacy's contract)", () => {
    renderGridIntoTable();
    expect(window.S.visD).toEqual([TODAY, '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08']);
    expect(window.S.visM).toContain('m-mine');
    expect(window.S.visM).toContain('m-blocked');
  });

  // What: after rendering, Grid runs its post-render side effects — the real
  // paintSelection() (no separate mock; just checked for not throwing) plus the still
  // window-bridged syncJumpControls/ensureOverflow calls.
  // How: renders and checks it doesn't throw, plus that both bridged functions were called.
  it('calls the post-render side effects: real paintSelection (no throw) + the still-bridged syncJumpControls/ensureOverflow', () => {
    expect(() => renderGridIntoTable()).not.toThrow();
    expect(syncJumpControls).toHaveBeenCalled();
    expect(ensureOverflow).toHaveBeenCalled();
  });
});

describe('render (bridged as window.render)', () => {
  // What: calling the bridged render() function before any Grid instance has mounted is a
  // safe no-op (there's nothing to re-render yet).
  // How: calls renderGrid() with no prior render and checks it doesn't throw.
  it('is a no-op before any Grid has mounted', () => {
    expect(() => renderGrid()).not.toThrow();
  });

  // What: once a Grid is mounted, calling the bridged render() re-renders it to reflect
  // whatever's currently on window.S — the escape hatch legacy-style imperative code (outside
  // React's normal render cycle) uses to force a repaint after mutating state directly.
  // How: renders, mutates a machine's days mask directly on window.S (bypassing React state),
  // calls renderGrid(), and checks the affected cell's class updated to reflect the mutation.
  it('re-renders the mounted grid to reflect a fresh window.S mutation', () => {
    const { container } = renderGridIntoTable();
    expect(
      container.querySelector(`td[data-machine-id="m-unavail"][data-date="${TODAY}"]`)!.className,
    ).toContain('unavail');

    window.S.data!.machines = window.S.data!.machines.map((m) =>
      m.id === 'm-unavail' ? { ...m, days: undefined } : m,
    );
    act(() => renderGrid());

    expect(
      container.querySelector(`td[data-machine-id="m-unavail"][data-date="${TODAY}"]`)!.className,
    ).toContain('free');
  });
});
