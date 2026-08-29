import { describe, it, expect } from 'vitest';
import type { Machine } from '../../../../shared/types.ts';
import { filterAdminMachines } from './admin.ts';

const mach = (id: string, name: string, group: string): Machine => ({ id, name, group });
const a = mach('a', 'Zeta', 'Halle');
const b = mach('b', 'Alpha', 'Labor');
const c = mach('c', 'Mu', 'Halle');
const d = mach('d', 'Beta', ''); // empty group → collation fallback
const all = [a, b, c, d];
const ids = (rs: Machine[]) => rs.map((m) => m.id);

describe('filterAdminMachines', () => {
  it('manual keeps the stored order', () => {
    expect(ids(filterAdminMachines(all, 'manual', ''))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(filterAdminMachines(all, 'somethingElse', ''))).toEqual(['a', 'b', 'c', 'd']); // any non-name/group
  });

  it('name sorts alphabetically (German collation)', () => {
    expect(ids(filterAdminMachines(all, 'name', ''))).toEqual(['b', 'd', 'c', 'a']); // Alpha,Beta,Mu,Zeta
  });

  it('group sorts by group then name, empty group first', () => {
    // '' (d) < 'Halle' (a,c → Mu,Zeta) < 'Labor' (b)
    expect(ids(filterAdminMachines(all, 'group', ''))).toEqual(['d', 'c', 'a', 'b']);
  });

  it('group sort: empty-group fallback (both operand sides) and same-group name tiebreak', () => {
    expect(ids(filterAdminMachines([d, a], 'group', ''))).toEqual(['d', 'a']); // a-side group ''
    expect(ids(filterAdminMachines([a, d], 'group', ''))).toEqual(['d', 'a']); // b-side group ''
    expect(ids(filterAdminMachines([a, c], 'group', ''))).toEqual(['c', 'a']); // equal group → Mu < Zeta
  });

  it('filters by a case-insensitive substring of name+group', () => {
    expect(ids(filterAdminMachines(all, 'manual', 'HALLE'))).toEqual(['a', 'c']); // group match
    expect(ids(filterAdminMachines(all, 'manual', 'alp'))).toEqual(['b']); // name match
    expect(filterAdminMachines(all, 'manual', 'zzz')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [a, b, c, d];
    filterAdminMachines(input, 'name', '');
    expect(input).toEqual([a, b, c, d]);
  });
});
