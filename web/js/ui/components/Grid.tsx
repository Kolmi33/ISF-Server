// The booking grid (Phase 7 slice B1). Faithful port of legacy `render()`.
//
// Legacy's mouse/keyboard/selection handlers (still unported, slice B2) are attached via
// event delegation on `#grid` and `document`, not on individual cells — so this component
// only needs to reproduce the exact DOM contract those handlers already depend on (classes,
// `data-machine-id`/`data-date`/`data-group`/`data-catgroup` attributes) for selection, jump-to-next-
// free and keyboard navigation to keep working completely unmodified.
//
// Store subscription: rather than adding a new subscription mechanism, this component reuses
// the existing bridge — legacy's `render()` was the function the store already called on every
// change (`app.ts`'s `store.subscribe(() => { if (store.get('data')) triggerGridRender(); })`).
// The force-update trigger itself is registered with `grid-render-bridge.ts` (F8 cleanup,
// ARCHITECTURE_AUDIT.md) rather than held as a local ref bridged onto `window`: `grid-scroll.ts`
// and `grid-interaction.ts` both need to trigger a repaint too, and both already have an
// existing import edge FROM this component (`daysPerWeek`, `paintSelection`) — a direct import
// the other way would cycle, so the bridge module holds the mutable ref instead of either side.
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
} from '../../../../shared/dates.ts';
import { buildGridRows, visibleWeeks, type GridRow } from '../grid.ts';
import { daysPerWeek, syncJumpControls, ensureOverflow } from '../grid-scroll.ts';
import { CATEGORIES } from '../../core/machines-queries.ts';
import { categoryTap, categoryTapCancel, toggleAllGroupsInCategory } from '../category-fold.ts';
import { paintSelection } from '../grid-interaction.ts';
import { Icon } from './Icon.tsx';
import { GridBodyRow } from './GridBody.tsx';
import { store } from '../../store-instance.ts';
import { registerGridRenderTrigger, triggerGridRender } from '../grid-render-bridge.ts';

function CategoryToggleButtons() {
  return (
    <div className="catseg" role="group" aria-label="Kategorien ein-/ausklappen">
      {CATEGORIES.map(({ id, label, icon }) => {
        const isOpen = store.get('cats').has(id);
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

interface GridViewModel {
  today: string;
  weeks: string[][];
  columnsPerWeek: number;
  columnCount: number;
  dateLabels: ReadonlyMap<string, string>;
  rows: ReturnType<typeof buildGridRows>;
}

/**
 * Everything `Grid` needs to render, computed fresh from the store's state. Also mutates
 * `visM`/`visD` as a side effect — other code (selection, jump-to-next-free) reads those two
 * fields to know what's currently on screen, exactly as it did when `render()` set them the
 * same way. These are deliberately silent field writes (`store.state.x =`, not `store.set()`)
 * — they run synchronously during render, as a side effect for other code to read later, not
 * a change that should itself trigger another render (which would risk this very function
 * re-running via the store's subscription while already mid-render). Pulled out of `Grid`
 * itself only to stay under the function-length budget.
 */
function computeGridViewModel(): GridViewModel {
  const columnsPerWeek = daysPerWeek();
  const weekCount = store.get('weeks') + store.get('extraWeeks');
  const weeks = visibleWeeks(store.get('startMonday'), weekCount, columnsPerWeek);
  store.state.visD = weeks.flat();
  // Same text for every machine on a given date, so it's computed once here rather than once
  // per cell (faithful to `render()`'s own `dlbl` map, built once per pass and reused per row).
  const dateLabels = new Map(
    store.get('visD').map((isoDate) => [isoDate, formatDateLong(isoDate)]),
  );

  const rows = buildGridRows(store.get('data')!.machines, {
    selectedGroups: store.get('groupsSel'),
    selectedMachineIds: store.get('machSel'),
    openCategories: store.get('cats'),
    collapsedGroups: store.get('collapsed'),
    favoriteIds: store.get('favs'),
  });
  store.state.visM = rows.filter((row) => row.kind === 'machine').map((row) => row.machine.id);

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
 * The booking grid. See `computeGridViewModel` for how it reads and updates the store.
 */
export function Grid() {
  const [, forceRerender] = useState(0);
  const theadRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    registerGridRenderTrigger(() => forceRerender((tick) => tick + 1));
    return () => {
      registerGridRenderTrigger(null);
    };
  }, []);

  useEffect(() => {
    if (theadRef.current) {
      document.documentElement.style.setProperty(
        '--theadh',
        `${theadRef.current.offsetHeight || 47}px`,
      );
    }
    paintSelection();
    syncJumpControls();
    requestAnimationFrame(ensureOverflow);
  });

  if (!store.get('data')) return null; // faithful to the store-subscription guard in app.ts

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

/** Re-renders the mounted grid via `grid-render-bridge.ts`. Faithful replacement for legacy's
 *  own `render()`, called by the same store subscription in app.ts. Kept as a thin named
 *  export (rather than having every caller import the bridge module itself) so this stays the
 *  one place that names "the grid's own repaint" — existing imports/tests are unaffected. */
export function render(): void {
  triggerGridRender();
}
