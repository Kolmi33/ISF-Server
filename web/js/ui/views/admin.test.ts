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
  // What: 'manual' (and any other unrecognized sort value) keeps the machines in their
  // stored (input array) order — no re-sorting at all.
  // How: checks the literal 'manual' value and an arbitrary unrecognized string both
  // preserve the input order.
  it('manual keeps the stored order', () => {
    expect(ids(filterAdminMachines(all, 'manual', ''))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(filterAdminMachines(all, 'somethingElse', ''))).toEqual(['a', 'b', 'c', 'd']); // any non-name/group
  });

  // What: 'name' sorts purely by machine name, using German collation.
  // How: checks the four machines (in scrambled name order) come back alphabetically.
  it('name sorts alphabetically (German collation)', () => {
    expect(ids(filterAdminMachines(all, 'name', ''))).toEqual(['b', 'd', 'c', 'a']); // Alpha,Beta,Mu,Zeta
  });

  // What: 'group' sorts by group first, then by name within a group, with an empty
  // (unset) group sorting before any real group name.
  // How: checks the ordering across three distinct groups including one empty group.
  it('group sorts by group then name, empty group first', () => {
    // '' (d) < 'Halle' (a,c → Mu,Zeta) < 'Labor' (b)
    expect(ids(filterAdminMachines(all, 'group', ''))).toEqual(['d', 'c', 'a', 'b']);
  });

  // What: the empty-group-first rule holds regardless of which side of the comparison the
  // empty group is on, and two machines in the SAME group tie-break by name.
  // How: checks both orderings of an empty-group/real-group pair, then two same-group
  // machines sorting by name.
  it('group sort: empty-group fallback (both operand sides) and same-group name tiebreak', () => {
    expect(ids(filterAdminMachines([d, a], 'group', ''))).toEqual(['d', 'a']); // a-side group ''
    expect(ids(filterAdminMachines([a, d], 'group', ''))).toEqual(['d', 'a']); // b-side group ''
    expect(ids(filterAdminMachines([a, c], 'group', ''))).toEqual(['c', 'a']); // equal group → Mu < Zeta
  });

  // What: the search query matches a case-insensitive substring of "name group" combined —
  // it can match on either field, and a query matching nothing yields an empty list.
  // How: checks a group-name match, a machine-name match, and a query matching nothing at all.
  it('filters by a case-insensitive substring of name+group', () => {
    expect(ids(filterAdminMachines(all, 'manual', 'HALLE'))).toEqual(['a', 'c']); // group match
    expect(ids(filterAdminMachines(all, 'manual', 'alp'))).toEqual(['b']); // name match
    expect(filterAdminMachines(all, 'manual', 'zzz')).toEqual([]);
  });

  // What: filterAdminMachines returns a new array — it never mutates the machines array it was given.
  // How: calls it with a sort that would reorder the list, then checks the original array is unchanged.
  it('does not mutate the input array', () => {
    const input = [a, b, c, d];
    filterAdminMachines(input, 'name', '');
    expect(input).toEqual([a, b, c, d]);
  });
});
