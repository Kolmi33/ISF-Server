import { describe, it, expect } from 'vitest';
import type { Machine, Bookings } from '../../../../shared/types.ts';
import { computeStats, buildResourceRows, buildPersonRows, type StatsMachineRow } from './stats.ts';

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
  // Range 2021-01-04 Mon … 2021-01-08 Fri: 5 weekdays.
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

  // What: a machine's blocked-workday count (its maintenance share of the stacked utilisation
  // bar) only counts WORKDAYS that are blocked and not also booked — maintenance folded
  // directly into each row instead of a separate Wartung mode (user request).
  // How: computes stats with m1's maintenance days left unbooked (unlike the shared `stats`
  // fixture above, where m1 happens to be booked on both of them) and checks its
  // blockedWorkdayCount; m2 (no maintenance) stays at 0.
  it("tallies each row's own blocked (maintenance) workday count", () => {
    const s = computeStats(
      [m1, m2],
      { m1: { '2021-01-04': bk('anna') } },
      '2021-01-04',
      '2021-01-08',
    );
    const r1 = s.machRows.find((r) => r.machine.id === 'm1')!;
    expect(r1.blockedWorkdayCount).toBe(2); // 2021-01-05 and -06, neither booked here
    const r2 = s.machRows.find((r) => r.machine.id === 'm2')!;
    expect(r2.blockedWorkdayCount).toBe(0);
  });

  // What: a blocked day that's ALSO booked counts as booked, not blocked — matching the grid's
  // own "a real booking always wins" priority rule, and keeping the stacked bar's two shares
  // from double-counting the same day.
  // How: books m1 on both maintenance days too, and checks blockedWorkdayCount is 0 (both fully
  // absorbed into bookedWorkdayCount instead).
  it('counts a day that is both booked and blocked as booked, not blocked', () => {
    const s = computeStats(
      [m1],
      { m1: { '2021-01-05': bk('anna'), '2021-01-06': bk('anna') } },
      '2021-01-04',
      '2021-01-08',
    );
    expect(s.machRows[0]!.bookedWorkdayCount).toBe(2);
    expect(s.machRows[0]!.blockedWorkdayCount).toBe(0);
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
  // How: computes stats with an empty machine list and checks machRows/persons are both empty.
  it('is empty when there are no machines', () => {
    const s = computeStats([], {}, '2021-01-04', '2021-01-08');
    expect(s.machRows).toEqual([]);
    expect(s.persons.size).toBe(0);
  });

  // What: a machine with no key at all in the bookings map (not even an empty bucket) is
  // handled gracefully — treated the same as zero bookings, not an error.
  // How: computes stats for m2 against a completely empty bookings object and checks its
  // count/persons and the overall persons result are all correctly empty.
  it('handles a machine with no bookings entry at all', () => {
    // m2 has no key in `bookings` → the `|| {}` fallback.
    const s = computeStats([m2], {}, '2021-01-04', '2021-01-08');
    expect(s.machRows[0]!.bookedWorkdayCount).toBe(0);
    expect(s.machRows[0]!.persons.size).toBe(0);
    expect(s.persons.size).toBe(0);
  });
});

describe('buildResourceRows', () => {
  const noFilter = {
    filterQuery: '',
    activeCategory: 'maschine' as const,
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
      blockedWorkdayCount: 0,
      percent,
      persons: new Map(),
    };
  };

  // What: only the active category's machines appear — there's no category header/level at
  // all any more (the modal's own top-level tabs pick the category now, user request).
  // How: builds rows from one 'maschine' and one 'messtechnik' machine, active category
  // 'maschine', and checks only the maschine machine's group/row show up.
  it("includes only the active category's machines, with no category header level", () => {
    const rows = buildResourceRows(
      [row({ id: 'm1', name: 'Fräse' }), row({ id: 'm2', name: 'Messgerät', cat: 'messtechnik' })],
      noFilter,
    );
    expect(rows.map((r) => r.kind)).toEqual(['group', 'machine']);
    expect(rows.some((r) => r.kind === 'machine' && r.row.machine.name === 'Messgerät')).toBe(
      false,
    );
  });

  // What: switching the active category swaps which machines show, independently of anything
  // else (group fold state, filter query).
  // How: builds the same two-machine list once per category and checks each only shows its
  // own machine.
  it('switches which machines show when the active category changes', () => {
    const machines = [
      row({ id: 'm1', name: 'Fräse' }),
      row({ id: 'm2', name: 'Messgerät', cat: 'messtechnik' }),
    ];
    const maschineRows = buildResourceRows(machines, { ...noFilter, activeCategory: 'maschine' });
    expect(maschineRows.filter((r) => r.kind === 'machine').map((r) => r.row.machine.name)).toEqual(
      ['Fräse'],
    );
    const messtechnikRows = buildResourceRows(machines, {
      ...noFilter,
      activeCategory: 'messtechnik',
    });
    expect(
      messtechnikRows.filter((r) => r.kind === 'machine').map((r) => r.row.machine.name),
    ).toEqual(['Messgerät']);
  });

  // What: folding a group hides its machine rows but keeps the group header itself visible (so
  // it can be unfolded again), and a group's average utilisation covers every row in it
  // regardless of whether it's currently folded.
  // How: folds a two-machine group and checks both effects.
  it('folding a group hides its rows but keeps the header, average unaffected', () => {
    const rows = buildResourceRows(
      [row({ id: 'm1', group: 'A', percent: 100 }), row({ id: 'm2', group: 'A', percent: 0 })],
      { ...noFilter, closedKeys: new Set(['g:A']) },
    );
    expect(rows.map((r) => r.kind)).toEqual(['group']); // machine rows hidden
    expect(rows[0]).toMatchObject({ collapsed: true, averagePercent: 50 }); // both rows still count
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

  // What: a name filter narrows the machine rows to matches, case-insensitively.
  // How: filters two machines down to one by a lowercase substring of its name.
  it('filters by machine name, case-insensitively', () => {
    const rows = buildResourceRows(
      [row({ id: 'm1', name: 'Fräse' }), row({ id: 'm2', name: 'Presse' })],
      { ...noFilter, filterQuery: 'frä' },
    );
    expect(rows.filter((r) => r.kind === 'machine')).toHaveLength(1);
  });

  // What: with nothing matching the active category at all, the result is simply empty — no
  // stray group headers.
  // How: builds rows from a single messtechnik machine with 'maschine' active and checks the
  // result is empty.
  it('is empty when nothing matches the active category', () => {
    const rows = buildResourceRows([row({ id: 'm1', cat: 'messtechnik' })], noFilter);
    expect(rows).toEqual([]);
  });
});

describe('buildPersonRows', () => {
  const person = (name: string, days: number) => ({ name, days, machines: new Map() });

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
