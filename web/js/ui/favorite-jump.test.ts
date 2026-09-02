// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppState, Machine } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import { selection } from './grid-interaction.ts';
import {
  toggleFav,
  nextFreePtr,
  nextFreeAfter,
  prevFreeBefore,
  gotoNextFree,
  gotoPrevFree,
} from './favorite-jump.ts';

const TODAY = '2021-01-04'; // a Monday

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

// favorite-jump.ts now reads/writes state via the real `store` singleton — spied once here
// (call history cleared per test below) rather than relying on a mocked window.notify.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  document.body.innerHTML = '<div id="gridWrap"></div><div id="toast"></div>';
  for (const key of Object.keys(nextFreePtr)) delete nextFreePtr[key];
  selection.anchor = null;
  selection.focus = null;
  store.set({
    favs: new Set<string>(),
    data: { machines: [machine()], bookings: {} },
    visM: [],
    visD: [],
    extraWeeks: 0,
    startMonday: new Date(`${TODAY}T00:00:00Z`),
  } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  // machById (./machine-lookup.ts) is a direct import now (F8 cleanup,
  // ARCHITECTURE_AUDIT.md) — needs no mock, the real one reads the store data set up above.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toggleFav', () => {
  it('adds, then removes, a machine from favorites — persisting and notifying each time', () => {
    toggleFav('m1');
    expect(window.S.favs.has('m1')).toBe(true);
    expect(JSON.parse(localStorage.getItem('mb_favs')!)).toEqual(['m1']);
    expect(notifySpy).toHaveBeenCalledTimes(1);

    toggleFav('m1');
    expect(window.S.favs.has('m1')).toBe(false);
    expect(JSON.parse(localStorage.getItem('mb_favs')!)).toEqual([]);
    expect(notifySpy).toHaveBeenCalledTimes(2);
  });
});

describe('nextFreeAfter / prevFreeBefore', () => {
  it('finds the next free weekday, skipping a booked one', () => {
    const m = machine();
    window.S.data!.bookings = { m1: { '2021-01-05': { name: 'anna' } } }; // Tue booked
    expect(nextFreeAfter(m, '2021-01-04')).toBe('2021-01-06'); // Wed
  });

  it('finds the previous free weekday, not going before today', () => {
    const m = machine();
    expect(prevFreeBefore(m, '2021-01-06')).toBe('2021-01-05');
  });

  it('treats a blocked or unavailable day as not free', () => {
    const m = machine({ maint: [{ type: 'wartung', from: '2021-01-05', until: '2021-01-05' }] });
    expect(nextFreeAfter(m, '2021-01-04')).toBe('2021-01-06');
  });
});

describe('gotoNextFree', () => {
  it('no-ops for an unknown machine id', () => {
    gotoNextFree('missing');
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('jumps to the next free day, rebuilds the window centered 2 weeks before it, and selects the cell', () => {
    gotoNextFree('m1');
    expect(nextFreePtr.m1).toBe('2021-01-04'); // today itself is free (no bookings)
    expect(window.S.extraWeeks).toBe(4);
    expect(notifySpy).toHaveBeenCalled();
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(document.getElementById('toast')!.textContent).toMatch(/Fräse: freier Termin/);
  });

  it('flags a permanently-free slot once nothing is booked or blocked past it', () => {
    gotoNextFree('m1');
    expect(document.getElementById('toast')!.textContent).toMatch(/ab hier dauerhaft frei/);
  });

  it('does not flag "dauerhaft frei" when a later booking exists', () => {
    window.S.data!.bookings = { m1: { '2021-01-06': { name: 'anna' } } };
    gotoNextFree('m1');
    expect(document.getElementById('toast')!.textContent).not.toMatch(/dauerhaft frei/);
  });

  it('toasts when nothing is free in the next 2 years', () => {
    // An open-ended (no `until`) maintenance slot starting before today blocks every future day.
    window.S.data!.machines = [
      machine({ id: 'm1', maint: [{ type: 'wartung', from: '2021-01-01' }] }),
    ];
    gotoNextFree('m1');
    expect(document.getElementById('toast')!.textContent).toBe(
      'Fräse: kein freier Termin in den nächsten 2 Jahren gefunden.',
    );
    expect(nextFreePtr.m1).toBeUndefined();
  });

  it("switching machines resets every other machine's pointer", () => {
    window.S.data!.machines = [machine({ id: 'm1' }), machine({ id: 'm2', name: 'Presse' })];
    gotoNextFree('m1');
    gotoNextFree('m2');
    expect(nextFreePtr.m1).toBeUndefined();
    expect(nextFreePtr.m2).toBeDefined();
  });
});

describe('gotoPrevFree', () => {
  it('no-ops for an unknown machine id, or when there is no forward pointer yet', () => {
    gotoPrevFree('missing');
    gotoPrevFree('m1');
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('steps back to the previous free day', () => {
    window.S.data!.bookings = { m1: { '2021-01-05': { name: 'anna' } } };
    gotoNextFree('m1'); // lands on today (2021-01-04), the first free day
    nextFreePtr.m1 = '2021-01-06'; // pretend we'd stepped forward past the booked Tuesday
    gotoPrevFree('m1');
    expect(nextFreePtr.m1).toBe('2021-01-04');
    expect(document.getElementById('toast')!.textContent).toMatch(/Fräse: zurück zu/);
  });

  it('lands on today when there is no earlier free day, then toasts "already today" on a repeat press', () => {
    // Today itself is booked, so stepping back from tomorrow finds nothing earlier — the
    // "land on today anyway" fallback fires on the first press.
    window.S.data!.bookings = { m1: { '2021-01-04': { name: 'anna' } } };
    nextFreePtr.m1 = '2021-01-05';
    gotoPrevFree('m1');
    expect(nextFreePtr.m1).toBe('2021-01-04');
    expect(document.getElementById('toast')!.textContent).toMatch(/Fräse: zurück zu/);

    gotoPrevFree('m1'); // pointer is now already "today" — the no-earlier-day branch again
    expect(document.getElementById('toast')!.textContent).toBe('Fräse: bereits am heutigen Tag.');
  });
});
