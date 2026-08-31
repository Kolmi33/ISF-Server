import { describe, it, expect } from 'vitest';
import type { Machine, Bookings } from '../../../../shared/types.ts';
import {
  computeStats,
  buildResourceRows,
  buildMaintRows,
  buildPersonRows,
  type StatsMachineRow,
  type StatsMaintRow,
  type StatsPerson,
} from './stats.ts';

const bk = (name: string) => ({ name });
// m1: a machine with a 2-day maintenance slot; m2: a measurement device, no maintenance.
const m1: Machine = {
  id: 'm1',
  name: 'M1',
  group: 'Halle',
  maint: [{ type: 'wartung', from: '2021-01-05', until: '2021-01-06' }],
};
const m2: Machine = { id: 'm2', name: 'M2', group: 'Labor', cat: 'messtechnik' };

describe('computeStats', () => {
  // Range 2021-01-04 Mon … 2021-01-08 Fri: 5 weekdays, 5 calendar days.
  const bookings: Bookings = {
    m1: { '2021-01-04': bk('anna'), '2021-01-05': bk('Anna'), '2021-01-06': bk('bob') },
    m2: { '2021-01-04': bk('anna') },
  };
  const stats = computeStats([m1, m2], bookings, '2021-01-04', '2021-01-08');

  it('counts weekdays in the range as the utilisation denominator', () => {
    expect(stats.days).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
      '2021-01-07',
      '2021-01-08',
    ]);
  });

  it('builds per-machine rows with counts, percent, and a person breakdown', () => {
    const r1 = stats.machRows.find((r) => r.m.id === 'm1')!;
    expect(r1.n).toBe(3);
    expect(r1.pct).toBe(60); // 3 of 5 weekdays
    expect(r1.persons.get('anna')).toEqual({ name: 'Anna', days: 2 }); // case-folded key, kept display name
    expect(r1.persons.get('bob')).toEqual({ name: 'bob', days: 1 });
    const r2 = stats.machRows.find((r) => r.m.id === 'm2')!;
    expect(r2.n).toBe(1);
    expect(r2.pct).toBe(20);
  });

  it('indexes people across machines with a per-machine day breakdown', () => {
    const anna = stats.persons.get('anna')!;
    expect(anna.days).toBe(3); // 2 on M1 + 1 on M2
    expect(Object.fromEntries(anna.machines)).toEqual({ M1: 2, M2: 1 });
    const bob = stats.persons.get('bob')!;
    expect(bob.days).toBe(1);
    expect(Object.fromEntries(bob.machines)).toEqual({ M1: 1 });
  });

  it('tallies maintenance: intersecting slots (inst) and blocked calendar days', () => {
    expect(stats.maint.inst).toBe(1);
    expect(stats.maint.days).toBe(2); // 2021-01-05 and -06 blocked
    expect(stats.maint.rows).toEqual([{ m: m1, inst: 1, days: 2 }]); // m2 omitted (no maint, no block)
  });

  it('yields zero percent when the range has no weekdays', () => {
    const s = computeStats([m1], { m1: { '2021-01-09': bk('anna') } }, '2021-01-09', '2021-01-09');
    expect(s.days).toEqual([]); // Saturday only
    expect(s.machRows[0]!.n).toBe(0);
    expect(s.machRows[0]!.pct).toBe(0);
  });

  it('is empty when there are no machines', () => {
    const s = computeStats([], {}, '2021-01-04', '2021-01-08');
    expect(s.machRows).toEqual([]);
    expect(s.persons.size).toBe(0);
    expect(s.maint.rows).toEqual([]);
  });

  it('handles a machine with no bookings entry at all', () => {
    // m2 has no key in `bookings` → the `|| {}` fallback; no maint either → omitted from maint rows.
    const s = computeStats([m2], {}, '2021-01-04', '2021-01-08');
    expect(s.machRows[0]!.n).toBe(0);
    expect(s.machRows[0]!.persons.size).toBe(0);
    expect(s.persons.size).toBe(0);
    expect(s.maint.rows).toEqual([]);
  });
});

describe('buildResourceRows', () => {
  const noFilter = {
    filterQuery: '',
    visibleCategories: new Set(['maschine', 'messtechnik']),
    closedKeys: new Set<string>(),
  };

  const row = (
    overrides: Partial<StatsMachineRow['m']> & { pct?: number; n?: number } = {},
  ): StatsMachineRow => {
    const { pct = 0, n = 0, ...machineOverrides } = overrides;
    return {
      m: { id: 'm1', name: 'M1', group: 'Halle', ...machineOverrides },
      n,
      pct,
      persons: new Map(),
    };
  };

  it('skips the category header when only one category has matching rows', () => {
    const rows = buildResourceRows([row({ id: 'm1' })], noFilter);
    expect(rows.map((r) => r.kind)).toEqual(['group', 'machine']);
  });

  it('shows a category header per category once more than one is present', () => {
    const rows = buildResourceRows(
      [row({ id: 'm1' }), row({ id: 'm2', cat: 'messtechnik' })],
      noFilter,
    );
    expect(rows.map((r) => r.kind)).toEqual([
      'category',
      'group',
      'machine',
      'category',
      'group',
      'machine',
    ]);
  });

  it("a category's average covers every row in it, even ones in a folded group", () => {
    const rows = buildResourceRows(
      [
        row({ id: 'm1', group: 'A', pct: 100 }),
        row({ id: 'm2', group: 'B', pct: 0, cat: 'messtechnik' }),
        row({ id: 'm3', group: 'B', pct: 0, cat: 'messtechnik' }),
      ],
      { ...noFilter, closedKeys: new Set(['g:B']) },
    );
    const messtechnikCategory = rows.find(
      (r) => r.kind === 'category' && r.category === 'messtechnik',
    );
    expect(messtechnikCategory).toMatchObject({ averagePercent: 0 }); // both B rows count, despite being folded
    const groupB = rows.find((r) => r.kind === 'group' && r.group === 'B');
    expect(groupB).toMatchObject({ collapsed: true });
    expect(rows.filter((r) => r.kind === 'machine' && r.row.m.group === 'B')).toEqual([]); // rows hidden
  });

  it('folding a category hides its group headers and rows too, not just the category', () => {
    const rows = buildResourceRows([row({ id: 'm1' }), row({ id: 'm2', cat: 'messtechnik' })], {
      ...noFilter,
      closedKeys: new Set(['c:maschine']),
    });
    expect(rows.map((r) => r.kind)).toEqual(['category', 'category', 'group', 'machine']);
  });

  it('sorts machines within a group by percent descending, then by German name order', () => {
    const rows = buildResourceRows(
      [row({ id: 'm1', name: 'Beta', pct: 50 }), row({ id: 'm2', name: 'Alpha', pct: 80 })],
      noFilter,
    );
    const names = rows.filter((r) => r.kind === 'machine').map((r) => r.row.m.name);
    expect(names).toEqual(['Alpha', 'Beta']);
  });

  it('filters by machine name and by which categories are toggled visible', () => {
    const rows = buildResourceRows(
      [row({ id: 'm1', name: 'Fräse' }), row({ id: 'm2', name: 'Presse' })],
      {
        ...noFilter,
        filterQuery: 'frä',
      },
    );
    expect(rows.filter((r) => r.kind === 'machine')).toHaveLength(1);

    const hiddenCategory = buildResourceRows([row({ id: 'm1', cat: 'messtechnik' })], {
      ...noFilter,
      visibleCategories: new Set(['maschine']),
    });
    expect(hiddenCategory).toEqual([]);
  });
});

describe('buildMaintRows', () => {
  // `blockedDays`/`instances` (not `days`/`inst`) to avoid colliding with `Machine`'s own
  // `days` field (the weekday-availability mask) when intersected below.
  const maintRow = (
    overrides: Partial<StatsMaintRow['m']> & { instances?: number; blockedDays?: number } = {},
  ): StatsMaintRow => {
    const { instances = 0, blockedDays = 0, ...machineOverrides } = overrides;
    return {
      m: { id: 'm1', name: 'M1', group: 'Halle', ...machineOverrides },
      inst: instances,
      days: blockedDays,
    };
  };

  it('sorts by blocked days descending, then instance count, then German name order', () => {
    const rows = buildMaintRows(
      [
        maintRow({ id: 'a', name: 'Beta', blockedDays: 2, instances: 1 }),
        maintRow({ id: 'b', name: 'Alpha', blockedDays: 5, instances: 1 }),
        maintRow({ id: 'c', name: 'Gamma', blockedDays: 2, instances: 3 }),
      ],
      '',
    );
    expect(rows.map((r) => r.m.name)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  it('filters by machine name, case-insensitively', () => {
    const rows = buildMaintRows(
      [maintRow({ id: 'a', name: 'Fräse' }), maintRow({ id: 'b', name: 'Presse' })],
      'FRÄ',
    );
    expect(rows.map((r) => r.m.name)).toEqual(['Fräse']);
  });
});

describe('buildPersonRows', () => {
  const person = (name: string, days: number): StatsPerson => ({ name, days, machines: new Map() });

  it('sorts by booked days descending, then German name order', () => {
    const persons = new Map([
      ['bob', person('Bob', 3)],
      ['anna', person('Anna', 5)],
      ['carl', person('Carl', 3)],
    ]);
    const rows = buildPersonRows(persons, '');
    expect(rows.map((p) => p.name)).toEqual(['Anna', 'Bob', 'Carl']);
  });

  it('filters by name, case-insensitively', () => {
    const persons = new Map([
      ['anna', person('Anna', 1)],
      ['bob', person('Bob', 1)],
    ]);
    const rows = buildPersonRows(persons, 'AN');
    expect(rows.map((p) => p.name)).toEqual(['Anna']);
  });
});
