// =======================================================================================
// STATS DRILLDOWN COMPONENT (web/js/ui/components/StatsDrilldown.tsx)
// =======================================================================================
//
// The stats modal's two drilldown views: one machine's booking breakdown by person, and
// one person's breakdown by machine. Split out of `StatsModal.tsx` purely to stay under
// the file-length budget — part of the same modal conceptually.
//
// Key Principles:
// - THE BARS QUOTE THE CATEGORY'S OWN COLOUR: `--stat-fill` is set by the surrounding
//   `stat-theme-<category>` class (app.css) — deep blue for Maschinen, teal for Messtechnik,
//   a deliberate data encoding, not this dialog's semantic palette. Custom properties survive
//   `ui-scope`'s `all: revert-layer`, so that still works inside the migrated dialog.
//
// =======================================================================================

import type { ReactNode } from 'react';
import { cn } from 'cn';
import { Factory, UserRound } from 'lucide-react';
import type { StatsMachineRow, StatsPerson } from '../views/stats.ts';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { SectionHeading } from './app/SectionHeading.tsx';
import { EmptyState } from './app/EmptyState.tsx';

/** The surface every stats view sits on — the same bordered sheet the Assistant's result
 *  cards use, so the whole dialog reads as one material. */
export function StatCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'stat-card flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** One list row: name, bar, and its own figure on the right. */
export function StatRow({
  name,
  title,
  bar,
  figure,
  onClick,
}: {
  name: string;
  title?: string;
  bar: ReactNode;
  figure: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className={`statrow flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors ${
        onClick ? 'click cursor-pointer hover:bg-muted' : ''
      }`}
      title={title}
      onClick={onClick}
    >
      <span className="nm w-[11rem] shrink-0 truncate text-sm text-foreground">{name}</span>
      {bar}
      <span className="pct w-[7.5rem] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {figure}
      </span>
    </div>
  );
}

/**
 * A single result row's horizontal bar, sized to `percent` (0–100) — a plain neutral fill
 * (the active category's own `--stat-fill` theme color when one's in scope, the dialog's own
 * primary otherwise). Used for every "share of the list's own top scorer" bar (a person's days
 * as a fraction of the busiest person's days, etc.) — the Ressourcen overview's own per-machine
 * row uses `StackedStatBar` below instead, since utilisation there breaks down into three
 * meaningfully different shares, not just one relative fraction.
 */
export function StatBar({ percent }: { percent: number }) {
  return (
    <div className="statbar h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-[var(--stat-fill,var(--primary))]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * The Ressourcen overview's own per-machine utilisation bar: three stacked, meaningfully
 * distinct segments — booked ("used"), blocked by maintenance, and idle — replacing a single
 * generic percent bar (user request: "a stacked bar chart, e.g. 60% Used, 10% Maintenance,
 * 30% Idle", since maintenance is a state of the resource, not a separate bookable category).
 * `usedPercent`/`blockedPercent` come straight from the row's own counts; idle is simply
 * whatever's left, clamped at 0 in case the two ever summed past 100 (shouldn't happen —
 * `stats.ts` already keeps booked and blocked mutually exclusive per day — but a rendering
 * bug here should never show a negative-width segment).
 */
export function StackedStatBar({
  usedPercent,
  blockedPercent,
  big = false,
}: {
  usedPercent: number;
  blockedPercent: number;
  /** The category-level aggregate bar, which sits alone and carries more weight. */
  big?: boolean;
}) {
  const idlePercent = Math.max(0, 100 - usedPercent - blockedPercent);
  return (
    <div
      className={`statbar stacked flex min-w-0 flex-1 overflow-hidden rounded-full bg-muted ${
        big ? 'stat-bar-big h-5' : 'h-3'
      }`}
    >
      <div
        className="seg-used h-full bg-[var(--stat-fill,var(--primary))]"
        style={{ width: `${usedPercent}%` }}
      />
      <div className="seg-maint h-full bg-[var(--warn)]" style={{ width: `${blockedPercent}%` }} />
      <div className="seg-idle h-full bg-transparent" style={{ width: `${idlePercent}%` }} />
    </div>
  );
}

/** Drilldown for one machine: who booked it, most days first. */
export function MachineDrilldown({ row, totalDays }: { row: StatsMachineRow; totalDays: number }) {
  const people = [...row.persons.values()].sort((a, b) => b.days - a.days);
  const maxDays = people.length ? people[0]!.days : 1;
  return (
    <StatCard className="flex-1">
      <p className="text-sm text-muted-foreground">
        <b className="font-semibold text-foreground">{row.machine.name}</b> ({row.machine.group}) —
        belegt an <b className="font-semibold text-foreground">{row.bookedWorkdayCount}</b> von{' '}
        {totalDays} Werktagen ({row.percent}%)
      </p>
      <SectionHeading
        className="statgrp"
        label={
          <span className="inline-flex items-center gap-1.5">
            <UserRound className="size-3.5" /> Am meisten belegt von
          </span>
        }
      />
      {people.length ? (
        <ScrollArea className="resultlist -mr-3 min-h-0 flex-1 pr-3">
          <div className="flex flex-col gap-0.5">
            {people.map((person) => (
              <StatRow
                key={person.name}
                name={person.name}
                bar={<StatBar percent={Math.round((person.days * 100) / maxDays)} />}
                figure={`${person.days} Tg · ${
                  row.bookedWorkdayCount
                    ? Math.round((person.days * 100) / row.bookedWorkdayCount)
                    : 0
                }%`}
              />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <EmptyState>Keine Buchungen im Zeitraum.</EmptyState>
      )}
    </StatCard>
  );
}

/** Drilldown for one person: which machines they use, most-used first. */
export function PersonDrilldown({ person }: { person: StatsPerson }) {
  const machineEntries = [...person.machines.entries()].sort((a, b) => b[1] - a[1]);
  const maxDays = machineEntries.length ? machineEntries[0]![1] : 1;
  return (
    <StatCard className="flex-1">
      <p className="text-sm text-muted-foreground">
        <b className="font-semibold text-foreground">{person.name}</b> —{' '}
        <b className="font-semibold text-foreground">{person.days}</b> gebuchte Maschinentage auf{' '}
        {person.machines.size} Maschine{person.machines.size === 1 ? '' : 'n'}
      </p>
      <SectionHeading
        className="statgrp"
        label={
          <span className="inline-flex items-center gap-1.5">
            <Factory className="size-3.5" /> Meistgenutzte Maschinen
          </span>
        }
      />
      <ScrollArea className="resultlist -mr-3 min-h-0 flex-1 pr-3">
        <div className="flex flex-col gap-0.5">
          {machineEntries.map(([machineName, days]) => (
            <StatRow
              key={machineName}
              name={machineName}
              title={machineName}
              bar={<StatBar percent={Math.round((days * 100) / maxDays)} />}
              figure={`${days} Tg · ${Math.round((days * 100) / person.days)}%`}
            />
          ))}
        </div>
      </ScrollArea>
    </StatCard>
  );
}
