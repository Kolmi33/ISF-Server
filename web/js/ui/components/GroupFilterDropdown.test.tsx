// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, type RenderResult } from '@testing-library/react';
import type { AppState, Machine } from '../../../../shared/types.ts';
import { store } from '../../store-instance.ts';
import { GroupFilterDropdown, fillGroupSel } from './GroupFilterDropdown.tsx';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

let mounted: RenderResult;

// window.S is kept aliased to store.state so the component (migrated onto the real store) and
// this test agree; window.notify forwards to store.notify() exactly as app.ts does in
// production, so notifySpy sees every repaint trigger.
const notifySpy = vi.spyOn(store, 'notify');

beforeEach(() => {
  document.body.innerHTML = `<button id="groupBtn">Alle Bereiche ▾</button><div id="groupDrop"></div>`;
  store.set({
    data: { machines: [machine(), machine({ id: 'm2', name: 'Presse', group: 'Halle 2' })] },
    groupsSel: new Set(),
    machSel: new Set(),
    favs: new Set(),
  } as unknown as Partial<AppState>);
  window.S = store.state;
  notifySpy.mockClear();
  window.notify = () => store.notify();
  localStorage.clear();
  mounted = render(<GroupFilterDropdown />, { container: document.getElementById('groupDrop')! });
});

function openDropdown(): void {
  act(() => fireEvent.click(document.getElementById('groupBtn')!));
}

describe('GroupFilterDropdown', () => {
  // What: with no group filter active, the toolbar button reads "Alle Bereiche" (all areas)
  // right from mount, without needing the dropdown to be opened first.
  // How: renders and checks the button's text immediately.
  it("initializes #groupBtn's label at mount, with nothing selected", () => {
    expect(document.getElementById('groupBtn')!.textContent).toBe('Alle Bereiche ▾');
  });

  // What: the dropdown starts closed; once opened, it lists an "all areas" option (checked
  // by default) plus one checkbox per distinct group.
  // How: checks the closed state, opens it, and checks the "all" checkbox plus both real groups.
  it('is closed by default, listing "Alle Bereiche" (checked) plus one row per group once opened', () => {
    expect(document.getElementById('groupDrop')!.classList.contains('open')).toBe(false);
    openDropdown();
    expect(document.getElementById('groupDrop')!.classList.contains('open')).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Alle Bereiche/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Halle 1' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Halle 2' })).toBeInTheDocument();
  });

  // What: checking one group's checkbox adds it to the group-filter set, persists that
  // choice, repaints, and updates the toolbar button to name the single selected group's count.
  // How: opens the dropdown, checks one group, and checks the store, localStorage, notify,
  // and the button's updated "1 Bereich" text.
  it('checking a group adds it to S.groupsSel, persists, notifies, and updates the toolbar button', () => {
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 1' })));
    expect(window.S.groupsSel.has('Halle 1')).toBe(true);
    expect(JSON.parse(localStorage.getItem('mb_groupssel')!)).toEqual(['Halle 1']);
    expect(notifySpy).toHaveBeenCalled();
    expect(document.getElementById('groupBtn')!.textContent).toBe('1 Bereich ▾');
  });

  // What: the toolbar button's label pluralizes ("Bereiche" not "Bereich") once more than
  // one group is selected — but crucially, this is a PARTIAL selection (2 of 3 groups here);
  // selecting literally every group is a different case, covered next.
  // How: adds a third group so there are 3 total, checks 2 of them, and checks the button
  // shows the plural "2 Bereiche" form.
  it('pluralizes once more than one group is selected (but not every group — see below)', () => {
    window.S.data!.machines.push(machine({ id: 'm3', name: 'Bohrer', group: 'Halle 3' }));
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 1' })));
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 2' })));
    expect(document.getElementById('groupBtn')!.textContent).toBe('2 Bereiche ▾');
  });

  // What: checking off EVERY group (with only 2 groups total here) is treated as equivalent
  // to selecting none — the filter collapses back to "all areas" rather than staying as an
  // explicit "both of the 2 groups" selection, matching the original app's behavior.
  // How: checks both existing groups (all of them) and checks the filter set is empty and the
  // button reads "Alle Bereiche" again.
  it('selecting every group collapses back to "all" (matches legacy\'s "all selected = all")', () => {
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 1' })));
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Halle 2' })));
    expect(window.S.groupsSel.size).toBe(0);
    expect(document.getElementById('groupBtn')!.textContent).toBe('Alle Bereiche ▾');
  });

  // What: explicitly clicking "Alle Bereiche" always resets the filter to empty (showing
  // every group), regardless of what was previously selected.
  // How: starts with one group already selected, clicks "Alle Bereiche", and checks the
  // filter set emptied and notify fired.
  it('"Alle Bereiche" always resets the selection to none, persists, and notifies', () => {
    window.S.groupsSel = new Set(['Halle 1']);
    openDropdown();
    act(() => fireEvent.click(screen.getByRole('checkbox', { name: /Alle Bereiche/ })));
    expect(window.S.groupsSel.size).toBe(0);
    expect(notifySpy).toHaveBeenCalled();
  });

  // What: clicking anywhere outside the open dropdown closes it — standard dropdown behavior.
  // How: opens the dropdown, mousedowns an unrelated element, and checks the open class is gone.
  it('an outside click closes the dropdown', () => {
    document.body.innerHTML += '<div id="elsewhere"></div>';
    openDropdown();
    act(() => fireEvent.mouseDown(document.getElementById('elsewhere')!));
    expect(document.getElementById('groupDrop')!.classList.contains('open')).toBe(false);
  });

  // What: fillGroupSel recomputes the dropdown's group list from the current machine data —
  // a group added after the component mounted (e.g. via a new machine) shows up once
  // fillGroupSel is called, without needing a full remount.
  // How: opens the dropdown, adds a machine in a brand-new group and calls fillGroupSel(),
  // and checks the new group's checkbox now exists.
  it('fillGroupSel recomputes the group list — a newly-added group appears on next open', () => {
    openDropdown();
    act(() => {
      window.S.data!.machines.push(machine({ id: 'm3', name: 'Bohrer', group: 'Halle 3' }));
      fillGroupSel();
    });
    expect(screen.getByRole('checkbox', { name: 'Halle 3' })).toBeInTheDocument();
  });

  // What: fillGroupSel is called unconditionally by MachineFormModal/live-connection.ts (they
  // have no way to know whether a dropdown instance is currently mounted), so it must survive
  // being called after the dropdown itself has unmounted, rather than throwing.
  // How: unmounts the rendered dropdown and checks calling fillGroupSel() afterward doesn't throw.
  it('fillGroupSel is a no-op (not a throw) after the dropdown unmounts', () => {
    // MachineFormModal/live-connection.ts call this unconditionally — must survive the
    // (unlikely) case that no instance is currently mounted to receive it.
    act(() => mounted.unmount());
    expect(() => fillGroupSel()).not.toThrow();
  });
});
