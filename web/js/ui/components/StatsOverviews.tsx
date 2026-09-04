// =======================================================================================
// STATS OVERVIEWS COMPONENT (web/js/ui/components/StatsOverviews.tsx)
// =======================================================================================
//
// The Statistik modal's two non-drilldown overview modes: Ressourcen (the group-folded
// machine list for the active category, each row a stacked used/maintenance/idle bar) and
// Personen (person overview, row-click drills into `PersonDrilldown`). Split out of
// `StatsModal.tsx` purely to stay under the file-length budget.
//
// =======================================================================================

import type { MachineCategory } from '../../../../shared/types.ts';
import type { ResourceRow, StatsPerson } from '../views/stats.ts';
import { StatBar, StackedStatBar } from './StatsDrilldown.tsx';

/** One `ResourceRow` as its `<div>` — a group header or a machine row. Its own function so
 *  `ResourcesOverview`'s `.map` body stays a single call, not an inline multi-branch closure. */
function ResourceRowView({
  row,
  totalDays,
  onToggleFold,
  onSelectMachine,
}: {
  row: ResourceRow;
  totalDays: number;
  onToggleFold: (key: string) => void;
  onSelectMachine: (machineId: string) => void;
}) {
  if (row.kind === 'group') {
    return (
      <div
        className={`statgrp click ${row.collapsed ? 'closed' : ''}`}
        onClick={() => onToggleFold(`g:${row.group}`)}
      >
        <span className="arrow">▼</span> {row.group} · Ø {row.averagePercent}%
      </div>
    );
  }
  const usedPercent = row.row.percent;
  const blockedPercent = totalDays
    ? Math.round((row.row.blockedWorkdayCount * 100) / totalDays)
    : 0;
  return (
    <div
      className="statrow click"
      title={`Klicken: wer hat ${row.row.machine.name} belegt?`}
      onClick={() => onSelectMachine(row.row.machine.id)}
    >
      <span className="nm">{row.row.machine.name}</span>
      <StackedStatBar usedPercent={usedPercent} blockedPercent={blockedPercent} />
      <span className="pct">
        {row.row.bookedWorkdayCount}/{totalDays} · {usedPercent}%
      </span>
    </div>
  );
}

interface ResourcesOverviewProps {
  rows: readonly ResourceRow[];
  totalDays: number;
  activeCategory: MachineCategory;
  onToggleFold: (key: string) => void;
  onSelectMachine: (machineId: string) => void;
}

/** The Ressourcen-mode overview: the active category's group-folded machine list. Wrapped in
 *  `stat-theme-<category>` (app.css) so every bar in this view — including the machine
 *  drilldown reached by clicking a row — picks up that category's own accent color (deep blue
 *  Maschinen, teal/slate Messtechnik — user request), via the `--stat-fill` custom property
 *  `StatBar`/`StackedStatBar` read from. */
export function ResourcesOverview({
  rows,
  totalDays,
  activeCategory,
  onToggleFold,
  onSelectMachine,
}: ResourcesOverviewProps) {
  return (
    <div className={`stat-theme-${activeCategory}`}>
      <p className="hint">{totalDays} Werktage</p>
      <div className="resultlist" style={{ maxHeight: 400 }}>
        {rows.map((row, index) => (
          <ResourceRowView
            key={`${row.kind}:${row.kind === 'machine' ? row.row.machine.id : row.group}:${index}`}
            row={row}
            totalDays={totalDays}
            onToggleFold={onToggleFold}
            onSelectMachine={onSelectMachine}
          />
        ))}
      </div>
    </div>
  );
}

interface PersonsOverviewProps {
  persons: readonly StatsPerson[];
  onSelectPerson: (personKey: string) => void;
}

/** The Personen-mode overview: everyone with a booking in range, most days first; a row click
 *  drills into that person's machine breakdown. */
export function PersonsOverview({ persons, onSelectPerson }: PersonsOverviewProps) {
  const maxDays = persons.length ? persons[0]!.days : 1;
  return (
    <>
      <p className="hint">
        {persons.length} Person{persons.length === 1 ? '' : 'en'} mit Buchungen im Zeitraum — Zeile
        anklicken für die Maschinen-Aufschlüsselung
      </p>
      <div className="resultlist" style={{ maxHeight: 400 }}>
        {persons.map((person) => (
          <div
            className="statrow click"
            key={person.name}
            title={`Klicken: welche Maschinen nutzt ${person.name}?`}
            onClick={() => onSelectPerson(person.name.toLowerCase())}
          >
            <span className="nm">{person.name}</span>
            <StatBar percent={Math.round((person.days * 100) / maxDays)} />
            <span className="pct">
              {person.days} Tg · {person.machines.size} Masch.
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
