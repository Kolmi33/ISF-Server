// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent, within } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';
import { initGridInteraction } from '../grid-interaction.ts';
import { openAssistant } from './AssistantModal.tsx';

// AssistantResults.tsx's "pin" button ("Termin anzeigen") calls grid-interaction.ts's
// `clearSelection()`, which hands `hideCtx` off to the injected `GridInteractionHandlers`
// struct (F8 cleanup, ARCHITECTURE_AUDIT.md) rather than `window.hideCtx` — initialized once
// here, matching `initGridInteraction`'s real one-time-at-boot contract. The `#grid` element
// only this one call needs is thrown away immediately after; nothing else in this file drives
// grid DOM interactions.
document.body.innerHTML = '<table id="grid"></table>';
initGridInteraction({
  showCtx: vi.fn(),
  hideCtx: vi.fn(),
  toggleFav: vi.fn(),
  gotoPrevFree: vi.fn(),
  gotoNextFree: vi.fn(),
  openCellAction: vi.fn(),
  prependWeek: vi.fn(),
});

const TODAY = '2021-01-04'; // a Monday

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'M1', group: 'Halle 1', ...overrides };
}

// jsdom has no native DataTransfer — a plain object with the members our DnD code touches is
// enough for `fireEvent.dragStart/dragOver/drop`'s `dataTransfer` event-init property.
function dataTransferStub() {
  return { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
}

// window.S is kept aliased to store.state so the component (migrated onto the real store) and
// this test agree; window.notify forwards to store.notify() exactly as app.ts does in
// production, so notifySpy sees every repaint trigger.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  document.body.innerHTML =
    '<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div><div id="gridWrap"></div>';
  store.set({
    user: 'anna',
    data: {
      machines: [
        machine({ id: 'm1', name: 'Fräse', group: 'Halle 1' }),
        machine({ id: 'm2', name: 'Presse', group: 'Halle 1' }),
        machine({
          id: 'm3',
          name: 'Kaputte Presse',
          group: 'Halle 1',
          info: 'Ansprechpartner: X',
          maint: [{ type: 'wartung', from: '2000-01-01' }],
        }),
      ],
      bookings: {},
    },
    favs: new Set(),
    cats: new Set(['maschine', 'messtechnik']),
    collapsed: new Set(),
    machSel: new Set(),
    startMonday: new Date(`${TODAY}T00:00:00Z`),
    extraWeeks: 0,
  } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  // machById (../machine-lookup.ts), saveFilters/updateMachBtn (./MachineFilterDropdown.tsx)
  // are direct imports now (F8 cleanup, ARCHITECTURE_AUDIT.md) — the real implementations run
  // fine here unmocked: machById reads the store data set up above, and saveFilters/
  // updateMachBtn's DOM/localStorage side effects are harmless with no #machBtn present.
  window.mutate = vi.fn();
  window.askConfirm = vi.fn().mockResolvedValue(true);
  window.notify = () => store.notify();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function openChecklistCategory(): void {
  act(() => {
    screen.getByText('Maschinen').click(); // opens the 'maschine' category header
  });
  act(() => {
    screen.getByText('Halle 1').click(); // opens its one group header, now rendered
  });
}

describe('AssistantModal — card layout', () => {
  // What: the redesigned Assistant lays out its content as three distinct cards — device
  // selection, booking parameters, and the selected-devices "cart" — each with its own
  // heading, rather than one undifferentiated block of controls (user request: a modern,
  // card-based dashboard layout).
  // How: opens the Assistant and checks all three card titles are present, plus that there
  // are exactly three ".assist-card" elements (the fourth section, the action buttons, is
  // deliberately not a card).
  it('lays out device selection, parameters, and selected devices as three separate cards', () => {
    act(() => openAssistant());
    expect(screen.getByText('Geräteauswahl')).toBeInTheDocument();
    expect(screen.getByText('Buchungsparameter')).toBeInTheDocument();
    expect(screen.getByText('Ausgewählte Geräte')).toBeInTheDocument();
    expect(document.querySelectorAll('.assist-card')).toHaveLength(3);
  });

  // What: the "Geräteauswahl" card is its own flex column (`.assist-catalog`) so its
  // checklist can grow to fill the card's real height once the card itself stretches to match
  // the right column (user report: the card grew but its own dropdown/checklist stayed a
  // fixed height, leaving dead space at the bottom).
  // How: opens the Assistant and checks the "Geräteauswahl" card carries the class.
  it('gives the "Geräteauswahl" card its own stretch-friendly class', () => {
    act(() => openAssistant());
    const card = screen.getByText('Geräteauswahl').closest('.assist-card')!;
    expect(card.classList.contains('assist-catalog')).toBe(true);
  });

  // What: the primary action ("Freie Termine suchen") is anchored at the bottom of the right
  // column, below both the parameters and selected-devices cards — the clear final step of
  // the flow, not a separate/disconnected form (user request).
  // How: opens the Assistant and checks the search button's container (".assist-actions")
  // comes after both right-column cards in DOM order, within the same right-column parent.
  it('anchors the primary action below both right-column cards', () => {
    act(() => openAssistant());
    const rightColumn = screen.getByText('Buchungsparameter').closest('.assist-col-right')!;
    const children = [...rightColumn.children];
    const actionsIndex = children.findIndex((el) => el.classList.contains('assist-actions'));
    const cardIndices = children
      .map((el, i) => (el.classList.contains('assist-card') ? i : -1))
      .filter((i) => i >= 0);
    expect(cardIndices).toHaveLength(2);
    expect(actionsIndex).toBeGreaterThan(Math.max(...cardIndices));
    expect(
      within(rightColumn.children[actionsIndex] as HTMLElement).getByRole('button', {
        name: 'Freie Termine suchen',
      }),
    ).toBeInTheDocument();
  });
});

describe('AssistantModal — checklist → work area', () => {
  // What: with no devices checked yet, the work area shows a bare empty-state status line
  // (not instructional prose — drag-and-drop is communicated visually now) rather than a
  // blank, ambiguous-looking area.
  // How: opens the assistant with nothing checked and checks the status text appears.
  it('shows the empty-work status until a device is checked', () => {
    act(() => openAssistant());
    expect(screen.getByText(/Keine Geräte ausgewählt/)).toBeInTheDocument();
  });

  // What: the empty state is centered with a faint icon (`.aswork-empty`), not a bare left-
  // aligned line of text, so it reads as an intentional state (user request).
  // How: opens the assistant with nothing checked and checks the wrapper + icon are present.
  it('renders the empty-work status centered with an icon, not bare text', () => {
    act(() => openAssistant());
    const wrapper = document.querySelector('.aswork-empty')!;
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.querySelector('svg.ic')).toBeInTheDocument();
    expect(wrapper.textContent).toContain('Keine Geräte ausgewählt');
  });

  // What: checking a device's checklist checkbox adds it to the work area (and clears the
  // empty hint); unchecking it removes it again (and the hint reappears).
  // How: opens the checklist, checks a device, checks the hint is gone and the device node
  // appears in the work area, then unchecks it and checks the hint is back.
  it('checking a device adds it to the work area; unchecking removes it', () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    expect(screen.queryByText(/Keine Geräte ausgewählt/)).not.toBeInTheDocument();
    expect(document.querySelector('.asdev[title^="Fräse"]')).toBeInTheDocument();

    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    expect(screen.getByText(/Keine Geräte ausgewählt/)).toBeInTheDocument();
  });

  // What: a selection chip carries a category-color custom property (blue Maschinen, green
  // Messtechnik — user request), not a plain inline background, so the existing hover/
  // dragover CSS rules (app.css) can still override it.
  // How: checks a device chip and reads its own `--devcolor` custom property.
  it('sets a category-color custom property on each selection chip', () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    const chip = document.querySelector<HTMLElement>('.asdev[title^="Fräse"]')!;
    expect(chip.style.getPropertyValue('--devcolor')).not.toBe('');
  });
});

describe('AssistantModal — checklist details', () => {
  // What: a machine with an info note shows an info icon, and one with active maintenance
  // shows a "Wartung" badge — both are per-machine decorations shown right in the checklist.
  // How: opens the checklist (the fixture's "Kaputte Presse" has both an info note and an
  // active maintenance slot) and checks the icon and badge both appear.
  it('shows the info icon and the maintenance badge for a machine that has them', () => {
    act(() => openAssistant());
    openChecklistCategory();
    expect(document.querySelector('.machinfo')).toBeInTheDocument();
    expect(screen.getByText('Wartung')).toBeInTheDocument();
  });

  // What: each category header shows a category icon next to its title (user request), to
  // make it faster to spot "Maschinen" vs. "Messtechnik" while scanning.
  // How: opens the checklist and checks the "Maschinen" header's own row contains an icon.
  it('shows a category icon next to each accordion header title', () => {
    act(() => openAssistant());
    const maschinenHeader = screen.getByText('Maschinen').closest('.cathead')!;
    expect(maschinenHeader.querySelector('svg.ic')).toBeInTheDocument();
  });

  // What: clicking the info icon shows the info (a tooltip/toast, not asserted here) without
  // also toggling that row's checkbox — the two are independent click targets.
  // How: clicks the info icon and checks the corresponding checkbox is still unchecked.
  it('clicking the info icon does not toggle the checkbox', () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      fireEvent.click(document.querySelector('.machinfo')!);
    });
    expect(screen.getByRole('checkbox', { name: /Kaputte Presse/ })).not.toBeChecked();
  });

  // What: the search box switches the checklist to a flat list of matches, the same
  // search-bypasses-fold-state behavior the machine filter dropdown and checklist share.
  // How: searches for a substring matching two machines and checks exactly those two
  // checkboxes render while a non-matching one is absent.
  it('the search box filters the checklist, bypassing fold state entirely', () => {
    act(() => openAssistant());
    fireEvent.change(screen.getByPlaceholderText('filtern…'), { target: { value: 'presse' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2); // Presse + Kaputte Presse
    expect(screen.queryByRole('checkbox', { name: /^Fräse/ })).not.toBeInTheDocument();
  });
});

describe('AssistantModal — search validation', () => {
  // What: searching with no devices in the work area at all is rejected client-side with a
  // toast, rather than running a meaningless empty search.
  // How: opens the assistant and clicks search with nothing checked, checking the toast text.
  it('toasts when no devices have been added', () => {
    act(() => openAssistant());
    act(() => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
    });
    expect(document.getElementById('toast')!.textContent).toBe('Bitte oben Geräte übernehmen.');
  });

  // What: searching with an inverted date range (bis before von) is rejected client-side.
  // How: checks a device, sets the "bis" date before the default "von", clicks search, and
  // checks the toast text.
  it('toasts on an invalid date range', () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    const dateInputs = document.querySelectorAll('#modal input[type="date"]');
    fireEvent.change(dateInputs[1]!, { target: { value: '2000-01-01' } }); // "bis" before "von"
    act(() => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
    });
    expect(document.getElementById('toast')!.textContent).toBe('Bitte gültigen Zeitraum wählen.');
  });
});

describe('AssistantModal — search results', () => {
  // What: the suggested-device pill row is a universal feature (user request) — it shows even
  // for a bare device with no Bedarfsgruppe at all, not just when a group's own structure
  // suggests something.
  // How: checks one bare device, searches, and checks both the results header and a pill
  // naming that exact device appear.
  it('finds a free run and shows a suggestion pill even with no group in the tree', async () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
      await Promise.resolve();
    });
    expect(screen.getByText('Passende Termine:')).toBeInTheDocument();
    expect(document.querySelector('.aspills')).not.toBeNull();
    expect(screen.getByText('Fräse', { selector: '.aspill' })).toBeInTheDocument();
  });

  // What: the suggestion pills are colored by resource CATEGORY, not by device name (user
  // request) — two differently-named devices of the same category (both "Maschinen" in the
  // fixture) get the exact same pill color, unlike the old per-name hash which would have
  // given them two unrelated colors.
  // How: checks two devices of the same category, searches, and compares both pills' inline
  // background color.
  it('colors suggestion pills by resource category, not by device name', async () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /^Fräse/ }).click();
      screen.getByRole('checkbox', { name: /^Presse/ }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
      await Promise.resolve();
    });
    const fraese = screen.getByText('Fräse', { selector: '.aspill' }) as HTMLElement;
    const presse = screen.getByText('Presse', { selector: '.aspill' }) as HTMLElement;
    expect(fraese.style.backgroundColor).not.toBe('');
    expect(fraese.style.backgroundColor).toBe(presse.style.backgroundColor);
  });

  // What: when the searched machine has no free days anywhere in the requested range, the
  // results show an explicit "no matching dates found" message, not an empty/ambiguous list.
  // How: books every day in a 5-day range, searches that exact range, and checks the message.
  it('shows "keine passenden Termine" when the machine is fully booked in range', async () => {
    window.S.data!.bookings = {
      m1: Object.fromEntries(
        ['2021-01-04', '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08'].map((d) => [
          d,
          { name: 'bob' },
        ]),
      ),
    };
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    const dateInputs = document.querySelectorAll('#modal input[type="date"]');
    fireEvent.change(dateInputs[0]!, { target: { value: '2021-01-04' } });
    fireEvent.change(dateInputs[1]!, { target: { value: '2021-01-08' } });
    await act(async () => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
      await Promise.resolve();
    });
    expect(screen.getByText(/Keine passenden Termine im Zeitraum gefunden/)).toBeInTheDocument();
  });

  // What: a found run's "Buchen…" (book) button opens the booking form pre-filled with that
  // run's exact dates.
  // How: runs a search, clicks the result's Buchen button, and checks the booking form's
  // heading appears.
  it('"Buchen…" opens the booking form pre-picked with the run\'s dates', async () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
      await Promise.resolve();
    });
    act(() => {
      screen.getByRole('button', { name: 'Buchen…' }).click();
    });
    expect(screen.getByRole('heading', { name: 'Buchen' })).toBeInTheDocument(); // BookingForm opened
  });

  // What: a found run's "days to book" field clamps to the run's own actual length when the
  // user types a value longer than what's really free, and shows an explanatory tip.
  // How: sets up a run that ends at a fixed length (booked short of the search window's end,
  // so it's NOT open-ended and extendable), searches, types a too-large day count into the
  // run's days field, and checks it clamped to the run's real length with a tip explaining why.
  it('entering more days than the free window has clamps the value and shows a tip', async () => {
    // A booking on the 11th ends the run at the 8th WITHOUT reaching the search window's end
    // (the 15th) — so it stays a fixed 5-day run instead of being extended as "open-ended".
    window.S.data!.bookings = { m1: { '2021-01-11': { name: 'bob' } } };
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /^Fräse/ }).click();
    });
    const dateInputs = document.querySelectorAll('#modal input[type="date"]');
    fireEvent.change(dateInputs[0]!, { target: { value: '2021-01-04' } });
    fireEvent.change(dateInputs[1]!, { target: { value: '2021-01-15' } });
    await act(async () => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
      await Promise.resolve();
    });
    const daysInput = document.querySelector<HTMLInputElement>('.asDays')!;
    act(() => {
      fireEvent.change(daysInput, { target: { value: '99' } });
    });
    expect(daysInput.value).toBe('5'); // clamped to the run's own length
    expect(screen.getByText(/nur 5 Tage am Stück verfügbar/)).toBeInTheDocument();
  });

  // What: "pinning" a result (Termin anzeigen) filters the live grid to every device in the
  // work tree and collapses the assistant modal (not closing it entirely — it's still mounted
  // and reachable via the "reopen" affordance), so the user can look at the grid with the
  // assistant's work still available.
  // How: searches, clicks the pin button, and checks the grid's machine filter, that the
  // overlay is no longer "open" but the reopen indicator is showing and the modal content is
  // still actually in the DOM.
  it('"pin" collapses the modal and filters the grid to every device in the tree', async () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
      await Promise.resolve();
    });
    act(() => {
      screen.getByRole('button', { name: 'Termin anzeigen' }).click();
    });
    expect(window.S.machSel).toEqual(new Set(['m1']));
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false); // collapsed
    expect(document.getElementById('modalReopen')!.classList.contains('show')).toBe(true);
    expect(document.getElementById('modal')!.textContent).not.toBe(''); // still mounted
  });

  // What: a group with real redundancy (need < member count — the search could substitute
  // between equivalent devices) no longer blocks the search behind a confirmation dialog
  // (user request: the extra question every time a group exists was unwanted friction) — the
  // search just runs immediately, and the results still show a suggestion pill for the group.
  // How: forms a need-1-of-2 group, searches with no confirm mock involved at all, and checks
  // both that results appeared and that a suggested-device pill is shown.
  it('searches immediately with no confirmation when a group has redundancy, showing suggestion pills', async () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
      screen.getByRole('checkbox', { name: /^Presse/ }).click();
    });
    // Drag Presse onto Fräse to form a need-1-of-2 group (real redundancy: need < members).
    const devNodes = () => document.querySelectorAll('.asdev');
    const dt = dataTransferStub();
    act(() => {
      fireEvent.dragStart(devNodes()[1]!, { dataTransfer: dt });
      fireEvent.drop(devNodes()[0]!, { dataTransfer: dt });
    });
    expect(document.querySelectorAll('.asgrp')).toHaveLength(1);

    act(() => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
    });
    expect(screen.getByText('Passende Termine:')).toBeInTheDocument();
    expect(document.querySelector('.aspill')).toBeInTheDocument();
  });
});

describe('AssistantModal — the work-area group node', () => {
  function addGroupedPair(): void {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
      screen.getByRole('checkbox', { name: /^Presse/ }).click();
    });
    const dt = dataTransferStub();
    act(() => {
      const devNodes = document.querySelectorAll('.asdev');
      fireEvent.dragStart(devNodes[1]!, { dataTransfer: dt });
      fireEvent.drop(devNodes[0]!, { dataTransfer: dt });
    });
  }

  // What: a freshly-formed group (drag one device onto another) shows the terse "Benötigt: N
  // von M" need label — rigorously shortened from the old "Bedarf: brauche N von M – alle
  // gleichwertigen Geräte hier?" wording (user request) — and its stepper defaults to
  // needing 1 (of however many members the group has — 2 here).
  // How: forms a 2-device group and checks the "Benötigt:" label and the stepper's default value.
  it('shows the terse "Benötigt" need label, stepper defaulting to 1 of 2', () => {
    addGroupedPair();
    expect(screen.getByText('Benötigt:')).toBeInTheDocument();
    expect((document.querySelector('.asNeed') as HTMLInputElement).value).toBe('1');
  });

  // What: incrementing the need stepper raises the group's need.
  // How: clicks the "+" stepper once (need 1→2, matching the group's 2 members) and checks
  // the value updated.
  it('the "+" stepper increases need', () => {
    addGroupedPair();
    act(() => {
      document.querySelector<HTMLButtonElement>('.asstep[title="mehr"]')!.click();
    });
    expect((document.querySelector('.asNeed') as HTMLInputElement).value).toBe('2');
  });

  // What: the dissolve button (icon-only now, no "✕ auflösen" text — user request) breaks a
  // group apart, returning its member devices to being loose devices directly in the work area.
  // How: clicks the "Gruppe auflösen"-labeled button (by its accessible name, not visible
  // text) on a 2-device group and checks no groups remain while both devices now exist as
  // standalone nodes.
  it('the dissolve button breaks the group back into loose devices', () => {
    addGroupedPair();
    act(() => {
      screen.getByRole('button', { name: 'Gruppe auflösen' }).click();
    });
    expect(document.querySelectorAll('.asgrp')).toHaveLength(0);
    expect(document.querySelectorAll('.asdev')).toHaveLength(2);
  });

  // What: removing one device from a 2-device group leaves the group with only 1 child, so
  // it auto-dissolves (a group needs 2+ members to make sense) rather than lingering as a
  // pointless single-device group.
  // How: removes one device from a group of 2 via its own "remove" button and checks no
  // group remains, with exactly one loose device left.
  it('removing a device from within a group dissolves the now-single-child group', () => {
    addGroupedPair();
    act(() => {
      document
        .querySelectorAll('.rm[title="Aus Auswahl entfernen"]')[0]!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelectorAll('.asgrp')).toHaveLength(0); // 1 child left → auto-dissolved
    expect(document.querySelectorAll('.asdev')).toHaveLength(1);
  });

  // What: dragging a 3rd device onto one of a group's EXISTING members joins that group
  // flatly (same as dropping on the group's own background), rather than wrapping just that
  // one member and the new device in a brand-new nested subgroup — a real bug fix: with 2+
  // existing members, aiming for one of them (the easiest, biggest target) used to bury it
  // one level deeper each time, which looked like the drag had silently failed once a group
  // had more than 2 members.
  // How: forms a 2-device group, drags a 3rd device onto one of its two existing members, and
  // checks the result is still exactly one group, now with 3 flat children (no nested .asgrp).
  it('dropping a 3rd device onto an existing group member joins the group flatly, not nested', () => {
    addGroupedPair();
    act(() => {
      screen.getByRole('checkbox', { name: /Kaputte Presse/ }).click();
    });
    const dt = dataTransferStub();
    act(() => {
      // The freshly-checked 3rd device is the only .asdev NOT already inside the group.
      const newDevice = [...document.querySelectorAll<HTMLElement>('.asdev')].find(
        (el) => !el.closest('.asgrp-kids'),
      )!;
      const existingMember = document.querySelector<HTMLElement>('.asgrp-kids .asdev')!;
      fireEvent.dragStart(newDevice, { dataTransfer: dt });
      fireEvent.drop(existingMember, { dataTransfer: dt });
    });
    expect(document.querySelectorAll('.asgrp')).toHaveLength(1); // still one group, not nested
    expect(document.querySelectorAll('.asgrp-kids .asdev')).toHaveLength(3);
  });

  // What: dragging one whole Bedarfsgruppe onto ANOTHER group's own HEAD (its title bar — the
  // drag handle/stepper/dissolve row, titled "Gruppe ziehen zum Verschachteln") nests it inside
  // that group, same as dropping on the target group's kids background — a real regression:
  // the head used to fall outside every recognized drop target, so a group dropped there
  // silently moved to the root instead of nesting, looking exactly like nesting a Bedarfsgruppe
  // inside another had stopped working (the group's own head is the single biggest, most
  // obvious part of its card — the most natural thing to aim a drop at).
  // How: forms two separate 2-device groups (needs a 4th machine, since the shared fixture's
  // 3 machines only make one group's worth), drags the first group onto the second group's own
  // head element specifically, and checks the result is one group nested inside the other, not
  // two groups still sitting side by side at the root.
  it("dropping a whole group onto another group's own head nests it, not just its kids area", () => {
    window.S.data!.machines.push(machine({ id: 'm4', name: 'Bohrer' }));
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /^Fräse/ }).click();
      screen.getByRole('checkbox', { name: /^Presse/ }).click();
      screen.getByRole('checkbox', { name: /^Kaputte Presse/ }).click();
      screen.getByRole('checkbox', { name: /^Bohrer/ }).click();
    });
    const devNodes = () => [...document.querySelectorAll<HTMLElement>('.asdev')];
    const looseDevs = () => devNodes().filter((el) => !el.closest('.asgrp-kids'));
    // Group A: Fräse + Presse.
    const dtA = dataTransferStub();
    act(() => {
      const [first, second] = looseDevs();
      fireEvent.dragStart(second!, { dataTransfer: dtA });
      fireEvent.drop(first!, { dataTransfer: dtA });
    });
    // Group B: Kaputte Presse + Bohrer (the two still-loose devices).
    const dtB = dataTransferStub();
    act(() => {
      const [first, second] = looseDevs();
      fireEvent.dragStart(second!, { dataTransfer: dtB });
      fireEvent.drop(first!, { dataTransfer: dtB });
    });
    expect(document.querySelectorAll('.asgrp')).toHaveLength(2); // two separate groups so far

    const groups = () => [...document.querySelectorAll<HTMLElement>('.asgrp')];
    const groupA = groups()[0]!;
    const groupBHead = groups()[1]!.querySelector<HTMLElement>('.asgrp-head')!;
    const dtNest = dataTransferStub();
    act(() => {
      fireEvent.dragStart(groupA, { dataTransfer: dtNest });
      fireEvent.drop(groupBHead, { dataTransfer: dtNest });
    });
    expect(document.querySelectorAll('.asgrp')).toHaveLength(2); // still two groups...
    expect(document.querySelector('.asgrp-kids > .asgrp')).not.toBeNull(); // ...one nested in the other
  });
});

describe('AssistantModal — drag-and-drop highlighting', () => {
  // What: dragging one device over another highlights the hovered device as a drop target,
  // and the highlight clears once the drag ends (whether or not a drop actually happened).
  // How: starts a drag on one device, drags over another, checks the target got the dragover
  // class, then ends the drag and checks the class was removed.
  it('highlights the hovered device during dragover, and clears it on dragend', () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /^Fräse/ }).click();
      screen.getByRole('checkbox', { name: /^Presse/ }).click();
    });
    const dt = dataTransferStub();
    const devNodes = () => document.querySelectorAll('.asdev');
    act(() => {
      fireEvent.dragStart(devNodes()[1]!, { dataTransfer: dt });
      fireEvent.dragOver(devNodes()[0]!, { dataTransfer: dt });
    });
    expect(devNodes()[0]!.classList.contains('dragover')).toBe(true);
    act(() => {
      fireEvent.dragEnd(devNodes()[1]!);
    });
    expect(devNodes()[0]!.classList.contains('dragover')).toBe(false);
  });

  // What: dragging a device onto the empty work-area canvas (not onto another device)
  // highlights the canvas itself as a valid drop target — the "move this device to root
  // level" gesture, distinct from dropping onto another device (which would group them).
  // How: drags a device over the work-area container itself and checks it got the
  // dragover-root class.
  it('dragging onto the empty canvas highlights dragover-root', () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /^Fräse/ }).click();
    });
    const dt = dataTransferStub();
    const work = document.getElementById('asWork')!;
    act(() => {
      fireEvent.dragStart(document.querySelector('.asdev')!, { dataTransfer: dt });
      fireEvent.dragOver(work, { dataTransfer: dt });
    });
    expect(work.classList.contains('dragover-root')).toBe(true);
  });
});

describe('openAssistant', () => {
  // What: the "Abbrechen" (cancel) button closes the assistant modal.
  // How: opens the assistant, clicks Abbrechen, and checks the overlay's open class is gone.
  it('closes on "Abbrechen"', () => {
    act(() => openAssistant());
    act(() => {
      screen.getByRole('button', { name: 'Abbrechen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});
