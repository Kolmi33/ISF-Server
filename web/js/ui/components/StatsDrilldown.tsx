// The stats modal's two drilldown views (Phase 7 slice B5) — split out of StatsModal.tsx purely
// to stay under the file-length budget; part of the same modal conceptually. Faithful port of
// legacy `renderStats`'s `mode==='m' && selM` and `mode==='p' && selP` branches.

import type { StatsMachineRow, StatsPerson } from '../views/stats.ts';
import { Icon } from './Icon.tsx';

/** A single result row's horizontal bar, sized to `percent` (0–100). Faithful port of legacy
 *  `bar(p)`. */
export function StatBar({ percent }: { percent: number }) {
  return (
    <div className="statbar">
      <div style={{ width: `${percent}%` }} />
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
        <b>{row.m.name}</b> ({row.m.group}) — belegt an <b>{row.n}</b> von {totalDays} Werktagen (
        {row.pct}%)
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
                {person.days} Tg · {row.n ? Math.round((person.days * 100) / row.n) : 0}%
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
