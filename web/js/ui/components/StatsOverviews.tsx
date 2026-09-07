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

import { ChevronDown } from 'lucide-react';
import { cn } from 'cn';
import type { MachineCategory } from '../../../../shared/types.ts';
import type { ResourceRow, StatsPerson, CategoryDashboard } from '../views/stats.ts';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { StatBar, StackedStatBar, StatCard, StatRow } from './StatsDrilldown.tsx';
import { CategoryDashboardCard } from './StatsDashboard.tsx';
import { SECTION_LABEL_CLASS } from './app/typography.ts';

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
        className={cn(
          'statgrp click mt-2 flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 transition-colors first:mt-0 hover:bg-muted',
          row.collapsed && 'closed',
        )}
        onClick={() => onToggleFold(`g:${row.group}`)}
      >
        <ChevronDown
          className={cn(
            'arrow size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            row.collapsed && '-rotate-90',
          )}
        />
        <span className={SECTION_LABEL_CLASS}>
          {row.group} · Ø {row.averagePercent}%
        </span>
      </div>
    );
  }
  const usedPercent = row.row.percent;
  const blockedPercent = totalDays
    ? Math.round((row.row.blockedWorkdayCount * 100) / totalDays)
    : 0;
  return (
    <StatRow
      name={row.row.machine.name}
      title={`Klicken: wer hat ${row.row.machine.name} belegt?`}
      bar={<StackedStatBar usedPercent={usedPercent} blockedPercent={blockedPercent} />}
      figure={`${row.row.bookedWorkdayCount}/${totalDays} · ${usedPercent}%`}
      onClick={() => onSelectMachine(row.row.machine.id)}
    />
  );
}

interface ResourcesOverviewProps {
  rows: readonly ResourceRow[];
  totalDays: number;
  activeCategory: MachineCategory;
  dashboard: CategoryDashboard;
  categoryLabel: string;
  categoryIcon: string;
  onToggleFold: (key: string) => void;
  onSelectMachine: (machineId: string) => void;
}

/** The Ressourcen-mode overview: the dashboard-style KPI/chart card (user request: revamp the
 *  whole tab as a card-based dashboard) above the active category's own group-folded machine
 *  list, itself in a matching card. Both sit inside `stat-theme-<category>` (app.css) so every
 *  bar in this view — including the machine drilldown reached by clicking a row — picks up that
 *  category's own accent color (deep blue Maschinen, teal/slate Messtechnik — user request),
 *  via the `--stat-fill` custom property the bars read from. */
export function ResourcesOverview({
  rows,
  totalDays,
  activeCategory,
  dashboard,
  categoryLabel,
  categoryIcon,
  onToggleFold,
  onSelectMachine,
}: ResourcesOverviewProps) {
  return (
    <div className={`stat-theme-${activeCategory} flex min-h-0 flex-1 flex-col gap-3`}>
      <CategoryDashboardCard
        dashboard={dashboard}
        totalDays={totalDays}
        categoryLabel={categoryLabel}
        categoryIcon={categoryIcon}
      />
      <StatCard className="min-h-[16rem] flex-1">
        <div className="stat-card-head text-sm">
          <b className="font-semibold text-foreground">{categoryLabel} im Detail</b>
        </div>
        {/* Total day count now lives in the "Werktage" KPI tile above — repeating it here as
            its own hint line would just be redundant. */}
        <ScrollArea className="resultlist -mr-3 min-h-0 flex-1 pr-3">
          <div className="flex flex-col gap-0.5">
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
        </ScrollArea>
      </StatCard>
    </div>
  );
}

interface PersonsOverviewProps {
  persons: readonly StatsPerson[];
  onSelectPerson: (personKey: string) => void;
}

/** The Personen-mode overview: everyone with a booking in range, most days first; a row click
 *  drills into that person's machine breakdown. This mode has no visible tab of its own (only
 *  reachable via a booking's "Statistik" button), but still uses the same card as the rest. */
export function PersonsOverview({ persons, onSelectPerson }: PersonsOverviewProps) {
  const maxDays = persons.length ? persons[0]!.days : 1;
  return (
    <StatCard className="min-h-[16rem] flex-1">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {persons.length} Person{persons.length === 1 ? '' : 'en'} mit Buchungen im Zeitraum — Zeile
        anklicken für die Maschinen-Aufschlüsselung
      </p>
      <ScrollArea className="resultlist -mr-3 min-h-0 flex-1 pr-3">
        <div className="flex flex-col gap-0.5">
          {persons.map((person) => (
            <StatRow
              key={person.name}
              name={person.name}
              title={`Klicken: welche Maschinen nutzt ${person.name}?`}
              bar={<StatBar percent={Math.round((person.days * 100) / maxDays)} />}
              figure={`${person.days} Tg · ${person.machines.size} Masch.`}
              onClick={() => onSelectPerson(person.name.toLowerCase())}
            />
          ))}
        </div>
      </ScrollArea>
    </StatCard>
  );
}
