// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
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

describe('AssistantModal — checklist → work area', () => {
  it('shows the empty-work hint until a device is checked', () => {
    act(() => openAssistant());
    expect(screen.getByText(/Oben Geräte anhaken/)).toBeInTheDocument();
  });

  it('checking a device adds it to the work area; unchecking removes it', () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    expect(screen.queryByText(/Oben Geräte anhaken/)).not.toBeInTheDocument();
    expect(document.querySelector('.asdev[title^="Fräse"]')).toBeInTheDocument();

    act(() => {
      screen.getByRole('checkbox', { name: /Fräse/ }).click();
    });
    expect(screen.getByText(/Oben Geräte anhaken/)).toBeInTheDocument();
  });
});

describe('AssistantModal — checklist details', () => {
  it('shows the info icon and the maintenance badge for a machine that has them', () => {
    act(() => openAssistant());
    openChecklistCategory();
    expect(document.querySelector('.machinfo')).toBeInTheDocument();
    expect(screen.getByText('Wartung')).toBeInTheDocument();
  });

  it('clicking the info icon does not toggle the checkbox', () => {
    act(() => openAssistant());
    openChecklistCategory();
    act(() => {
      fireEvent.click(document.querySelector('.machinfo')!);
    });
    expect(screen.getByRole('checkbox', { name: /Kaputte Presse/ })).not.toBeChecked();
  });

  it('the search box filters the checklist, bypassing fold state entirely', () => {
    act(() => openAssistant());
    fireEvent.change(screen.getByPlaceholderText('filtern…'), { target: { value: 'presse' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2); // Presse + Kaputte Presse
    expect(screen.queryByRole('checkbox', { name: /^Fräse/ })).not.toBeInTheDocument();
  });
});

describe('AssistantModal — search validation', () => {
  it('toasts when no devices have been added', () => {
    act(() => openAssistant());
    act(() => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
    });
    expect(document.getElementById('toast')!.textContent).toBe('Bitte oben Geräte übernehmen.');
  });

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
  it('finds a free run and shows it with no suggestion line (no group in the tree)', async () => {
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
    expect(screen.queryByText(/Vorschlag:/)).not.toBeInTheDocument();
  });

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
});

describe('AssistantModal — redundancy confirm', () => {
  it('asks for confirmation before searching when a group has redundancy, and respects "no"', async () => {
    window.askConfirm = vi.fn().mockResolvedValue(false);
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

    await act(async () => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
      await Promise.resolve();
    });
    expect(window.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Alle gleichwertigen Geräte erfasst?' }),
    );
    expect(screen.queryByText('Passende Termine:')).not.toBeInTheDocument(); // declined → no search
  });

  it('runs the search once confirmed, and shows the suggestion line (a group exists)', async () => {
    window.askConfirm = vi.fn().mockResolvedValue(true);
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
    await act(async () => {
      screen.getByRole('button', { name: 'Freie Termine suchen' }).click();
      await Promise.resolve();
    });
    expect(screen.getByText(/Vorschlag:/)).toBeInTheDocument();
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

  it('shows the redundancy hint and the stepper defaults to need 1 of 2', () => {
    addGroupedPair();
    expect(screen.getByText(/alle gleichwertigen Geräte hier\?/)).toBeInTheDocument();
    expect((document.querySelector('.asNeed') as HTMLInputElement).value).toBe('1');
  });

  it('the "+" stepper increases need and hides the redundancy hint once need meets the count', () => {
    addGroupedPair();
    act(() => {
      document.querySelector<HTMLButtonElement>('.asstep[title="mehr"]')!.click();
    });
    expect((document.querySelector('.asNeed') as HTMLInputElement).value).toBe('2');
    expect(screen.queryByText(/alle gleichwertigen Geräte hier\?/)).not.toBeInTheDocument();
  });

  it('"✕ auflösen" dissolves the group back into loose devices', () => {
    addGroupedPair();
    act(() => {
      screen.getByText('✕ auflösen').click();
    });
    expect(document.querySelectorAll('.asgrp')).toHaveLength(0);
    expect(document.querySelectorAll('.asdev')).toHaveLength(2);
  });

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
});

describe('AssistantModal — drag-and-drop highlighting', () => {
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
  it('closes on "Abbrechen"', () => {
    act(() => openAssistant());
    act(() => {
      screen.getByRole('button', { name: 'Abbrechen' }).click();
    });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});
