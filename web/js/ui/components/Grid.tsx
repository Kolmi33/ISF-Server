// The booking grid (Phase 7 slice B1). Faithful port of legacy `render()`.
//
// Legacy's mouse/keyboard/selection handlers (still unported, slice B2) are attached via
// event delegation on `#grid` and `document`, not on individual cells — so this component
// only needs to reproduce the exact DOM contract those handlers already depend on (classes,
// `data-mid`/`data-date`/`data-group`/`data-catgroup` attributes) for selection, jump-to-next-
// free and keyboard navigation to keep working completely unmodified.
//
// Store subscription: rather than adding a new subscription mechanism (and a circular import
// with app.ts, which owns the store), this component reuses the existing bridge — legacy's
// `render()` was the function the store already called on every change (`app.ts`'s
// `store.subscribe(() => { if (window.S.data) window.render(); })`). This module's own
// `render()` becomes the new `window.render`, so that wiring needs no change at all.
//
// The body rows (`GridBodyRow` and everything under it) live in `GridBody.tsx`, split out
// purely to stay under the file-length budget — conceptually this is one component.

import { Fragment, useEffect, useRef, useState } from 'react';
import {
  formatDateLong,
  formatDateShort,
  formatWeekdayName,
  getIsoWeekNumber,
  isWeekend,
  parseIsoDateString,
  todayAsIsoDateString,
} from '../../core/dates.ts';
import { buildGridRows, visibleWeeks, type GridRow } from '../grid.ts';
import { daysPerWeek } from '../grid-scroll.ts';
import { CATEGORIES } from '../../core/machines.ts';
import { categoryTap, categoryTapCancel, toggleAllGroupsInCategory } from '../category-fold.ts';
import { Icon } from './Icon.tsx';
import { GridBodyRow } from './GridBody.tsx';

function CategoryToggleButtons() {
  return (
    <div className="catseg" role="group" aria-label="Kategorien ein-/ausklappen">
      {CATEGORIES.map(({ id, label, icon }) => {
        const isOpen = window.S.cats.has(id);
        return (
          <button
            key={id}
            className={`catbtn ${isOpen ? 'on' : ''}`}
            data-cat={id}
            title={`${label} ${isOpen ? 'einklappen' : 'aufklappen'} · Doppelklick: alle Bereiche auf-/zuklappen`}
            aria-pressed={isOpen}
            onClick={(event) => {
              event.stopPropagation();
              categoryTap(id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              categoryTapCancel();
              toggleAllGroupsInCategory(id);
            }}
          >
            <Icon name={icon} /> <span className="lbl">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The header's two `<tr>`s (KW row + weekday/date row). Rendered inside `Grid`'s own
 *  `<thead ref={...}>` so `Grid` can measure the header's height after each commit. */
function GridHeaderRows({ weeks, columnsPerWeek }: { weeks: string[][]; columnsPerWeek: number }) {
  const today = todayAsIsoDateString();
  return (
    <>
      <tr role="row">
        <th className="machcol" rowSpan={2} role="columnheader">
          <CategoryToggleButtons />
          <span id="colResize" title="Spaltenbreite ziehen" />
        </th>
        {weeks.map((week, weekIndex) => (
          <Fragment key={week[0]}>
            {weekIndex > 0 && <th className="gap" rowSpan={2} aria-hidden="true" />}
            <th colSpan={columnsPerWeek} role="columnheader">
              KW {getIsoWeekNumber(parseIsoDateString(week[0]!))}
            </th>
          </Fragment>
        ))}
      </tr>
      <tr role="row">
        {weeks.flat().map((isoDate) => {
          const date = parseIsoDateString(isoDate);
          const classes = [isoDate === today ? 'today' : '', isWeekend(date) ? 'wknd' : ''];
          return (
            <th className={classes.join(' ')} role="columnheader" key={isoDate}>
              {formatWeekdayName(date)}
              <br />
              {formatDateShort(date)}
            </th>
          );
        })}
      </tr>
    </>
  );
}

/** Reference to the mounted grid's force-update function; see `Grid`'s effect. `window.render`
 *  (bridged below) calls through this instead of the module holding its own React root. */
const windowRenderTrigger: { current: (() => void) | null } = { current: null };

interface GridViewModel {
  today: string;
  weeks: string[][];
  columnsPerWeek: number;
  columnCount: number;
  dateLabels: ReadonlyMap<string, string>;
  rows: ReturnType<typeof buildGridRows>;
}

/**
 * Everything `Grid` needs to render, computed fresh from `window.S` (legacy's shared mutable
 * state). Also mutates `S.visM`/`S.visD` as a side effect — other still-legacy code (selection,
 * jump-to-next-free) reads those two fields to know what's currently on screen, exactly as it
 * did when `render()` set them the same way. Pulled out of `Grid` itself only to stay under the
 * function-length budget.
 */
function computeGridViewModel(): GridViewModel {
  const columnsPerWeek = daysPerWeek();
  const weekCount = window.S.weeks + window.S.extraWeeks;
  const weeks = visibleWeeks(window.S.startMonday, weekCount, columnsPerWeek);
  window.S.visD = weeks.flat();
  // Same text for every machine on a given date, so it's computed once here rather than once
  // per cell (faithful to `render()`'s own `dlbl` map, built once per pass and reused per row).
  const dateLabels = new Map(window.S.visD.map((isoDate) => [isoDate, formatDateLong(isoDate)]));

  const rows = buildGridRows(window.S.data!.machines, {
    selectedGroups: window.S.groupsSel,
    selectedMachineIds: window.S.machSel,
    openCategories: window.S.cats,
    collapsedGroups: window.S.collapsed,
    favoriteIds: window.S.favs,
  });
  window.S.visM = rows.filter((row) => row.kind === 'machine').map((row) => row.machine.id);

  return {
    today: todayAsIsoDateString(),
    weeks,
    columnsPerWeek,
    columnCount: weeks.length * columnsPerWeek + (weeks.length - 1), // day + gap columns
    dateLabels,
    rows,
  };
}

/**
 * The `key` for one body row. A machine row's own id is already unique across the whole grid;
 * a category/group header has no such identity of its own — the same group name can appear
 * twice (once per category it has a machine in), so those fall back to their position, which
 * is stable across re-renders since `buildGridRows` always rebuilds the same order from the
 * same data.
 */
function gridRowKey(row: GridRow, index: number): string {
  return row.kind === 'machine' ? row.machine.id : `row-${index}`;
}

/**
 * The booking grid. See `computeGridViewModel` for how it reads and updates `window.S`.
 */
export function Grid() {
  const [, forceRerender] = useState(0);
  const theadRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    windowRenderTrigger.current = () => forceRerender((tick) => tick + 1);
    return () => {
      windowRenderTrigger.current = null;
    };
  }, []);

  useEffect(() => {
    if (theadRef.current) {
      document.documentElement.style.setProperty(
        '--theadh',
        `${theadRef.current.offsetHeight || 47}px`,
      );
    }
    window.paintSel();
    window.syncJumpControls();
    requestAnimationFrame(window.ensureOverflow);
  });

  if (!window.S.data) return null; // faithful to the store-subscription guard in app.ts

  const { today, weeks, columnsPerWeek, columnCount, dateLabels, rows } = computeGridViewModel();

  return (
    <>
      <thead ref={theadRef}>
        <GridHeaderRows weeks={weeks} columnsPerWeek={columnsPerWeek} />
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <GridBodyRow
            row={row}
            columnCount={columnCount}
            weeks={weeks}
            today={today}
            dateLabels={dateLabels}
            key={gridRowKey(row, index)}
          />
        ))}
      </tbody>
    </>
  );
}

/** Bridged as `window.render` (Phase 7 slice B1) — re-renders the mounted grid. Faithful
 *  replacement for legacy's own `render()`, called by the same store subscription in app.ts. */
export function render(): void {
  windowRenderTrigger.current?.();
}
