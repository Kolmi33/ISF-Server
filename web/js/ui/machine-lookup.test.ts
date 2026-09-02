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
  it('finds a machine by id', () => {
    window.S.data = serverData([machine(), machine({ id: 'm2', name: 'Presse' })]);
    expect(machById('m2')!.name).toBe('Presse');
  });

  it('returns undefined for an unknown id', () => {
    window.S.data = serverData([machine()]);
    expect(machById('missing')).toBeUndefined();
  });

  it('returns undefined when there is no data yet', () => {
    expect(machById('m1')).toBeUndefined();
  });

  it('rebuilds the cache when S.data.machines is replaced by a new array reference', () => {
    window.S.data = serverData([machine()]);
    expect(machById('m2')).toBeUndefined();
    window.S.data = serverData([machine(), machine({ id: 'm2', name: 'Presse' })]);
    expect(machById('m2')!.name).toBe('Presse');
  });

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

  it('invalidateMachineLookupCache forces a rebuild on the next call, even with the same array reference', () => {
    const machines = [machine()];
    window.S.data = serverData(machines);
    machById('m1'); // builds the cache
    machines.push(machine({ id: 'm2', name: 'Presse' })); // mutate in place, same reference
    invalidateMachineLookupCache();
    expect(machById('m2')!.name).toBe('Presse');
  });
});
