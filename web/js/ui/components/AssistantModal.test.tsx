// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent, within } from '@testing-library/react';
import { addDays, format, startOfDay } from 'date-fns';
import { store } from '../../store-instance.ts';
import { openAssistant } from './AssistantModal.tsx';
import { closeReactModal } from '../modal.tsx';
import { openBookingForm } from './BookingForm.tsx';
import { gotoDate } from '../grid-scroll.ts';

vi.mock('./BookingForm.tsx', () => ({ openBookingForm: vi.fn() }));
vi.mock('../grid-scroll.ts', () => ({
  gotoDate: vi.fn(),
  prependWeek: vi.fn(),
  resetView: vi.fn(),
}));
vi.mock('../grid-interaction.ts', () => ({ clearSelection: vi.fn() }));
vi.mock('./MachineFilterDropdown.tsx', () => ({ saveFilters: vi.fn(), updateMachBtn: vi.fn() }));

const today = startOfDay(new Date());
const startISO = format(today, 'yyyy-MM-dd');
const nextISO = format(addDays(today, 1), 'yyyy-MM-dd');

// jsdom's selector engine recurses on top-layer pseudo-classes queried by
// Floating UI, including queued positioning after unmount. Keep this shim for
// this isolated test environment's lifetime. Portals and their behavior stay real.
const matches = Element.prototype.matches;
vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector) {
  if ([':modal', ':popover-open', ':fullscreen'].includes(selector)) return false;
  return matches.call(this, selector);
});

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no Web Animations API; expose the browser's empty-animation case.
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  vi.stubGlobal('PointerEvent', MouseEvent);
  document.body.innerHTML =
    '<div id="overlay"><div id="modal" tabindex="-1"></div></div><div id="modalReopen"></div><div id="toast"></div>';
  store.set({
    readOnly: false,
    favs: new Set(['a']),
    data: {
      machines: [
        {
          id: 'a',
          name: 'Echte Fräse',
          group: 'Alte Halle',
          days: '1111111',
          info: 'Nur mit Einweisung',
        },
        { id: 'b', name: 'Echte Presse', group: 'Alte Halle', days: '1111100' },
        { id: 'broken', name: 'Gesperrtes Gerät', group: 'Labor', maint: [{ type: 'wartung' }] },
      ],
      bookings: {},
      groups: ['Alte Halle', 'Labor'],
      revision: 1,
      log: [],
    },
  });
  act(() => openAssistant());
});
afterEach(() => {
  act(() => closeReactModal());
  vi.clearAllTimers();
  vi.useRealTimers();
});
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const select = () => fireEvent.click(screen.getAllByRole('checkbox', { name: /Echte Fräse/ })[0]!);
const openFold = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const search = () => click('Freie Termine suchen');
const change = (name: string, value: string) => {
  const input = screen.getByRole('textbox', { name });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe('supplied assistant host integration', () => {
  it('uses live catalog in all cards; favorite and category checkboxes share selection', () => {
    expect(screen.getByText('Laborgeräte reservieren')).toBeTruthy();
    // Untertitel: erst der Bereich, dann die Info-Notiz aus der Maschinenverwaltung.
    expect(screen.getByText('Alte Halle · Nur mit Einweisung')).toBeTruthy();
    select();
    // Katalogzeile und Plankarte zeigen denselben Untertitel.
    expect(screen.getAllByText('Alte Halle · Nur mit Einweisung')).toHaveLength(2);
    expect(
      screen
        .getAllByRole('checkbox', { name: /Echte Fräse/ })
        .every((c) => c.getAttribute('aria-checked') === 'true'),
    ).toBe(true);
    const removeButton = screen.getByRole('button', { name: 'Echte Fräse entfernen' });
    const position = screen.getByLabelText('Position 01');
    const alternativeButton = screen.getByRole('button', {
      name: 'Alternativen für Echte Fräse auswählen',
    });
    expect(position.nextElementSibling).toBe(alternativeButton);
    expect(alternativeButton.nextElementSibling).toBe(removeButton);
    click('Echte Fräse entfernen');
    expect(screen.getByText('Noch nichts ausgewählt.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Freie Termine suchen' }).hasAttribute('disabled'),
    ).toBe(true);
  });
  it('preserves filtering, folds every super category shut but the favorites', () => {
    const input = screen.getByRole('textbox', { name: 'Gerät suchen' });
    fireEvent.change(input, { target: { value: 'Presse' } });
    // Die Suche klappt auf, sonst läge der Treffer unter einer zugeklappten Rubrik.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    // Ohne Info-Notiz bleibt der Bereich allein stehen.
    expect(screen.getByTitle('Alte Halle')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Echte Presse entfernen' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'unbekannt' } });
    expect(screen.getByText('Kein Gerät passt zu „unbekannt“.')).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    // Ohne Suche steht nur der Favorit offen.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    const section = screen.getByRole('button', { name: /^Maschinen/ });
    expect(section.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(section);
    expect(section.getAttribute('aria-expanded')).toBe('true');
    const category = screen.getByRole('button', { name: /^Alte Halle/ });
    expect(category.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(category);
    expect(category.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(section);
    expect(screen.queryByRole('button', { name: /^Alte Halle/ })).toBeNull();
  });
  it('groups selected plan cards through the ODER picker', () => {
    select();
    const input = screen.getByRole('textbox', { name: 'Gerät suchen' });
    fireEvent.change(input, { target: { value: 'Presse' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Echte Presse/ }));
    click('Alternativen für Echte Fräse auswählen');
    expect(screen.getByText(/Diese Karten werden mit Echte Fräse/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Echte Presse' }));
    click('Als ODER gruppieren');
    expect(
      (screen.getByRole('textbox', { name: 'Benötigte Geräte' }) as HTMLInputElement).value,
    ).toBe('1');
    expect(screen.getByRole('button', { name: 'Bedarfsgruppe auflösen' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Alternativen für .* auswählen/ })).toHaveLength(
      3,
    );
  });
  it('transfers min/max, exact devices and selected calendar dates to confirmation', () => {
    select();
    change('Min. Tage', '2');
    change('Max. Tage', '4');
    search();
    const input = screen.getByRole('textbox', { name: 'Buchungstage' });
    expect((input as HTMLInputElement).value).toBe('4');
    change('Buchungstage', '2');
    click('Buchen');
    expect(openBookingForm).toHaveBeenCalledWith(['a'], startISO, nextISO, [startISO, nextISO]);
    click('Zurück zur Auswahl');
    expect(screen.getByRole('button', { name: 'Echte Fräse entfernen' })).toBeTruthy();
    search();
    change('Max. Tage', '3');
    click('Neu suchen');
    expect((screen.getByRole('textbox', { name: 'Buchungstage' }) as HTMLInputElement).value).toBe(
      '3',
    );
  });
  it('blocks stale availability and read-only booking without writing', () => {
    select();
    search();
    store.get('data')!.bookings.a = { [startISO]: { name: 'Belegt' } };
    click('Buchen');
    expect(openBookingForm).not.toHaveBeenCalled();
    expect(document.getElementById('toast')!.textContent).toContain('Verfügbarkeit');
    store.set({ readOnly: true });
    click('Buchen');
    expect(document.getElementById('toast')!.textContent).toContain('Lesemodus');
  });
  it('shows only resolved machines in the calendar and retains the assistant for reopening', () => {
    select();
    search();
    click('Im Kalender anzeigen');
    expect(gotoDate).toHaveBeenCalledWith(startISO);
    expect([...store.get('machSel')]).toEqual(['a']);
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
    expect(document.getElementById('modalReopen')!.classList.contains('show')).toBe(true);
    fireEvent.click(document.getElementById('modalReopen')!);
    expect(screen.getByRole('button', { name: 'Neu suchen' })).toBeTruthy();
  });
  it('shows genuine no-results and enforces coupled duration bounds', () => {
    openFold(/^Maschinen/);
    openFold(/^Labor/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Gesperrtes Gerät/ }));
    search();
    expect(
      screen.getByText('Kein Fenster gefunden, in dem alle Geräte gleichzeitig frei sind.'),
    ).toBeTruthy();
    change('Min. Tage', '999');
    expect((screen.getByRole('textbox', { name: 'Max. Tage' }) as HTMLInputElement).value).toBe(
      '7',
    );
    expect(screen.getByRole('alert').textContent).toContain('7 Tage');
    change('Max. Tage', '1');
    expect((screen.getByRole('textbox', { name: 'Min. Tage' }) as HTMLInputElement).value).toBe(
      '1',
    );
    click('Min. Tage verringern');
    expect(screen.getByRole('alert').textContent).toContain('1 Tag');
  });
  it('calendar presets keep the draft until applied and clamp duration to the new range', () => {
    fireEvent.click(screen.getByRole('button', { name: /Zeitraum/ }));
    click('7 Tage');
    click('Übernehmen');
    expect((screen.getByRole('textbox', { name: 'Max. Tage' }) as HTMLInputElement).value).toBe(
      '7',
    );
    expect(screen.getByRole('button', { name: /Zeitraum/ }).textContent).toContain(
      format(addDays(today, 6), 'dd.MM.yyyy'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Zeitraum/ }));
    click('Zurücksetzen');
    expect(screen.getByRole('button', { name: 'Übernehmen' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(true);
  });
  it('picks a fresh start date on the first click, then the end on the second', () => {
    fireEvent.click(screen.getByRole('button', { name: /Zeitraum/ }));
    const days = screen
      .getAllByRole('gridcell')
      .map((cell) => cell.querySelector('button'))
      .filter((b): b is HTMLButtonElement => !!b && !b.disabled);
    expect(days.length).toBeGreaterThan(7);
    const todayText = format(today, 'dd.MM.yyyy');
    // Ein Klick weit hinter dem laufenden Zeitraum setzt den Start dorthin — vorher zog er
    // nur das Ende nach, und der Start blieb für immer auf heute stehen.
    fireEvent.click(days[days.length - 1]!);
    const pending = screen.getByText(/Enddatum wählen/);
    expect(pending.textContent).not.toContain(todayText);
    expect(screen.getByRole('button', { name: 'Übernehmen' }).hasAttribute('disabled')).toBe(true);
    // Der zweite Klick liegt davor: Start und Ende tauschen, statt einen Rückwärts-Zeitraum
    // zu ergeben.
    fireEvent.click(days[0]!);
    expect(screen.queryByText(/Enddatum wählen/)).toBeNull();
    click('Übernehmen');
    const trigger = screen.getByRole('button', { name: /Zeitraum/ }).textContent ?? '';
    expect(trigger).toContain(todayText);
    // Der übernommene Zeitraum reicht bis in den Folgemonat, ist also länger als die
    // anfänglichen sieben Tage.
    expect(trigger).not.toContain('· 7 Tage');
  });
  it('grouping help opens on focus and only Abbrechen dismisses the assistant', () => {
    const help = screen.getByRole('button', { name: 'Hinweis zu Bedarfsgruppen' });
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => help.focus());
    // Floating UI positions asynchronously; positioning/visibility is verified in Orca.
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).toContain('Auswählen (UND):');
    expect(tooltip.textContent).toContain('Alternativen gruppieren (ODER):');
    expect(tooltip.textContent).toContain('Trennen:');
    expect(screen.queryByRole('button', { name: 'Dialog schließen' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(document.getElementById('overlay')!);
    expect(
      within(document.getElementById('modal')!).getByRole('heading', {
        name: 'Buchungsassistent',
      }),
    ).toBeTruthy();
    click('Abbrechen');
    expect(document.getElementById('overlay')!.classList.contains('open')).toBe(false);
  });
});
