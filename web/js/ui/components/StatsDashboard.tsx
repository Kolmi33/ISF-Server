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

import type { CategoryDashboard } from '../views/stats.ts';
import { Icon } from './Icon.tsx';

/** One KPI tile: a big bold value over a small muted label — the same "number-first" tile
 *  language `MyBookingsModal.tsx`'s own summary strip uses, kept as a separate (near-identical)
 *  set of classes here since the two features are otherwise unrelated. */
function StatKpi({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="stat-kpi">
      <Icon name={icon} />
      {/* min-width: 0 lets the label's own ellipsis (app.css) actually truncate instead of
          forcing the tile wider — real machine names run much longer than the "Fräse"-style
          fixtures, e.g. "1.003 - PC POOL 13 (Remote) (Simulation) SSD" as a "Meistgenutzt"
          label. `title` carries the untruncated text as a hover tooltip. */}
      <div style={{ minWidth: 0 }}>
        <div className="stat-kpi-value">{value}</div>
        <div className="stat-kpi-label" title={label}>
          {label}
        </div>
      </div>
    </div>
  );
}

/** The four-tile KPI row: range length, aggregate utilisation, distinct active bookers, and
 *  the single most-utilised machine. */
function StatKpiRow({ dashboard, totalDays }: { dashboard: CategoryDashboard; totalDays: number }) {
  return (
    <div className="stat-kpis">
      <StatKpi icon="cal" value={String(totalDays)} label="Werktage" />
      <StatKpi icon="chart" value={`${dashboard.usedPercent}%`} label="Ø Auslastung" />
      <StatKpi icon="user" value={String(dashboard.activePersonCount)} label="Aktive Personen" />
      <StatKpi
        icon="star"
        value={dashboard.topMachine ? `${dashboard.topMachine.percent}%` : '—'}
        label={
          // Combined into one string rather than showing the bare machine name as its own text
          // node — a name like "Fräse" also appears as its own row in the list below, and a
          // second exact-text match for it here would make that row ambiguous to find by name.
          dashboard.topMachine ? `Meistgenutzt: ${dashboard.topMachine.name}` : 'Meistgenutzt'
        }
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
      <div className="stat-chart">
        {chart.map((bucket, index) => (
          <div
            key={index}
            className="stat-chart-bar"
            title={`${bucket.label}: ${bucket.count} Buchung${bucket.count === 1 ? '' : 'en'}`}
            style={{ height: `${Math.max(4, Math.round((bucket.count / maxCount) * 100))}%` }}
          />
        ))}
      </div>
      <div className="hint stat-chart-caption">
        {chart[0]!.label} – {chart[chart.length - 1]!.label}
      </div>
    </div>
  );
}

/** The aggregate used/maintenance/idle bar (a bigger sibling of `StackedStatBar` in
 *  `StatsDrilldown.tsx`, which sizes one machine row's own share — this one sizes the whole
 *  category) plus a legend row naming each segment and its percentage, mirroring the reference
 *  dashboard's segmented-bar-with-legend cards. */
function StatUtilizationBar({ dashboard }: { dashboard: CategoryDashboard }) {
  const idlePercent = Math.max(0, 100 - dashboard.usedPercent - dashboard.blockedPercent);
  return (
    <div>
      <div className="statbar stacked stat-bar-big">
        <div className="seg-used" style={{ width: `${dashboard.usedPercent}%` }} />
        <div className="seg-maint" style={{ width: `${dashboard.blockedPercent}%` }} />
        <div className="seg-idle" style={{ width: `${idlePercent}%` }} />
      </div>
      <div className="stat-legend">
        <span className="stat-legend-item">
          <span className="stat-legend-dot seg-used" /> Verwendet {dashboard.usedPercent}%
        </span>
        <span className="stat-legend-item">
          <span className="stat-legend-dot seg-maint" /> Wartung {dashboard.blockedPercent}%
        </span>
        <span className="stat-legend-item">
          <span className="stat-legend-dot seg-idle" /> Frei {idlePercent}%
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

/** The whole dashboard section for the active category: KPI tiles, then a white card (the
 *  reference dashboard's own "widget" look) holding the day-by-day chart and the aggregate
 *  utilisation bar. Wrapped by the caller in the same `stat-theme-<category>` class the
 *  existing overview/drilldown already use, so `--stat-fill` (this category's own accent)
 *  colors the chart bars and the "used" segment consistently across old and new content alike. */
export function CategoryDashboardCard({
  dashboard,
  totalDays,
  categoryLabel,
  categoryIcon,
}: CategoryDashboardCardProps) {
  return (
    <>
      <StatKpiRow dashboard={dashboard} totalDays={totalDays} />
      <div className="stat-card">
        <div className="stat-card-head">
          <Icon name={categoryIcon} />
          <b>{categoryLabel}</b>
        </div>
        <StatChart dashboard={dashboard} />
        <StatUtilizationBar dashboard={dashboard} />
      </div>
    </>
  );
}
