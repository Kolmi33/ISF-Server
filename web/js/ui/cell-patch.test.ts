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
  it('is a no-op when the cell is not currently rendered', () => {
    expect(() => refreshCell('m1', '2099-01-01')).not.toThrow();
  });

  it('is a no-op when the machine no longer exists', () => {
    window.S.data!.machines = [];
    refreshCell('m1', TODAY);
    expect(cell().className).toBe('cell free'); // unchanged
  });

  it('renders a blocked cell with the maintenance text as its title', () => {
    window.S.data!.machines = [
      machine({ maint: [{ type: 'defekt', from: TODAY, until: TODAY, note: 'kaputt' }] }),
    ];
    refreshCell('m1', TODAY);
    expect(cell().className).toContain('blocked');
    expect(cell().title).toContain('kaputt');
  });

  it('renders a booked cell, marking it "mine" case-insensitively', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'Anna', note: 'wichtig' } } };
    refreshCell('m1', TODAY);
    expect(cell().className).toContain('booked');
    expect(cell().className).toContain('mine');
    expect(cell().textContent).toBe('Anna');
    expect(cell().title).toContain('wichtig');
  });

  it('renders an unavailable cell for a machine closed on that weekday', () => {
    window.S.data!.machines = [machine({ days: '0111111' })]; // Monday off
    refreshCell('m1', TODAY);
    expect(cell().className).toContain('unavail');
  });

  it('renders free when nothing else applies', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    refreshCell('m1', TODAY);
    window.S.data!.bookings = {};
    refreshCell('m1', TODAY);
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

    it('keeps wknd on a free weekend cell', () => {
      refreshCell('m1', SATURDAY);
      expect(satCell().className).toContain('wknd');
    });

    it('keeps wknd on a booked weekend cell', () => {
      window.S.data!.bookings = { m1: { [SATURDAY]: { name: 'anna' } } };
      refreshCell('m1', SATURDAY);
      expect(satCell().className).toContain('wknd');
    });

    it('keeps wknd on a blocked weekend cell', () => {
      window.S.data!.machines = [
        machine({ maint: [{ type: 'defekt', from: SATURDAY, until: SATURDAY }] }),
      ];
      refreshCell('m1', SATURDAY);
      expect(satCell().className).toContain('wknd');
    });

    it('keeps wknd on an unavailable weekend cell', () => {
      window.S.data!.machines = [machine({ days: '1111101' })]; // Mo..So mask, Saturday off
      refreshCell('m1', SATURDAY);
      expect(satCell().className).toContain('wknd');
    });

    it('does not add wknd to a weekday cell', () => {
      refreshCell('m1', TODAY); // a Monday
      expect(cell().className).not.toContain('wknd');
    });
  });
});

describe('refreshDot', () => {
  function dot(): HTMLElement {
    return document.querySelector('.dot')!;
  }

  it('is a no-op when the row has no cell rendered at all', () => {
    document.body.innerHTML = '';
    expect(() => refreshDot('m1')).not.toThrow();
  });

  it('is a no-op when the row has no .dot element (a maintenance row uses .statdot instead)', () => {
    document.querySelector('.dot')!.remove();
    expect(() => refreshDot('m1')).not.toThrow();
  });

  it("shows busy with the booker's name when booked today", () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    refreshDot('m1');
    expect(dot().className).toBe('dot busy');
    expect(dot().title).toContain('anna');
  });

  it('shows unavailable when the machine is closed today', () => {
    window.S.data!.machines = [machine({ days: '0111111' })];
    refreshDot('m1');
    expect(dot().className).toBe('dot unavail');
  });

  it('shows free otherwise', () => {
    refreshDot('m1');
    expect(dot().className).toBe('dot free');
  });
});

describe('patchCells', () => {
  it("patches every named cell and refreshes each affected row's dot", () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    window.S.visM = ['m1'];
    patchCells([{ machineId: 'm1', date: TODAY }]);
    expect(cell().className).toContain('booked');
    expect(document.querySelector('.dot')!.className).toBe('dot busy');
  });

  it("repaints the selection afterward, since patching a cell's className wipes .sel/.kfocus", () => {
    cell().classList.add('sel');
    window.S.visM = ['m1'];
    patchCells([{ machineId: 'm1', date: TODAY }]);
    // Nothing is actually anchored/focused in this fixture, so the repaint correctly clears
    // the stray .sel left over from before the patch — proving paintSelection() really ran.
    expect(cell().classList.contains('sel')).toBe(false);
  });
});
