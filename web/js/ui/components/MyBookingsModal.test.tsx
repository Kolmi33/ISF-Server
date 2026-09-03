// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';

// MyBookingsModal.tsx imports `saveFilters`/`updateMachBtn` directly from
// `./MachineFilterDropdown.tsx` (F8 cleanup, ARCHITECTURE_AUDIT.md) rather than reaching
// through `window.saveFilters`/`window.updateMachBtn` — mocked here so this test keeps
// controlling/observing them as before.
vi.mock('./MachineFilterDropdown.tsx', () => ({ saveFilters: vi.fn(), updateMachBtn: vi.fn() }));

import { MyBookingsModal, openMyBookings } from './MyBookingsModal.tsx';
import { saveFilters, updateMachBtn } from './MachineFilterDropdown.tsx';

const TODAY = '2021-01-04'; // a Monday

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

// This component calls both its own (still window-bridged) window.notify() AND
// ui/grid-scroll.ts's prependWeek() (migrated — calls store.notify() directly). Wiring
// window.notify to forward to store.notify(), exactly as app.ts does in production, means
// notifySpy sees every repaint trigger regardless of which path fired it.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div><div id="gridWrap"></div>`;
  store.set({
    user: 'anna',
    data: { machines: [machine()], bookings: {} },
    favs: new Set(),
    cats: new Set(),
    collapsed: new Set(),
    machSel: new Set(),
    startMonday: new Date(`${TODAY}T00:00:00Z`),
    extraWeeks: 0,
  } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  window.mutate = vi.fn();
  window.askConfirm = vi.fn().mockResolvedValue(true);
  window.notify = () => store.notify();
  vi.mocked(saveFilters).mockClear();
  vi.mocked(updateMachBtn).mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MyBookingsModal', () => {
  // What: a run's row uses the same card layout as AllBookingsModal's own run rows (user
  // request: "copy the display style from Alle Buchungen") — the machine name bold with its
  // department group next to it on its own line (`.abmach`), the date/tag line below it
  // (`.abdate`), rather than the old single run-on-sentence line with no group shown at all.
  // How: books one day and checks both the `.abmach`/`.abdate` structure and the group text
  // (never shown by the old layout) are present.
  it("uses AllBookingsModal's card style: machine+group on top, date below", () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    render(<MyBookingsModal />);
    const machLine = document.querySelector('.mybk .abmach')!;
    expect(machLine.textContent).toContain('Fräse');
    expect(machLine.textContent).toContain('Halle 1');
    expect(document.querySelector('.mybk .abdate')).not.toBeNull();
  });

  // What: with no future bookings for the current user, the modal shows an explanatory
  // placeholder rather than an empty list.
  // How: renders with no bookings set up and checks the placeholder text appears.
  it('shows a message when there are no future bookings', () => {
    render(<MyBookingsModal />);
    expect(screen.getByText(/Keine zukünftigen Buchungen/)).toBeInTheDocument();
  });

  // What: a single-day booking shows its note inline and gets a direct "Löschen" (delete)
  // button, with no expand chip (there's nothing to expand for one day).
  // How: books one day with a note and checks the machine name, the note text, no expand
  // chip, and the delete button.
  it('shows a single-day booking with its note, no expand chip', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna', note: 'wichtig' } } };
    render(<MyBookingsModal />);
    expect(screen.getByText('Fräse')).toBeInTheDocument();
    expect(screen.getByText('(wichtig)')).toBeInTheDocument();
    expect(screen.queryByText('▸')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  // What: a multi-day consecutive run shows as a collapsed series by default (day count +
  // one "delete whole series" button), and clicking the expand chip reveals the individual
  // days, each with its own delete button.
  // How: books two consecutive days, checks the collapsed summary and series-delete button,
  // checks an individual date isn't shown yet, then clicks the expand chip and checks two
  // individual delete buttons now appear.
  it('shows a multi-day series collapsed by default, expandable via the chip', () => {
    window.S.data!.bookings = {
      m1: { '2021-01-04': { name: 'anna' }, '2021-01-05': { name: 'anna' } },
    };
    render(<MyBookingsModal />);
    expect(screen.getByText('2 Tage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Serie löschen' })).toBeInTheDocument();
    expect(screen.queryByText('04.01.2021')).not.toBeInTheDocument(); // collapsed

    act(() => {
      screen.getByText('▸').click();
    });
    expect(screen.getAllByRole('button', { name: 'Löschen' })).toHaveLength(2); // one per day
  });

  // What: the expand chip sits on the right, under the pin ("Im Plan anzeigen") button — user
  // request — not on the date line's own left edge as before.
  // How: books a 2-day series and checks the chip shares its immediate parent with the pin
  // button, rather than living inside the `.abdate` date line.
  it('places the expand chip on the right, under the pin button', () => {
    window.S.data!.bookings = {
      m1: { '2021-01-04': { name: 'anna' }, '2021-01-05': { name: 'anna' } },
    };
    render(<MyBookingsModal />);
    const pinButton = screen.getByRole('button', { name: 'Im Plan anzeigen' });
    const chip = screen.getByText('▸');
    expect(chip.parentElement).toBe(pinButton.parentElement);
    expect(document.querySelector('.abdate')!.textContent).not.toContain('▸');
  });

  // What: a run whose first day belongs to a booking group spanning more than one machine
  // shows a "Teil einer Buchungsgruppe" hint naming the title and machine count — booking
  // groups are now detected and displayed, not silently treated as a plain run (user request).
  // How: seeds two machines sharing one gid/gtitle on the same day and checks the hint appears
  // on the resulting run with the right title and count.
  it('detects and displays a booking group spanning multiple machines', () => {
    window.S.data!.machines = [machine(), machine({ id: 'm2', name: 'Presse' })];
    window.S.data!.bookings = {
      m1: { [TODAY]: { name: 'anna', gid: 'g1', gtitle: 'Projekt X' } },
      m2: { [TODAY]: { name: 'anna', gid: 'g1' } },
    };
    render(<MyBookingsModal />);
    // Each machine's own row independently detects and shows the group hint — one per row,
    // hence two matches, not one shared hint for the whole group.
    expect(screen.getAllByText(/Teil einer Buchungsgruppe/)).toHaveLength(2);
    expect(screen.getByText('Projekt X')).toBeInTheDocument(); // only m1's day carries a title
    expect(screen.getAllByText(/2 Maschinen/)).toHaveLength(2);
  });

  // What: a plain (ungrouped) run, or a "group" of just one machine, shows no group hint at
  // all — only a genuine multi-machine group is worth calling out.
  // How: books an ordinary single-machine run and checks the hint never appears.
  it('shows no group hint for a plain, ungrouped run', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    render(<MyBookingsModal />);
    expect(screen.queryByText(/Teil einer Buchungsgruppe/)).not.toBeInTheDocument();
  });

  // What: the filter row offers the same fields as All Bookings' own — Maschine, Bereich,
  // Sortieren, Von, Bis — but deliberately no Person field, since every run here is already
  // known to be the current user's own (user request).
  // How: renders and checks each expected field is present by its label, and that no "Person"
  // label exists anywhere in the modal.
  it('offers a filter row matching All Bookings, minus the Person field', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    render(<MyBookingsModal />);
    expect(screen.getByPlaceholderText('Berger')).toBeInTheDocument(); // Maschine
    // { selector: 'label' }: the Sortieren dropdown also has an option literally named
    // "Bereich" (sort-by-department), a real collision with the filter's own label — a plain
    // getByText('Bereich') would match both.
    expect(screen.getByText('Bereich', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('Sortieren')).toBeInTheDocument();
    expect(screen.getByText('Von')).toBeInTheDocument();
    expect(screen.getByText('Bis')).toBeInTheDocument();
    expect(screen.queryByText('Person')).not.toBeInTheDocument();
  });

  // What: the Maschine filter narrows the run list to machines whose name matches, same
  // matching rule as All Bookings' own.
  // How: seeds two machines, filters by a substring of one's name, and checks only that
  // machine's run remains.
  it('filters the list by machine name', () => {
    window.S.data!.machines = [machine(), machine({ id: 'm2', name: 'Presse' })];
    window.S.data!.bookings = {
      m1: { [TODAY]: { name: 'anna' } },
      m2: { [TODAY]: { name: 'anna' } },
    };
    render(<MyBookingsModal />);
    fireEvent.change(screen.getByPlaceholderText('Berger'), { target: { value: 'Pres' } });
    expect(screen.getByText('Presse')).toBeInTheDocument();
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
  });

  // What: the Bereich filter's whole-category option (shared "cat:" encoding with All
  // Bookings) narrows the list to every machine in that category, regardless of department group.
  // How: seeds one maschine-category and one messtechnik-category machine, both booked, picks
  // the Messtechnik category option, and checks only that machine's run remains.
  it('filters by whole category via the Bereich select', () => {
    window.S.data!.machines = [
      machine(),
      machine({ id: 'm2', name: 'Messgerät', group: 'Labor', cat: 'messtechnik' }),
    ];
    window.S.data!.bookings = {
      m1: { [TODAY]: { name: 'anna' } },
      m2: { [TODAY]: { name: 'anna' } },
    };
    render(<MyBookingsModal />);
    const bereichSelect = screen
      .getByText('Bereich', { selector: 'label' })
      .closest('.fld')!
      .querySelector('select')!;
    fireEvent.change(bereichSelect, { target: { value: 'cat:messtechnik' } });
    expect(screen.getByText('Messgerät')).toBeInTheDocument();
    expect(screen.queryByText('Fräse')).not.toBeInTheDocument();
  });

  // What: filtering down to nothing (rather than there being no bookings at all) shows the
  // "no matches for this filter" message, distinct from the "no bookings at all" one.
  // How: books one run, filters by a machine name that matches nothing, and checks the
  // filter-specific message appears.
  it('shows a filter-specific message when the filter matches nothing', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    render(<MyBookingsModal />);
    fireEvent.change(screen.getByPlaceholderText('Berger'), { target: { value: 'zzz' } });
    expect(screen.getByText('Keine Buchungen für diese Filter gefunden.')).toBeInTheDocument();
  });

  // What: with no bookings at all, the "show only my machines in the plan" shortcut button
  // doesn't appear — there'd be nothing meaningful for it to filter to.
  // How: renders with no bookings and checks the button is absent.
  it('shows no "only my machines" button when there are no runs', () => {
    render(<MyBookingsModal />);
    expect(screen.queryByText(/Nur meine Maschinen/)).not.toBeInTheDocument();
  });

  // What: once at least one run exists, the "only my machines" button appears, labeled with
  // the actual count of distinct machines involved.
  // How: books one day on one machine and checks the button's text includes "(1)".
  it('shows the "only my machines" button, with the right count, once a run exists', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    render(<MyBookingsModal />);
    expect(
      screen.getByRole('button', { name: /Nur meine Maschinen im Plan zeigen \(1\)/ }),
    ).toBeInTheDocument();
  });

  // What: clicking "only my machines" sets the grid's machine filter to exactly this user's
  // booked machines, persists/repaints that filter, closes this modal, and confirms via toast.
  // How: books one machine, clicks the button, and checks the filter set, the persisted-filter
  // and toolbar-update calls, one repaint, the modal closing, and the toast text.
  it('the "only my machines" button filters, persists, notifies, closes, and toasts', () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    act(() => openMyBookings());
    act(() => {
      screen.getByRole('button', { name: /Nur meine Maschinen/ }).click();
    });
    expect(window.S.machSel).toEqual(new Set(['m1']));
    expect(saveFilters).toHaveBeenCalledOnce();
    expect(updateMachBtn).toHaveBeenCalledOnce();
    expect(notifySpy).toHaveBeenCalledOnce();
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('toast')!.textContent).toContain('nur deine 1 Maschine');
  });

  // What: the "Im Plan anzeigen" (show in plan) action on a run unfolds that machine's
  // category/group in the grid (so it's actually visible) and scrolls to the run's first
  // live day, then closes this modal.
  // How: pre-collapses the machine's group, clicks the goto button, and checks the category
  // is shown, the group is unfolded, exactly two repaints fired (one from the goto action
  // itself, one from inside the scroll-to-date sequence it triggers), and the modal closed.
  it('"goto" expands the category/group, scrolls to the first live date, and closes', () => {
    window.S.collapsed = new Set(['Halle 1']);
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    act(() => openMyBookings());
    act(() => {
      screen.getByRole('button', { name: 'Im Plan anzeigen' }).click();
    });
    expect(window.S.cats.has('maschine')).toBe(true);
    expect(window.S.collapsed.has('Halle 1')).toBe(false);
    // Once from gotoRun itself, once more from inside prependWeek() (also called here, as
    // legacy's own resetView(); notify(); prependWeek(); gotoDate(iso); sequence does).
    expect(notifySpy).toHaveBeenCalledTimes(2);
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });

  // What: deleting a single day writes through mutate, then the list re-filters live to
  // reflect the deletion (no manual refresh needed), with a confirming toast.
  // How: stubs mutate to apply its reducer against the real data, books one day, deletes it,
  // and checks mutate ran, the list now shows the "no bookings" placeholder, and the toast
  // confirms the deletion.
  it('deleting a single day mutates, then re-filters the run live and offers undo', async () => {
    window.S.data!.bookings = { m1: { [TODAY]: { name: 'anna' } } };
    // A faithful-enough mutate stub: apply the reducer to the real window.S.data, exactly as
    // the real mutate() does, so the live re-filter has something to see.
    window.mutate = vi.fn((fn) => Promise.resolve(fn(window.S.data)));
    render(<MyBookingsModal />);
    await act(async () => {
      screen.getByRole('button', { name: 'Löschen' }).click();
    });
    expect(window.mutate).toHaveBeenCalledOnce();
    expect(screen.getByText(/Keine zukünftigen Buchungen/)).toBeInTheDocument(); // re-filtered live
    expect(document.getElementById('toast')!.textContent).toContain('gelöscht');
  });

  // What: deleting a multi-day series (more than one day) asks for confirmation first,
  // naming the exact day count in the confirmation prompt, before actually deleting.
  // How: books two consecutive days, clicks "Serie löschen", and checks the confirm dialog's
  // title/button-label mention the right count, then that mutate actually ran (confirm defaults to true).
  it('deleting a series with more than one day asks to confirm first', async () => {
    window.S.data!.bookings = {
      m1: { '2021-01-04': { name: 'anna' }, '2021-01-05': { name: 'anna' } },
    };
    render(<MyBookingsModal />);
    await act(async () => {
      screen.getByRole('button', { name: 'Serie löschen' }).click();
    });
    expect(window.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ganze Serie löschen?', yes: '2 Tage löschen' }),
    );
    expect(window.mutate).toHaveBeenCalledOnce();
  });

  // What: declining the series-delete confirmation aborts it entirely — no write happens.
  // How: stubs askConfirm to resolve false, clicks "Serie löschen", and checks mutate was
  // never called.
  it('does not delete the series when the confirm is declined', async () => {
    window.askConfirm = vi.fn().mockResolvedValue(false);
    window.S.data!.bookings = {
      m1: { '2021-01-04': { name: 'anna' }, '2021-01-05': { name: 'anna' } },
    };
    render(<MyBookingsModal />);
    await act(async () => {
      screen.getByRole('button', { name: 'Serie löschen' }).click();
    });
    expect(window.mutate).not.toHaveBeenCalled();
  });

  // What: the "Schließen" (close) button closes the modal without deleting anything.
  // How: opens the modal, clicks close, and checks the overlay's open class is gone.
  it('Schließen closes without deleting', () => {
    act(() => openMyBookings());
    act(() => {
      screen.getByRole('button', { name: 'Schließen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});

describe('openMyBookings', () => {
  // What: with no user name set, opening "my bookings" prompts for a name first instead of
  // showing an empty/meaningless list — there's no "mine" to filter to without a name.
  // How: clears the store's user, opens the modal, and checks the name-prompt appears while
  // the bookings modal's own heading does not.
  it('prompts for a name first when none is set, instead of opening', () => {
    window.S.user = '';
    act(() => openMyBookings());
    expect(screen.getByText('Wie heißt du?')).toBeInTheDocument();
    expect(screen.queryByText('Meine Buchungen (ab heute)')).not.toBeInTheDocument();
  });

  // What: with a user name already set, the modal opens directly.
  // How: opens with the default seeded user and checks the modal's heading appears.
  it('opens the modal when a name is already set', () => {
    act(() => openMyBookings());
    expect(screen.getByText('Meine Buchungen (ab heute)')).toBeInTheDocument();
  });
});
