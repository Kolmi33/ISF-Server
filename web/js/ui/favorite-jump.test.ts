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
  // What: toggling is a genuine toggle — the same call adds the machine on the first press
  // and removes it on the second, persisting and notifying (repainting) both times.
  // How: calls toggleFav twice on the same id and checks the favorites set, the persisted
  // JSON, and the notify call count after each call.
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
  // What: searching forward from a given day skips over a booked one to the next actually-free day.
  // How: books the day right after the anchor and checks the search skips it, landing on the
  // day after that.
  it('finds the next free weekday, skipping a booked one', () => {
    const m = machine();
    window.S.data!.bookings = { m1: { '2021-01-05': { name: 'anna' } } }; // Tue booked
    expect(nextFreeAfter(m, '2021-01-04')).toBe('2021-01-06'); // Wed
  });

  // What: searching backward finds the free day right before the anchor, respecting the
  // "never before today" floor these machine-scoped wrappers share with the pure navigation helpers.
  // How: searches backward from a known day with nothing booked and checks it lands on the
  // immediately preceding day.
  it('finds the previous free weekday, not going before today', () => {
    const m = machine();
    expect(prevFreeBefore(m, '2021-01-06')).toBe('2021-01-05');
  });

  // What: a day blocked by maintenance counts as not-free, same as an already-booked day —
  // the search skips over it too.
  // How: gives the machine a maintenance slot covering the day right after the anchor and
  // checks the search skips past it.
  it('treats a blocked or unavailable day as not free', () => {
    const m = machine({ maint: [{ type: 'wartung', from: '2021-01-05', until: '2021-01-05' }] });
    expect(nextFreeAfter(m, '2021-01-04')).toBe('2021-01-06');
  });
});

describe('gotoNextFree', () => {
  // What: jumping to an unknown machine id is a safe no-op — no repaint, no crash.
  // How: calls gotoNextFree with an id not present in the loaded machines and checks notify
  // was never called.
  it('no-ops for an unknown machine id', () => {
    gotoNextFree('missing');
    expect(notifySpy).not.toHaveBeenCalled();
  });

  // What: jumping to the next free day scrolls the grid's date window to center 2 weeks
  // before that day, records the found day as this machine's pointer, selects that cell, and
  // shows a confirming toast naming the machine.
  // How: calls gotoNextFree on a machine with nothing booked (today itself is free), then
  // checks the pointer, the extraWeeks window size, that notify fired, the selection
  // anchor/focus both landed on that cell, and the toast text names the machine.
  it('jumps to the next free day, rebuilds the window centered 2 weeks before it, and selects the cell', () => {
    gotoNextFree('m1');
    expect(nextFreePtr.m1).toBe('2021-01-04'); // today itself is free (no bookings)
    expect(window.S.extraWeeks).toBe(4);
    expect(notifySpy).toHaveBeenCalled();
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(document.getElementById('toast')!.textContent).toMatch(/Fräse: freier Termin/);
  });

  // What: when a machine has no future bookings or blocks at all past the found day, the
  // toast additionally flags it as "permanently free from here" — a stronger claim than just
  // "this one day is free".
  // How: jumps on a machine with nothing booked anywhere and checks the toast text includes
  // the "dauerhaft frei" (permanently free) phrase.
  it('flags a permanently-free slot once nothing is booked or blocked past it', () => {
    gotoNextFree('m1');
    expect(document.getElementById('toast')!.textContent).toMatch(/ab hier dauerhaft frei/);
  });

  // What: if a later booking exists anywhere in the future, the "permanently free" claim is
  // NOT made, even though the immediately-found day itself is free.
  // How: books some later date, jumps to the next free day, and checks the toast text does
  // NOT include the "dauerhaft frei" phrase.
  it('does not flag "dauerhaft frei" when a later booking exists', () => {
    window.S.data!.bookings = { m1: { '2021-01-06': { name: 'anna' } } };
    gotoNextFree('m1');
    expect(document.getElementById('toast')!.textContent).not.toMatch(/dauerhaft frei/);
  });

  // What: if the search exhausts its 2-year horizon without finding a free day, it gives up
  // and toasts a clear "nothing found" message instead of hanging or silently doing nothing —
  // and leaves no stale pointer behind for that machine.
  // How: blocks the machine with an open-ended maintenance slot covering the entire future,
  // jumps, and checks the exact toast text and that no pointer was recorded.
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

  // What: jumping on a machine clears every OTHER machine's pointer — only the
  // most-recently-jumped machine keeps its pointer at any given time.
  // How: jumps on m1 (setting its pointer), then jumps on m2, and checks m1's pointer was
  // cleared while m2's is now set.
  it("switching machines resets every other machine's pointer", () => {
    window.S.data!.machines = [machine({ id: 'm1' }), machine({ id: 'm2', name: 'Presse' })];
    gotoNextFree('m1');
    gotoNextFree('m2');
    expect(nextFreePtr.m1).toBeUndefined();
    expect(nextFreePtr.m2).toBeDefined();
  });
});

describe('gotoPrevFree', () => {
  // What: stepping backward is a no-op both for an unknown machine id and for a machine that
  // has no forward pointer yet (nothing to step back FROM).
  // How: calls gotoPrevFree with an unknown id, then with a real id that was never jumped
  // forward on, and checks neither call triggered a notify.
  it('no-ops for an unknown machine id, or when there is no forward pointer yet', () => {
    gotoPrevFree('missing');
    gotoPrevFree('m1');
    expect(notifySpy).not.toHaveBeenCalled();
  });

  // What: stepping backward from a pointer moves it to the previous free day before that point.
  // How: sets up a booked Tuesday, jumps forward once (establishing a pointer), manually
  // advances the pointer past the booked day, steps backward, and checks the pointer lands
  // back on the earlier free day with a confirming toast.
  it('steps back to the previous free day', () => {
    window.S.data!.bookings = { m1: { '2021-01-05': { name: 'anna' } } };
    gotoNextFree('m1'); // lands on today (2021-01-04), the first free day
    nextFreePtr.m1 = '2021-01-06'; // pretend we'd stepped forward past the booked Tuesday
    gotoPrevFree('m1');
    expect(nextFreePtr.m1).toBe('2021-01-04');
    expect(document.getElementById('toast')!.textContent).toMatch(/Fräse: zurück zu/);
  });

  // What: when there's no earlier free day to step back to, the pointer falls back to today
  // itself (rather than going nowhere), and pressing again once already at today shows a
  // distinct "already at today" message instead of repeating the "back to" toast.
  // How: books today itself, sets the pointer to tomorrow, steps back once (lands on today via
  // the fallback, with a normal "back to" toast), then steps back again and checks the toast
  // switched to the "already today" message.
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
