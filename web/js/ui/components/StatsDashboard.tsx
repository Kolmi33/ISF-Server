// =======================================================================================
// STATS DASHBOARD COMPONENT (web/js/ui/components/StatsDashboard.tsx)
// =======================================================================================
//
// The Statistik tab's dashboard-style summary for the active category — a KPI tile row plus
// a card with a day-by-day booking chart and an aggregate used/maintenance/idle bar, shown
// above the existing grouped machine list (user request: revamp the whole tab to look like a
// reference card-based dashboard, "structure and maybe even colour profile"). Split out of
// `StatsModal.tsx`/`StatsOverviews.tsx` purely to stay under the file-length budget — this is
// new content, not a replacement for the existing overview/drilldown views, which keep their
// exact tested behavior (filter, fold, click-to-drill) unchanged underneath it.
//
// =======================================================================================

import { BarChart3, CalendarRange, Star, UserRound } from 'lucide-react';
import type { CategoryDashboard } from '../views/stats.ts';
import { Icon } from './Icon.tsx';
import { StatTile } from './app/StatTile.tsx';
import { StatCard, StackedStatBar } from './StatsDrilldown.tsx';

/** The four-tile KPI row: range length, aggregate utilisation, distinct active bookers, and
 *  the single most-utilised machine. Uses the same `StatTile` "Meine Buchungen" does, so a
 *  headline number reads identically wherever it appears. */
function StatKpiRow({ dashboard, totalDays }: { dashboard: CategoryDashboard; totalDays: number }) {
  return (
    <div className="stat-kpis flex shrink-0 flex-wrap gap-3">
      <StatTile
        value={String(totalDays)}
        label="Werktage"
        icon={<CalendarRange className="size-3.5 shrink-0" />}
      />
      <StatTile
        value={`${dashboard.usedPercent}%`}
        label="Ø Auslastung"
        icon={<BarChart3 className="size-3.5 shrink-0" />}
      />
      <StatTile
        value={String(dashboard.activePersonCount)}
        label="Aktive Personen"
        icon={<UserRound className="size-3.5 shrink-0" />}
      />
      <StatTile
        value={dashboard.topMachine ? `${dashboard.topMachine.percent}%` : '—'}
        icon={<Star className="size-3.5 shrink-0" />}
        // Combined into one string rather than showing the bare machine name as its own text
        // node — a name like "Fräse" also appears as its own row in the list below, and a
        // second exact-text match for it here would make that row ambiguous to find by name.
        label={dashboard.topMachine ? `Meistgenutzt: ${dashboard.topMachine.name}` : 'Meistgenutzt'}
      />
    </div>
  );
}

/** The day-by-day booking chart — one bar per bucket (`bucketDailyCounts`, already capped to a
 *  legible count regardless of range length), height relative to the busiest bucket. A native
 *  `title` tooltip carries the exact date/count per bar; a caption below names the chart's own
 *  first/last bucket so the range reads at a glance without a full axis. */
function StatChart({ dashboard }: { dashboard: CategoryDashboard }) {
  const { chart } = dashboard;
  if (!chart.length) return null;
  const maxCount = Math.max(1, ...chart.map((bucket) => bucket.count));
  return (
    <div>
      <div className="stat-chart flex h-20 items-end gap-[3px] px-0.5">
        {chart.map((bucket, index) => (
          <div
            key={index}
            className="stat-chart-bar min-w-1 flex-1 rounded-t-sm bg-[var(--stat-fill,var(--primary))] opacity-80 transition-opacity hover:opacity-100"
            title={`${bucket.label}: ${bucket.count} Buchung${bucket.count === 1 ? '' : 'en'}`}
            style={{ height: `${Math.max(4, Math.round((bucket.count / maxCount) * 100))}%` }}
          />
        ))}
      </div>
      <div className="stat-chart-caption mt-1 flex justify-between px-0.5 text-[11px] tabular-nums text-muted-foreground">
        <span>{chart[0]!.label}</span>
        <span>{chart[chart.length - 1]!.label}</span>
      </div>
    </div>
  );
}

/** The aggregate used/maintenance/idle bar (a bigger sibling of `StackedStatBar`'s per-row use
 *  in `StatsDrilldown.tsx`, which sizes one machine row's own share — this one sizes the whole
 *  category) plus a legend row naming each segment and its percentage, mirroring the reference
 *  dashboard's segmented-bar-with-legend cards. */
function StatUtilizationBar({ dashboard }: { dashboard: CategoryDashboard }) {
  const idlePercent = Math.max(0, 100 - dashboard.usedPercent - dashboard.blockedPercent);
  return (
    <div>
      <div className="flex">
        <StackedStatBar
          big
          usedPercent={dashboard.usedPercent}
          blockedPercent={dashboard.blockedPercent}
        />
      </div>
      <div className="stat-legend mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        <span className="stat-legend-item flex items-center gap-1.5">
          <span className="stat-legend-dot seg-used size-2 rounded-full bg-[var(--stat-fill,var(--primary))]" />{' '}
          Verwendet {dashboard.usedPercent}%
        </span>
        <span className="stat-legend-item flex items-center gap-1.5">
          <span className="stat-legend-dot seg-maint size-2 rounded-full bg-[var(--warn)]" />{' '}
          Wartung {dashboard.blockedPercent}%
        </span>
        <span className="stat-legend-item flex items-center gap-1.5">
          <span className="stat-legend-dot seg-idle size-2 rounded-full bg-border" /> Frei{' '}
          {idlePercent}%
        </span>
      </div>
    </div>
  );
}

interface CategoryDashboardCardProps {
  dashboard: CategoryDashboard;
  totalDays: number;
  categoryLabel: string;
  categoryIcon: string;
}

/** The whole dashboard section for the active category: KPI tiles, then a card holding the
 *  day-by-day chart and the aggregate utilisation bar. Wrapped by the caller in the same
 *  `stat-theme-<category>` class the overview/drilldown use, so `--stat-fill` (this category's
 *  own accent) colors the chart bars and the "used" segment consistently. */
export function CategoryDashboardCard({
  dashboard,
  totalDays,
  categoryLabel,
  categoryIcon,
}: CategoryDashboardCardProps) {
  return (
    <>
      <StatKpiRow dashboard={dashboard} totalDays={totalDays} />
      <StatCard className="shrink-0">
        <div className="stat-card-head flex items-center gap-2 text-sm">
          <span className="inline-flex text-[var(--stat-fill,var(--primary))] [&_svg]:size-4">
            <Icon name={categoryIcon} />
          </span>
          <b className="font-semibold text-foreground">{categoryLabel}</b>
        </div>
        <StatChart dashboard={dashboard} />
        <StatUtilizationBar dashboard={dashboard} />
      </StatCard>
    </>
  );
}
