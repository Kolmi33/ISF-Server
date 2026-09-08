// =======================================================================================
// GRID BODY COMPONENT (web/js/ui/components/GridBody.tsx)
// =======================================================================================
//
// The booking grid's body rows — split out of `Grid.tsx` purely to stay under the
// file-length budget; conceptually still one component, `Grid`'s direct child. See
// `Grid.tsx`'s header comment for the event-delegation/DOM-contract background every cell
// here has to honor.
//
// =======================================================================================

import { Fragment, type CSSProperties } from 'react';
import type { Booking, Machine } from '../../../../shared/types.ts';
import {
  isMachineAvailableOnWeekday,
  isMachineAvailableOnWeekdayIndex,
  hasAnyMaintenanceSlot,
  isMachineBlockedOnDate,
  getMaintenanceSlotAtDate,
} from '../../core/machines.ts';
import { getBooking } from '../../core/bookings.ts';
import { daysMaskText, maintText, statusRangeText } from '../machine-text.ts';
import {
  cellClass,
  classifyCell,
  classifyDot,
  isMine,
  maintenanceKindToday,
  mineAccentLayers,
  nameColor,
  type BookingBlockSegment,
  type GridRow,
} from '../grid.ts';
import { Icon } from './Icon.tsx';
import { store } from '../../store-instance.ts';
import { nextFreePtr, prevFreeBefore } from '../favorite-jump.ts';
import { isDarkTheme } from '../theme.ts';

const CATEGORY_LABELS: Record<string, string> = {
  maschine: 'Maschinen',
  messtechnik: 'Messtechnik',
};

/** The today-indicator dot (or maintenance icon) at the start of a machine's row. */
function TodayDot({ machine, today }: { machine: Machine; today: string }) {
  const booking = getBooking(store.get('data')!.bookings, machine.id, today);
  const slot = getMaintenanceSlotAtDate(machine, today);
  const state = classifyDot(
    slot?.type ?? null,
    booking,
    isMachineAvailableOnWeekday(machine, today),
  );

  if (state === 'defekt' || state === 'maint') {
    return (
      <span
        className={`statdot ${state === 'defekt' ? 'broken' : 'maint'}`}
        role="img"
        aria-label={`heute ${state === 'defekt' ? 'defekt' : 'in Wartung'}`}
        title={`heute gesperrt – ${maintText(slot)}`}
      >
        <Icon name="bolt" />
      </span>
    );
  }
  if (state === 'busy') {
    return (
      <span
        className="dot busy"
        role="img"
        aria-label={`heute belegt von ${booking!.name}`}
        title={`heute belegt: ${booking!.name}`}
      />
    );
  }
  if (state === 'unavail') {
    return (
      <span
        className="dot unavail"
        role="img"
        aria-label="heute nicht verfügbar"
        title={`an diesem Wochentag nicht verfügbar (verfügbar: ${daysMaskText(machine)})`}
      />
    );
  }
  return <span className="dot free" role="img" aria-label="heute frei" title="heute frei" />;
}

/** Builds the title tooltip for a booked cell: the booker's name, plus their note and/or
 *  the booking-group title when present. */
function bookedCellTitle(booking: Booking): string {
  let title = booking.name;
  if (booking.note) title += ' — ' + booking.note;
  if (booking.gtitle) title += ' — 📁 ' + booking.gtitle;
  return title;
}

interface CellAttrs {
  machine: Machine;
  isoDate: string;
  isToday: boolean;
  weekend: boolean;
  dateLabel: string;
}

/** One data cell: a machine × date intersection, already classified as blocked. */
function BlockedCell({ machine, isoDate, isToday, weekend, dateLabel }: CellAttrs) {
  const booking = getBooking(store.get('data')!.bookings, machine.id, isoDate);
  return (
    <td
      className={cellClass('blocked', { today: isToday, weekend })}
      role="gridcell"
      data-machine-id={machine.id}
      data-date={isoDate}
      aria-label={`${machine.name}, ${dateLabel}, gesperrt`}
      title={maintText(getMaintenanceSlotAtDate(machine, isoDate))}
    >
      {booking?.name ?? ''}
    </td>
  );
}

/** One data cell, already classified as booked (and not blocked). `segment` is this cell's
 *  position within its consolidated 2D booking block (`computeBookingBlocks`, computed once
 *  per render across the whole visible grid by `Grid.tsx`, not per row): a cell that
 *  continues into a neighbor (in any of the four directions) drops the border on that side so
 *  the two visually merge, and only the block's one "showName" cell — centered both across
 *  its days and across its machines — prints the booker's name; everywhere else in the same
 *  block stays just the shared background color. */
function BookedCell({
  machine,
  isoDate,
  isToday,
  weekend,
  dateLabel,
  segment,
}: CellAttrs & { segment: BookingBlockSegment }) {
  const booking = getBooking(store.get('data')!.bookings, machine.id, isoDate)!;
  const mine = isMine(store.get('user'), booking.name);
  // The "mine" accent is set here as inline style, not via a CSS class: only an element's own
  // inline style is guaranteed to win over every class-based rule, which a plain CSS-cascade
  // approach turned out not to be in practice (see app.css's comment on td.cell). `mine` is
  // still passed into cellClass below as a semantic marker (e.g. for non-visual/test hooks).
  const style: Record<string, string> = {
    backgroundColor: nameColor(booking.name, isDarkTheme()),
  };
  if (mine) Object.assign(style, mineAccentLayers(segment));
  return (
    <td
      className={`${cellClass('booked', {
        mine,
        today: isToday,
        weekend,
        mergeLeft: segment.continuesLeft,
        mergeRight: segment.continuesRight,
        mergeUp: segment.continuesUp,
        mergeDown: segment.continuesDown,
      })}${store.get('personOnly') && !mine ? ' dim' : ''}`}
      role="gridcell"
      data-machine-id={machine.id}
      data-date={isoDate}
      style={style as CSSProperties}
      aria-label={`${machine.name}, ${dateLabel}, belegt von ${booking.name}`}
      title={bookedCellTitle(booking)}
    >
      {segment.showName ? booking.name : ''}
    </td>
  );
}

/** One data cell: a machine × date intersection. `dateLabel` is this date's German
 *  long-form text for aria-labels, precomputed once per render (not per cell) since it's
 *  the same value for every machine on a given date. */
function GridCell({
  machine,
  isoDate,
  today,
  dateLabel,
  segment,
  weekdayIndex,
  weekend,
}: Omit<CellAttrs, 'isToday' | 'weekend'> & {
  today: string;
  segment: BookingBlockSegment;
  weekdayIndex: number;
  weekend: boolean;
}) {
  const isToday = isoDate === today;
  const booking = getBooking(store.get('data')!.bookings, machine.id, isoDate);
  const state = classifyCell(
    isMachineBlockedOnDate(machine, isoDate),
    booking,
    isMachineAvailableOnWeekdayIndex(machine, weekdayIndex),
  );
  const cellProps = { machine, isoDate, isToday, weekend, dateLabel };

  if (state === 'blocked') return <BlockedCell {...cellProps} />;
  if (state === 'booked') return <BookedCell {...cellProps} segment={segment} />;
  if (state === 'unavail') {
    return (
      <td
        className={cellClass('unavail', { today: isToday, weekend })}
        role="gridcell"
        data-machine-id={machine.id}
        data-date={isoDate}
        aria-label={`${machine.name}, ${dateLabel}, nicht verfügbar`}
        title={`an diesem Wochentag nicht verfügbar (verfügbar: ${daysMaskText(machine)})`}
      />
    );
  }
  return (
    <td
      className={cellClass('free', { today: isToday, weekend })}
      role="gridcell"
      data-machine-id={machine.id}
      data-date={isoDate}
      aria-label={`${machine.name}, ${dateLabel}, frei`}
    />
  );
}

/**
 * Whether the "jump back to a previous free day" button shows for `machine` today: only
 * once the user has jumped forward at least once (tracked per-machine in
 * `favorite-jump.ts`'s own `nextFreePtr`) and there is somewhere to go back to.
 */
function hasBackJumpButton(machine: Machine, today: string): boolean {
  const lastJumpedTo = nextFreePtr[machine.id];
  if (!lastJumpedTo) return false;
  return !!prevFreeBefore(machine, lastJumpedTo) || lastJumpedTo !== today;
}

/** The row-header's maintenance/defect status badge, shown only when a slot exists. */
function StatusTag({ machine, today }: { machine: Machine; today: string }) {
  if (!hasAnyMaintenanceSlot(machine)) return null;
  const kind = maintenanceKindToday(machine, today);
  return (
    <span className={`tag ${kind || 'wartung'}`} title={statusRangeText(machine)}>
      {kind === 'defekt' ? 'defekt' : kind ? 'Wartung' : 'Sperre geplant'}
    </span>
  );
}

/** The row-header's "jump to next/previous free day" buttons (back only once reachable). */
function JumpButtons({ machine, today }: { machine: Machine; today: string }) {
  return (
    <>
      {hasBackJumpButton(machine, today) && (
        <span
          className="nextfree back"
          data-nb={machine.id}
          role="button"
          aria-label="Eine freie Zelle zurück"
          title="Eine freie Zelle zurück (bis heute)"
        >
          <Icon name="prev" />
        </span>
      )}
      <span
        className="nextfree"
        data-nf={machine.id}
        role="button"
        aria-label={`Zum nächsten freien Termin von ${machine.name}`}
        title="Zum nächsten freien Termin springen (mehrfach drückbar)"
      >
        <Icon name="next" />
      </span>
    </>
  );
}

/** The row-header cell's title tooltip: machine, group, its info note and status range. */
function machineRowTitle(machine: Machine): string {
  let title = `${machine.name} (${machine.group})`;
  if (machine.info) title += ' — ' + machine.info;
  if (hasAnyMaintenanceSlot(machine)) title += ' — ' + statusRangeText(machine);
  return title;
}

/** The row-header cell's content: favorite star, today-dot, name, status tag, jump buttons. */
function MachineRowHeaderCell({ machine, today }: { machine: Machine; today: string }) {
  const isFavorite = store.get('favs').has(machine.id);
  return (
    <td
      className={`machcol ${hasBackJumpButton(machine, today) ? 'hasback' : ''}`}
      role="rowheader"
      title={machineRowTitle(machine)}
    >
      <span
        className={`favstar ${isFavorite ? 'fav' : ''}`}
        data-fav={machine.id}
        role="button"
        aria-label={isFavorite ? 'Favorit entfernen' : 'Als Favorit anheften'}
        title={isFavorite ? 'Favorit entfernen' : 'Als Favorit anheften'}
      >
        {isFavorite ? '★' : '☆'}
      </span>
      <TodayDot machine={machine} today={today} />
      {machine.name}
      {machine.info && (
        <>
          {' '}
          <span className="machinfo" title={machine.info}>
            <Icon name="info" />
          </span>
        </>
      )}{' '}
      <StatusTag machine={machine} today={today} />
      <JumpButtons machine={machine} today={today} />
    </td>
  );
}

function MachineRow({
  machine,
  weeks,
  today,
  dateLabels,
  bookingBlocks,
}: {
  machine: Machine;
  weeks: string[][];
  today: string;
  dateLabels: ReadonlyMap<string, string>;
  bookingBlocks: ReadonlyMap<string, BookingBlockSegment>;
}) {
  return (
    <tr role="row">
      <MachineRowHeaderCell machine={machine} today={today} />
      {weeks.map((week, weekIndex) => (
        <Fragment key={week[0]}>
          {weekIndex > 0 && <td className="gap" aria-hidden="true" />}
          {week.map((isoDate, weekdayIndex) => (
            <GridCell
              machine={machine}
              isoDate={isoDate}
              today={today}
              dateLabel={dateLabels.get(isoDate)!}
              segment={bookingBlocks.get(`${machine.id}|${isoDate}`)!}
              weekdayIndex={weekdayIndex}
              weekend={weekdayIndex >= 5}
              key={isoDate}
            />
          ))}
        </Fragment>
      ))}
    </tr>
  );
}

/** One row of the grid body: a category header, a group header, or a machine's data row —
 *  driven entirely by the pure `buildGridRows` (`ui/grid.ts`), which decides the row list
 *  and its order; this component just renders whichever kind of row it's handed.
 *  `bookingBlocks` is `Grid.tsx`'s one grid-wide computation (`computeBookingBlocks`) of every
 *  booked cell's position within its consolidated 2D block — passed straight through to
 *  whichever machine row needs it, since the vertical part of that merge needs every row's
 *  data at once and so can't be computed independently by each row on its own. */
export function GridBodyRow({
  row,
  columnCount,
  weeks,
  today,
  dateLabels,
  bookingBlocks,
}: {
  row: GridRow;
  columnCount: number;
  weeks: string[][];
  today: string;
  dateLabels: ReadonlyMap<string, string>;
  bookingBlocks: ReadonlyMap<string, BookingBlockSegment>;
}) {
  if (row.kind === 'category') {
    return (
      <tr
        className={`grouprow catrow ${row.collapsed ? 'collapsed' : ''}`}
        role="row"
        data-catgroup={row.category}
      >
        <td role="rowheader" aria-expanded={!row.collapsed}>
          <span className="arrow">▼</span> {CATEGORY_LABELS[row.category] ?? row.category}
        </td>
        <td colSpan={columnCount} style={{ background: 'var(--grpbg)' }} aria-hidden="true" />
      </tr>
    );
  }
  if (row.kind === 'group') {
    return (
      <tr
        className={`grouprow ${row.isFavoritesGroup ? 'catrow' : ''} ${row.collapsed ? 'collapsed' : ''}`}
        role="row"
        data-group={row.group}
      >
        <td role="rowheader" aria-expanded={!row.collapsed}>
          <span className="arrow">▼</span> {row.group}
          <span className="gcount">{row.machineCount}</span>
        </td>
        <td colSpan={columnCount} style={{ background: 'var(--grpbg)' }} aria-hidden="true" />
      </tr>
    );
  }
  return (
    <MachineRow
      machine={row.machine}
      weeks={weeks}
      today={today}
      dateLabels={dateLabels}
      bookingBlocks={bookingBlocks}
    />
  );
}
