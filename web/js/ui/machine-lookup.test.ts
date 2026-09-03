// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { AppState, Machine, ServerData } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import { machById, invalidateMachineLookupCache } from './machine-lookup.ts';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

function serverData(machines: Machine[]): ServerData {
  return { machines, bookings: {} } as unknown as ServerData;
}

beforeEach(() => {
  store.set({ data: null } as unknown as Partial<AppState>);
  window.S = store.state;
});

describe('machById', () => {
  // What: looks up a machine by its id among the currently loaded machines.
  // How: loads two machines and checks the lookup for the second one's id returns its data.
  it('finds a machine by id', () => {
    window.S.data = serverData([machine(), machine({ id: 'm2', name: 'Presse' })]);
    expect(machById('m2')!.name).toBe('Presse');
  });

  // What: an id not among the loaded machines resolves to undefined, not an error.
  // How: loads one machine and looks up a different, nonexistent id.
  it('returns undefined for an unknown id', () => {
    window.S.data = serverData([machine()]);
    expect(machById('missing')).toBeUndefined();
  });

  // What: before any server data has loaded at all, every lookup is undefined.
  // How: leaves S.data as null (the pre-load state) and looks up an id.
  it('returns undefined when there is no data yet', () => {
    expect(machById('m1')).toBeUndefined();
  });

  // What: the lookup cache is keyed on the machines array's own reference — assigning a
  // brand-new array (a fresh server load) correctly rebuilds the cache to reflect it.
  // How: loads one machine, confirms a second id isn't found, then replaces S.data with a
  // NEW array containing that second machine, and checks it's now found.
  it('rebuilds the cache when S.data.machines is replaced by a new array reference', () => {
    window.S.data = serverData([machine()]);
    expect(machById('m2')).toBeUndefined();
    window.S.data = serverData([machine(), machine({ id: 'm2', name: 'Presse' })]);
    expect(machById('m2')!.name).toBe('Presse');
  });

  // What: the cache's staleness check is reference-equality only — mutating the SAME array in
  // place (push, splice, etc.) is invisible to it by design, so a lookup for something added
  // that way still misses until something explicitly invalidates the cache.
  // How: builds the cache with one machine, pushes a second machine into that same array
  // in place (no new reference), and checks the lookup for it still misses.
  it('keeps using the cached Map when the array reference is unchanged (mutated in place)', () => {
    const machines = [machine()];
    window.S.data = serverData(machines);
    machById('m1'); // builds the cache
    machines.push(machine({ id: 'm2', name: 'Presse' })); // mutate in place, same reference
    // The cache's own check is reference-equality only — an in-place mutation is invisible to
    // it by design (that's exactly the gap invalidateMachineLookupCache() below exists to
    // close; ui/mutate.ts calls it after every machine-structural write, which is how this
    // stays correct in practice without every machById() call re-scanning the array).
    expect(machById('m2')).toBeUndefined();
  });

  // What: invalidateMachineLookupCache() forces a rebuild on the very next lookup, even
  // though the array reference itself never changed — the escape hatch for the in-place-
  // mutation gap above.
  // How: repeats the same in-place-mutation setup as above, but calls
  // invalidateMachineLookupCache() before the next lookup, and checks it now finds the
  // pushed machine.
  it('invalidateMachineLookupCache forces a rebuild on the next call, even with the same array reference', () => {
    const machines = [machine()];
    window.S.data = serverData(machines);
    machById('m1'); // builds the cache
    machines.push(machine({ id: 'm2', name: 'Presse' })); // mutate in place, same reference
    invalidateMachineLookupCache();
    expect(machById('m2')!.name).toBe('Presse');
  });
});
