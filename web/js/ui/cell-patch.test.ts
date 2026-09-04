// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppState, Machine } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import { refreshCell, refreshDot, patchCells } from './cell-patch.ts';

const TODAY = '2021-01-04'; // a real Monday

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

function buildDom(): void {
  // A bare <tr> assigned via innerHTML on a non-table container is invalid HTML and gets
  // silently dropped by the parser — it must be wrapped in a real <table><tbody>.
  document.body.innerHTML = `
    <table><tbody><tr>
      <td class="machcol"><span class="dot free"></span></td>
      <td class="cell free" data-machine-id="m1" data-date="${TODAY}"></td>
    </tr></tbody></table>`;
}

function cell(): HTMLElement {
  return document.querySelector(`td.cell[data-machine-id="m1"][data-date="${TODAY}"]`)!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  document.documentElement.removeAttribute('data-theme');
  buildDom();
  store.set({
    data: { machines: [machine()], bookings: {} },
    user: 'anna',
    visD: [TODAY],
  } as unknown as Partial<AppState>);
  window.S = store.state;
});

describe('refreshCell', () => {
  // What: patching a cell that isn't currently in the DOM (e.g. scrolled out of view) is a
  // safe no-op — it doesn't need to exist for the patch to be attempted.
  // How: calls refreshCell for a date not in the built DOM fixture and checks it doesn't throw.
  it('is a no-op when the cell is not currently rendered', () => {
    expect(() => refreshCell('m1', '2099-01-01', new Map())).not.toThrow();
  });

  // What: if the machine itself no longer exists in the loaded data (e.g. deleted
  // concurrently), the cell is left exactly as it was rather than erroring.
  // How: empties the machines list, patches the cell, and checks its class is unchanged.
  it('is a no-op when the machine no longer exists', () => {
    window.S.data!.machines = [];
    refreshCell('m1', TODAY, new Map());
    expect(cell().className).toBe('cell free'); // unchanged
  });

  // What: a cell blocked by maintenance renders with the "blocked" class and shows the
  // maintenance text (including its note) as a hover title.
  // How: gives the machine a maintenance slot covering today with a note, patches, and checks
  // both the class and the title.
  it('renders a blocked cell with the maintenance text as its title', () => {
    window.S.data!.machines = [
      machine({ maint: [{ type: 'defekt', from: TODAY, until: TODAY, note: 'kaputt' }] }),
    ];
    refreshCell('m1', TODAY, new Map());
    expect(cell().className).toContain('blocked');
    expect(cell().title).toContain('kaputt');
  });

  // What: a booked cell shows "booked", plus "mine" when the booker matches the current user
  // case-insensitively (not an exact-case match), the booker's name as text, and the note as
  // the hover title.
  // How: books today under a differently-cased version of the logged-in user's name, patches,
  // and checks the class, text, and title.
  it('renders a booked cell, marking it "mine" case-insensitively', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'Anna', note: 'wichtig' } } };
    refreshCell('m1', TODAY, new Map());
    expect(cell().className).toContain('booked');
    expect(cell().className).toContain('mine');
    expect(cell().textContent).toBe('Anna');
    expect(cell().title).toContain('wichtig');
  });

  // What: a cell on a weekday the machine doesn't work renders as "unavail", distinct from
  // blocked or booked.
  // How: gives the machine a days mask with today's weekday off and checks the class.
  it('renders an unavailable cell for a machine closed on that weekday', () => {
    window.S.data!.machines = [machine({ days: '0111111' })]; // Monday off
    refreshCell('m1', TODAY, new Map());
    expect(cell().className).toContain('unavail');
  });

  // What: with none of the other conditions applying (not booked, not blocked, available),
  // the cell renders "free" with empty text — and re-patching after a booking is removed
  // correctly reverts it back to free rather than leaving stale booked styling.
  // How: books the cell, patches, then clears the booking and patches again, checking the
  // final state is free with empty text.
  it('renders free when nothing else applies', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    refreshCell('m1', TODAY, new Map());
    window.S.data!.bookings = {};
    refreshCell('m1', TODAY, new Map());
    expect(cell().className).toContain('free');
    expect(cell().textContent).toBe('');
  });

  // Regression: refreshCell used to omit the `wknd` class the full render sets, so a booking
  // patch on a weekend column silently lost its weekend styling (PROGRESS.md Known Bugs, now
  // fixed). Covers every branch — the bug could resurface in any one of them independently.
  describe('the wknd class (weekend cells) — regression coverage', () => {
    const SATURDAY = '2021-01-09';

    beforeEach(() => {
      document.body.innerHTML = `
        <table><tbody><tr>
          <td class="machcol"><span class="dot free"></span></td>
          <td class="cell free" data-machine-id="m1" data-date="${TODAY}"></td>
          <td class="cell free" data-machine-id="m1" data-date="${SATURDAY}"></td>
        </tr></tbody></table>`;
    });

    function satCell(): HTMLElement {
      return document.querySelector(`td.cell[data-machine-id="m1"][data-date="${SATURDAY}"]`)!;
    }

    // What: a free weekend cell keeps its "wknd" styling class through a patch.
    // How: patches a Saturday cell with nothing else going on and checks the class survives.
    it('keeps wknd on a free weekend cell', () => {
      refreshCell('m1', SATURDAY, new Map());
      expect(satCell().className).toContain('wknd');
    });

    // What: the wknd class survives even when the cell is ALSO booked — the bug this whole
    // describe block pins was refreshCell dropping wknd regardless of which other state applied.
    // How: books the Saturday cell, patches, and checks wknd is still present alongside the
    // booked state.
    it('keeps wknd on a booked weekend cell', () => {
      window.S.data!.bookings = { m1: { [SATURDAY]: { name: 'anna' } } };
      refreshCell('m1', SATURDAY, new Map());
      expect(satCell().className).toContain('wknd');
    });

    // What: the wknd class survives when the cell is ALSO blocked by maintenance.
    // How: blocks the Saturday cell with a maintenance slot, patches, and checks wknd is
    // still present alongside the blocked state.
    it('keeps wknd on a blocked weekend cell', () => {
      window.S.data!.machines = [
        machine({ maint: [{ type: 'defekt', from: SATURDAY, until: SATURDAY }] }),
      ];
      refreshCell('m1', SATURDAY, new Map());
      expect(satCell().className).toContain('wknd');
    });

    // What: the wknd class survives when the cell is ALSO unavailable per the days mask.
    // How: gives the machine a mask with Saturday off, patches, and checks wknd is still
    // present alongside the unavailable state.
    it('keeps wknd on an unavailable weekend cell', () => {
      window.S.data!.machines = [machine({ days: '1111101' })]; // Mo..So mask, Saturday off
      refreshCell('m1', SATURDAY, new Map());
      expect(satCell().className).toContain('wknd');
    });

    // What: conversely, an ordinary weekday cell never gets the wknd class added — the fix
    // must apply only to actual weekend columns.
    // How: patches a Monday cell and checks the class does NOT contain wknd.
    it('does not add wknd to a weekday cell', () => {
      refreshCell('m1', TODAY, new Map()); // a Monday
      expect(cell().className).not.toContain('wknd');
    });
  });
});

describe('refreshDot', () => {
  function dot(): HTMLElement {
    return document.querySelector('.dot')!;
  }

  // What: refreshing a machine row's dot when that row isn't in the DOM at all is a safe no-op.
  // How: empties the document body entirely and checks calling refreshDot doesn't throw.
  it('is a no-op when the row has no cell rendered at all', () => {
    document.body.innerHTML = '';
    expect(() => refreshDot('m1')).not.toThrow();
  });

  // What: a row that exists but has no `.dot` element (a maintenance/stats row uses
  // `.statdot` for a different purpose instead) is also a safe no-op.
  // How: removes the `.dot` element from the fixture and checks refreshDot doesn't throw.
  it('is a no-op when the row has no .dot element (a maintenance row uses .statdot instead)', () => {
    document.querySelector('.dot')!.remove();
    expect(() => refreshDot('m1')).not.toThrow();
  });

  // What: a machine booked today shows the "busy" dot state, with the booker's name as the
  // hover title.
  // How: books today, refreshes the dot, and checks both the class and title.
  it("shows busy with the booker's name when booked today", () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    refreshDot('m1');
    expect(dot().className).toBe('dot busy');
    expect(dot().title).toContain('anna');
  });

  // What: a machine closed today (per its days mask) shows the "unavail" dot state.
  // How: gives the machine a mask with today's weekday off and checks the dot class.
  it('shows unavailable when the machine is closed today', () => {
    window.S.data!.machines = [machine({ days: '0111111' })];
    refreshDot('m1');
    expect(dot().className).toBe('dot unavail');
  });

  // What: with no booking, block, or unavailability, the dot shows "free".
  // How: refreshes the dot against the default fixture state and checks the class.
  it('shows free otherwise', () => {
    refreshDot('m1');
    expect(dot().className).toBe('dot free');
  });
});

describe('patchCells', () => {
  // What: patching a batch of cells updates each named cell's own styling AND refreshes the
  // today-dot for every row those cells belong to — a single call covers both levels.
  // How: books today, marks the machine visible, patches that one cell, and checks both the
  // cell's class and the row's dot reflect the new booked state.
  it("patches every named cell and refreshes each affected row's dot", () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    window.S.visM = ['m1'];
    patchCells([{ machineId: 'm1', date: TODAY }]);
    expect(cell().className).toContain('booked');
    expect(document.querySelector('.dot')!.className).toBe('dot busy');
  });

  // What: since patching a cell overwrites its whole className (wiping any `.sel`/`.kfocus`
  // selection-highlight classes it had), patchCells must repaint the current selection
  // afterward so a selected cell doesn't silently lose its highlight.
  // How: pre-marks the cell as selected, patches it (with nothing actually anchored/focused
  // in this fixture), and checks the stray `.sel` class was correctly cleared by the
  // post-patch selection repaint — proving that repaint step really ran, not just that the
  // patch itself happened to drop the class.
  it("repaints the selection afterward, since patching a cell's className wipes .sel/.kfocus", () => {
    cell().classList.add('sel');
    window.S.visM = ['m1'];
    patchCells([{ machineId: 'm1', date: TODAY }]);
    // Nothing is actually anchored/focused in this fixture, so the repaint correctly clears
    // the stray .sel left over from before the patch — proving paintSelection() really ran.
    expect(cell().classList.contains('sel')).toBe(false);
  });
});

// Regression: patchCells (and refreshCell underneath it) used to always show a booked cell's
// own name and never touch merge/mine styling at all, no matter how many days/machines the
// same booking actually spanned — so any write that goes through this patch path (nearly
// every one — see mutate.ts) could leave a merged multi-day/multi-machine block's name back
// in EVERY cell instead of just its one center cell, most visibly after deleting then undoing
// a grouped booking (the exact user report this pins). Fixed by recomputing every patched
// cell's real segment (ui/grid.ts's computeVisibleBookingBlocks) from the fully-applied
// current data, the same recipe Grid.tsx's own full render uses.
describe('patchCells — merge-aware rendering (regression)', () => {
  const TUE = '2021-01-05';

  function buildTwoDayDom(): void {
    document.body.innerHTML = `
      <table><tbody><tr>
        <td class="machcol"><span class="dot free"></span></td>
        <td class="cell free" data-machine-id="m1" data-date="${TODAY}"></td>
        <td class="cell free" data-machine-id="m1" data-date="${TUE}"></td>
      </tr></tbody></table>`;
  }

  function tueCell(): HTMLElement {
    return document.querySelector(`td.cell[data-machine-id="m1"][data-date="${TUE}"]`)!;
  }

  beforeEach(() => {
    buildTwoDayDom();
    // The extra store fields computeVisibleBookingBlocks' own recipe (buildGridRows +
    // visibleWeeks) needs, beyond what the outer beforeEach already sets.
    window.S.visM = ['m1'];
    window.S.weeks = 1;
    window.S.extraWeeks = 0;
    window.S.startMonday = new Date(`${TODAY}T00:00:00Z`);
    window.S.groupsSel = new Set();
    window.S.machSel = new Set();
    window.S.cats = new Set(['maschine', 'messtechnik']);
    window.S.collapsed = new Set();
    window.S.favs = new Set();
  });

  // What: a 2-day run patched together (both days in the same `patchCells` call — exactly the
  // shape a multi-day delete's undo produces) shows the booker's name exactly once, at the
  // block's own center cell (a 2-day run's center is its first day) — never in both cells.
  // How: books both days under the same name, patches both together, and checks each cell's
  // own text content individually.
  it("shows the name only once, at the block's actual center — not in every patched cell", () => {
    window.S.data!.bookings = {
      m1: { [TODAY]: { name: 'anna' }, [TUE]: { name: 'anna' } },
    };
    patchCells([
      { machineId: 'm1', date: TODAY },
      { machineId: 'm1', date: TUE },
    ]);
    expect(cell().textContent).toBe('anna'); // the run's first day is its center
    expect(tueCell().textContent).toBe(''); // the run's second day stays blank
  });

  // What: the two days of the same run merge visually — the first day's right edge and the
  // second day's left edge both drop their border/gridline (the `merge-right`/`merge-left`
  // classes), matching what a full render would produce for the exact same data.
  // How: books both days under the same name, patches both together, and checks each cell's
  // own merge-* class.
  it('applies merge-left/merge-right classes across the patched run, not just per-cell state', () => {
    window.S.data!.bookings = {
      m1: { [TODAY]: { name: 'anna' }, [TUE]: { name: 'anna' } },
    };
    patchCells([
      { machineId: 'm1', date: TODAY },
      { machineId: 'm1', date: TUE },
    ]);
    expect(cell().className).toContain('merge-right');
    expect(tueCell().className).toContain('merge-left');
  });
});
