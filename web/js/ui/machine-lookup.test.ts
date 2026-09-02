// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { AppState, Machine, ServerData } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import { machById } from './machine-lookup.ts';

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
    // Faithful to legacy: mutating in place without replacing the array does NOT rebuild —
    // the new machine is invisible until something replaces S.data.machines wholesale.
    expect(machById('m2')).toBeUndefined();
  });
});
