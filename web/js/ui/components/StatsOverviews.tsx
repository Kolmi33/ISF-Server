// =======================================================================================
// STATS OVERVIEWS COMPONENT (web/js/ui/components/StatsOverviews.tsx)
// =======================================================================================
//
// The Statistik modal's three non-drilldown overview modes: Ressourcen (the
// category/group-folded machine list), Wartung (maintenance/downtime list), and Personen
// (person overview, row-click drills into `PersonDrilldown`). Split out of
// `StatsModal.tsx` purely to stay under the file-length budget.
//
// =======================================================================================

import { CATEGORIES } from '../../core/machines.ts';
import type { ResourceRow, StatsMaintRow, StatsPerson } from '../views/stats.ts';
import { StatBar } from './StatsDrilldown.tsx';

function categoryLabel(category: string): string {
  return CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

/** One `ResourceRow` as its `<div>` — a category header, a group header, or a machine row.
 *  Its own function so `ResourcesOverview`'s `.map` body stays a single call, not an inline
 *  multi-branch closure. */
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
  if (row.kind === 'category') {
    return (
      <div
        className={`statgrp cathead click ${row.collapsed ? 'closed' : ''}`}
        onClick={() => onToggleFold(`c:${row.category}`)}
      >
        <span className="arrow">▼</span> {categoryLabel(row.category)} · Ø {row.averagePercent}%
      </div>
    );
  }
  if (row.kind === 'group') {
    return (
      // `index` disambiguates the key: a group name can repeat across two categories, and
      // the fold state deliberately keys on the bare group name — see `stats.ts`'s
      // `buildResourceRows` comment for why.
      <div
        className={`statgrp click ${row.collapsed ? 'closed' : ''}`}
        onClick={() => onToggleFold(`g:${row.group}`)}
      >
        <span className="arrow">▼</span> {row.group} · Ø {row.averagePercent}%
      </div>
    );
  }
  return (
    <div
      className="statrow click"
      title={`Klicken: wer hat ${row.row.machine.name} belegt?`}
      onClick={() => onSelectMachine(row.row.machine.id)}
    >
      <span className="nm">{row.row.machine.name}</span>
      <StatBar percent={row.row.percent} />
      <span className="pct">
        {row.row.bookedWorkdayCount}/{totalDays} · {row.row.percent}%
      </span>
    </div>
  );
}

interface ResourcesOverviewProps {
  rows: readonly ResourceRow[];
  totalDays: number;
  onToggleFold: (key: string) => void;
  onSelectMachine: (machineId: string) => void;
}

/** The Ressourcen-mode overview: the category/group-folded machine list. */
export function ResourcesOverview({
  rows,
  totalDays,
  onToggleFold,
  onSelectMachine,
}: ResourcesOverviewProps) {
  return (
    <>
      <p className="hint">{totalDays} Werktage</p>
      <div className="resultlist" style={{ maxHeight: 400 }}>
        {rows.map((row, index) => (
          <ResourceRowView
            key={`${row.kind}:${row.kind === 'machine' ? row.row.machine.id : row.kind === 'category' ? row.category : row.group}:${index}`}
            row={row}
            totalDays={totalDays}
            onToggleFold={onToggleFold}
            onSelectMachine={onSelectMachine}
          />
        ))}
      </div>
    </>
  );
}

interface MaintenanceOverviewProps {
  rows: readonly StatsMaintRow[];
  totalInstances: number;
  totalDays: number;
}

/** The Wartung-mode overview: maintenance instance count + blocked days, per machine. */
export function MaintenanceOverview({ rows, totalInstances, totalDays }: MaintenanceOverviewProps) {
  const maxDays = rows.length ? Math.max(1, rows[0]!.days) : 1;
  return (
    <>
      <p className="hint">
        <b>{totalInstances}</b> Wartungs-/Ausfall-Instanz{totalInstances === 1 ? '' : 'en'} ·{' '}
        <b>{totalDays}</b> gesperrte Tage im Zeitraum
      </p>
      <div className="resultlist" style={{ maxHeight: 400 }}>
        {rows.length ? (
          rows.map((row) => (
            <div className="statrow" key={row.machine.id}>
              <span className="nm" title={row.machine.group}>
                {row.machine.name}
              </span>
              <StatBar percent={Math.round((row.days * 100) / maxDays)} />
              <span className="pct">
                {row.slotCount}× · {row.days} Tg
              </span>
            </div>
          ))
        ) : (
          <p className="hint">Keine Wartungs-/Ausfallzeiten im Zeitraum.</p>
        )}
      </div>
    </>
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
