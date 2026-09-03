// =======================================================================================
// STATS DRILLDOWN COMPONENT (web/js/ui/components/StatsDrilldown.tsx)
// =======================================================================================
//
// The stats modal's two drilldown views: one machine's booking breakdown by person, and
// one person's breakdown by machine. Split out of `StatsModal.tsx` purely to stay under
// the file-length budget — part of the same modal conceptually.
//
// =======================================================================================

import type { StatsMachineRow, StatsPerson } from '../views/stats.ts';
import { Icon } from './Icon.tsx';

/** The traffic-light utilisation band a percent falls into: under-used, healthy, or
 *  over-used. Thresholds per user request — under 60% is under-utilized, 60–85% is the
 *  healthy band, over 85% is over-utilized (worth watching for overbooking/burnout). */
function utilizationBand(percent: number): 'low' | 'mid' | 'high' {
  if (percent > 85) return 'high';
  if (percent >= 60) return 'mid';
  return 'low';
}

/**
 * A single result row's horizontal bar, sized to `percent` (0–100).
 *
 * `colorByUtilization` switches the fill from the plain accent color to the traffic-light
 * band above — only meaningful when `percent` IS a genuine 0–100 utilisation rate (a
 * machine's booked-workday share of the range). Most `StatBar` call sites instead pass a
 * percent *relative to the list's own top scorer* (e.g. a person's days as a fraction of the
 * busiest person's days) — traffic-light coloring there would be misleading (the busiest
 * entry always reads "over-utilized" red even at a genuinely low absolute rate), so those
 * callers leave this off and keep the neutral accent fill.
 */
export function StatBar({
  percent,
  colorByUtilization = false,
}: {
  percent: number;
  colorByUtilization?: boolean;
}) {
  return (
    <div className="statbar">
      <div
        className={colorByUtilization ? `util-${utilizationBand(percent)}` : undefined}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Drilldown for one machine: who booked it, most days first. */
export function MachineDrilldown({ row, totalDays }: { row: StatsMachineRow; totalDays: number }) {
  const people = [...row.persons.values()].sort((a, b) => b.days - a.days);
  const maxDays = people.length ? people[0]!.days : 1;
  return (
    <>
      <p className="hint">
        <b>{row.machine.name}</b> ({row.machine.group}) — belegt an <b>{row.bookedWorkdayCount}</b>{' '}
        von {totalDays} Werktagen ({row.percent}%)
      </p>
      <div className="statgrp">
        <Icon name="user" /> Am meisten belegt von
      </div>
      <div className="resultlist" style={{ maxHeight: 380 }}>
        {people.length ? (
          people.map((person) => (
            <div className="statrow" key={person.name}>
              <span className="nm">{person.name}</span>
              <StatBar percent={Math.round((person.days * 100) / maxDays)} />
              <span className="pct">
                {person.days} Tg ·{' '}
                {row.bookedWorkdayCount
                  ? Math.round((person.days * 100) / row.bookedWorkdayCount)
                  : 0}
                %
              </span>
            </div>
          ))
        ) : (
          <p className="hint">Keine Buchungen im Zeitraum.</p>
        )}
      </div>
    </>
  );
}

/** Drilldown for one person: which machines they use, most-used first. */
export function PersonDrilldown({ person }: { person: StatsPerson }) {
  const machineEntries = [...person.machines.entries()].sort((a, b) => b[1] - a[1]);
  const maxDays = machineEntries.length ? machineEntries[0]![1] : 1;
  return (
    <>
      <p className="hint">
        <b>{person.name}</b> — <b>{person.days}</b> gebuchte Maschinentage auf{' '}
        {person.machines.size} Maschine
        {person.machines.size === 1 ? '' : 'n'}
      </p>
      <div className="statgrp">
        <Icon name="factory" /> Meistgenutzte Maschinen
      </div>
      <div className="resultlist" style={{ maxHeight: 380 }}>
        {machineEntries.map(([machineName, days]) => (
          <div className="statrow" key={machineName}>
            <span className="nm" title={machineName}>
              {machineName}
            </span>
            <StatBar percent={Math.round((days * 100) / maxDays)} />
            <span className="pct">
              {days} Tg · {Math.round((days * 100) / person.days)}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
