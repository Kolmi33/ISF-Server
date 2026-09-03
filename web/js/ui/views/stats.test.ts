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

  // What: `stats.days` lists only the weekdays in the range (the utilisation denominator),
  // not every calendar day.
  // How: computes stats over a Mon-Fri range with no weekend inside it and checks all 5 days appear.
  it('counts weekdays in the range as the utilisation denominator', () => {
    expect(stats.days).toEqual([
      '2021-01-04',
      '2021-01-05',
      '2021-01-06',
      '2021-01-07',
      '2021-01-08',
    ]);
  });

  // What: each machine gets a row with its booked-workday count, the resulting utilisation
  // percent, and a per-person breakdown — the person map is keyed case-foldingly (so "Anna"
  // and "anna" tally together) but keeps whichever display-cased name was actually stored.
  // How: checks m1's row (booked by two case-variant "anna" entries plus one "bob" entry) has
  // the right count/percent and a merged 'anna' key with the correct display name, and m2's
  // simpler single-booking row.
  it('builds per-machine rows with counts, percent, and a person breakdown', () => {
    const r1 = stats.machRows.find((r) => r.machine.id === 'm1')!;
    expect(r1.bookedWorkdayCount).toBe(3);
    expect(r1.percent).toBe(60); // 3 of 5 weekdays
    expect(r1.persons.get('anna')).toEqual({ name: 'Anna', days: 2 }); // case-folded key, kept display name
    expect(r1.persons.get('bob')).toEqual({ name: 'bob', days: 1 });
    const r2 = stats.machRows.find((r) => r.machine.id === 'm2')!;
    expect(r2.bookedWorkdayCount).toBe(1);
    expect(r2.percent).toBe(20);
  });

  // What: the cross-machine `persons` map totals each person's days across ALL machines, plus
  // a breakdown of which machine contributed how many of those days.
  // How: checks anna's total (summed across both machines) and her per-machine breakdown, and
  // the same for bob (booked on only one machine).
  it('indexes people across machines with a per-machine day breakdown', () => {
    const anna = stats.persons.get('anna')!;
    expect(anna.days).toBe(3); // 2 on M1 + 1 on M2
    expect(Object.fromEntries(anna.machines)).toEqual({ M1: 2, M2: 1 });
    const bob = stats.persons.get('bob')!;
    expect(bob.days).toBe(1);
    expect(Object.fromEntries(bob.machines)).toEqual({ M1: 1 });
  });

  // What: maintenance tallies count both slot instances (slotCount) and the actual number of
  // CALENDAR days blocked (not weekdays — maintenance can span a weekend), and a machine with
  // no maintenance and no blocked days is omitted from the maintenance rows entirely.
  // How: gives m1 a 2-day slot within range and checks the aggregate slotCount/days plus that
  // only m1 (not the unaffected m2) appears in maint.rows.
  it('tallies maintenance: intersecting slots (slotCount) and blocked calendar days', () => {
    expect(stats.maint.slotCount).toBe(1);
    expect(stats.maint.days).toBe(2); // 2021-01-05 and -06 blocked
    expect(stats.maint.rows).toEqual([{ machine: m1, slotCount: 1, days: 2 }]); // m2 omitted (no maint, no block)
  });

  // What: a range that's entirely weekend has zero weekdays to divide by, so utilisation
  // correctly reports 0% rather than dividing by zero / producing NaN.
  // How: computes stats over a single Saturday-only range and checks days is empty and the
  // machine's count/percent are both 0.
  it('yields zero percent when the range has no weekdays', () => {
    const s = computeStats([m1], { m1: { '2021-01-09': bk('anna') } }, '2021-01-09', '2021-01-09');
    expect(s.days).toEqual([]); // Saturday only
    expect(s.machRows[0]!.bookedWorkdayCount).toBe(0);
    expect(s.machRows[0]!.percent).toBe(0);
  });

  // What: with no machines at all, every part of the result is empty.
  // How: computes stats with an empty machine list and checks machRows/persons/maint.rows all empty.
  it('is empty when there are no machines', () => {
    const s = computeStats([], {}, '2021-01-04', '2021-01-08');
    expect(s.machRows).toEqual([]);
    expect(s.persons.size).toBe(0);
    expect(s.maint.rows).toEqual([]);
  });

  // What: a machine with no key at all in the bookings map (not even an empty bucket) is
  // handled gracefully — treated the same as zero bookings, not an error.
  // How: computes stats for m2 against a completely empty bookings object and checks its
  // count/persons and the overall persons/maint results are all correctly empty.
  it('handles a machine with no bookings entry at all', () => {
    // m2 has no key in `bookings` → the `|| {}` fallback; no maint either → omitted from maint rows.
    const s = computeStats([m2], {}, '2021-01-04', '2021-01-08');
    expect(s.machRows[0]!.bookedWorkdayCount).toBe(0);
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
    overrides: Partial<StatsMachineRow['machine']> & {
      percent?: number;
      bookedWorkdayCount?: number;
    } = {},
  ): StatsMachineRow => {
    const { percent = 0, bookedWorkdayCount = 0, ...machineOverrides } = overrides;
    return {
      machine: { id: 'm1', name: 'M1', group: 'Halle', ...machineOverrides },
      bookedWorkdayCount,
      percent,
      persons: new Map(),
    };
  };

  // What: with only one category actually present in the matching rows, no category header
  // is shown at all — the list goes straight to group/machine rows (a header would be redundant).
  // How: builds rows from a single 'maschine' machine and checks the row kinds are just
  // ['group', 'machine'], no 'category'.
  it('skips the category header when only one category has matching rows', () => {
    const rows = buildResourceRows([row({ id: 'm1' })], noFilter);
    expect(rows.map((r) => r.kind)).toEqual(['group', 'machine']);
  });

  // What: once matching rows span more than one category, each category gets its own header.
  // How: builds rows from one machine per category and checks the row kinds show a
  // 'category' header before each category's own group/machine rows.
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

  // What: a category's average utilisation is computed over EVERY row in it, regardless of
  // whether some of its groups are currently folded (hidden from view) — folding is a display
  // concern, not something that should skew the average.
  // How: puts two 0%-utilisation machines in a folded group under 'messtechnik' and checks
  // the category's average still correctly reflects both of them (0%), while confirming the
  // folded group's own header is marked collapsed and its machine rows are actually hidden.
  it("a category's average covers every row in it, even ones in a folded group", () => {
    const rows = buildResourceRows(
      [
        row({ id: 'm1', group: 'A', percent: 100 }),
        row({ id: 'm2', group: 'B', percent: 0, cat: 'messtechnik' }),
        row({ id: 'm3', group: 'B', percent: 0, cat: 'messtechnik' }),
      ],
      { ...noFilter, closedKeys: new Set(['g:B']) },
    );
    const messtechnikCategory = rows.find(
      (r) => r.kind === 'category' && r.category === 'messtechnik',
    );
    expect(messtechnikCategory).toMatchObject({ averagePercent: 0 }); // both B rows count, despite being folded
    const groupB = rows.find((r) => r.kind === 'group' && r.group === 'B');
    expect(groupB).toMatchObject({ collapsed: true });
    expect(rows.filter((r) => r.kind === 'machine' && r.row.machine.group === 'B')).toEqual([]); // rows hidden
  });

  // What: folding a category collapses its own header AND hides every group header and
  // machine row beneath it — not just the category row itself staying visually collapsed.
  // How: folds the 'maschine' category (with a 'messtechnik' category also present) and
  // checks the row kinds show two category headers but only the OTHER category's group/machine rows.
  it('folding a category hides its group headers and rows too, not just the category', () => {
    const rows = buildResourceRows([row({ id: 'm1' }), row({ id: 'm2', cat: 'messtechnik' })], {
      ...noFilter,
      closedKeys: new Set(['c:maschine']),
    });
    expect(rows.map((r) => r.kind)).toEqual(['category', 'category', 'group', 'machine']);
  });

  // What: within a group, machines are ranked by utilisation percent descending (most-used
  // first), with German name order as the tiebreak.
  // How: builds two machines with different percents in scrambled order and checks the
  // higher-percent one comes first.
  it('sorts machines within a group by percent descending, then by German name order', () => {
    const rows = buildResourceRows(
      [row({ id: 'm1', name: 'Beta', percent: 50 }), row({ id: 'm2', name: 'Alpha', percent: 80 })],
      noFilter,
    );
    const names = rows.filter((r) => r.kind === 'machine').map((r) => r.row.machine.name);
    expect(names).toEqual(['Alpha', 'Beta']);
  });

  // What: a name filter narrows the machine rows to matches, and a category toggled off in
  // visibleCategories excludes its rows entirely (an empty result when that's the only row).
  // How: filters two machines down to one by name match, then separately checks a
  // messtechnik-only machine list with only 'maschine' marked visible yields nothing at all.
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
  // `blockedDays`/`instances` (not `days`/`slotCount`) to avoid colliding with `Machine`'s own
  // `days` field (the weekday-availability mask) when intersected below.
  const maintRow = (
    overrides: Partial<StatsMaintRow['machine']> & {
      instances?: number;
      blockedDays?: number;
    } = {},
  ): StatsMaintRow => {
    const { instances = 0, blockedDays = 0, ...machineOverrides } = overrides;
    return {
      machine: { id: 'm1', name: 'M1', group: 'Halle', ...machineOverrides },
      slotCount: instances,
      days: blockedDays,
    };
  };

  // What: maintenance rows sort primarily by blocked-day count descending, then by instance
  // count descending as a tiebreak, then German name order as the final tiebreak.
  // How: builds three rows where two tie on blocked-days (broken by instance count) and
  // checks the resulting name order matches that three-level sort.
  it('sorts by blocked days descending, then instance count, then German name order', () => {
    const rows = buildMaintRows(
      [
        maintRow({ id: 'a', name: 'Beta', blockedDays: 2, instances: 1 }),
        maintRow({ id: 'b', name: 'Alpha', blockedDays: 5, instances: 1 }),
        maintRow({ id: 'c', name: 'Gamma', blockedDays: 2, instances: 3 }),
      ],
      '',
    );
    expect(rows.map((r) => r.machine.name)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  // What: the maintenance list's own name filter matches case-insensitively.
  // How: filters a differently-cased query against two machines and checks only the matching one remains.
  it('filters by machine name, case-insensitively', () => {
    const rows = buildMaintRows(
      [maintRow({ id: 'a', name: 'Fräse' }), maintRow({ id: 'b', name: 'Presse' })],
      'FRÄ',
    );
    expect(rows.map((r) => r.machine.name)).toEqual(['Fräse']);
  });
});

describe('buildPersonRows', () => {
  const person = (name: string, days: number): StatsPerson => ({ name, days, machines: new Map() });

  // What: the Personen-mode overview sorts by booked days descending, with German name order
  // as the tiebreak for equal day counts.
  // How: builds three people, two of whom tie on day count, and checks the name order matches
  // that two-level sort.
  it('sorts by booked days descending, then German name order', () => {
    const persons = new Map([
      ['bob', person('Bob', 3)],
      ['anna', person('Anna', 5)],
      ['carl', person('Carl', 3)],
    ]);
    const rows = buildPersonRows(persons, '');
    expect(rows.map((p) => p.name)).toEqual(['Anna', 'Bob', 'Carl']);
  });

  // What: the Personen-mode filter matches names case-insensitively too.
  // How: filters with a differently-cased partial name and checks only the matching person remains.
  it('filters by name, case-insensitively', () => {
    const persons = new Map([
      ['anna', person('Anna', 1)],
      ['bob', person('Bob', 1)],
    ]);
    const rows = buildPersonRows(persons, 'AN');
    expect(rows.map((p) => p.name)).toEqual(['Anna']);
  });
});
