// =======================================================================================
// BOOKING DETAIL MODAL COMPONENT (web/js/ui/components/BookingDetailModal.tsx)
// =======================================================================================
//
// Shows one booked cell's details, plus two different "delete more than this one day"
// affordances: a contiguous same-name workday run (no explicit group), and an explicit
// booking group (several machines and/or a titled multi-cell action).
//
// Key Principles:
// - MUTUALLY EXCLUSIVE DELETE AFFORDANCES: a booking is never both grouped and a plain run
//   at once in this UI — a grouped booking's cells don't also form a plain run, so exactly
//   one of the two delete-more buttons ever shows, never both.
//
// =======================================================================================

import type { Booking, Machine } from '../../../../shared/types.ts';
import {
  formatDateLong,
  formatTimestamp,
  isWeekend,
  parseIsoDateString,
} from '../../../../shared/dates.ts';
import { deleteCells, deleteGroup } from '../../core/bookings.ts';
import {
  findSameNameWorkdayRun,
  findBookingGroup,
  type BookingGroup,
} from '../../core/bookings.ts';
import {
  isMachineAvailableOnWeekday,
  isMachineBlockedOnDate,
  getMaintenanceSlotAtDate,
} from '../../core/machines.ts';
import { daysMaskText, maintText } from '../machine-text.ts';
import { escapeHtml } from '../escape-html.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { toast, offerUndo } from '../toast.ts';
import { Icon } from './Icon.tsx';
import { openBookingForm } from './BookingForm.tsx';
import { store } from '../../store-instance.ts';
import { machById } from '../machine-lookup.ts';
import { openStats } from './StatsModal.tsx';

async function deleteDates(
  machine: Machine,
  booking: Booking,
  dates: readonly string[],
): Promise<void> {
  closeReactModal(); // close immediately — the delete runs in the background, result as a toast
  const result = await window.mutate(
    (fresh) => deleteCells(fresh, machine.id, booking.name, dates),
    `Gelöscht: ${booking.name} auf ${machine.name}, ${dates.length} Tag(e)`,
  );
  if (result && !result.abort)
    offerUndo(`${result.deletedCount} Buchung(en) gelöscht.`, result.undo, 'Löschen');
}

interface RunDeleteButtonProps {
  machine: Machine;
  booking: Booking;
  run: readonly string[];
}

function RunDeleteButton({ machine, booking, run }: RunDeleteButtonProps) {
  async function handleClick(): Promise<void> {
    const confirmed = await window.askConfirm({
      title: 'Ganze Serie löschen?',
      body: `<b>${escapeHtml(booking.name)}</b> auf <b>${escapeHtml(machine.name)}</b><br>${escapeHtml(formatDateLong(run[0]!))} – ${escapeHtml(formatDateLong(run[run.length - 1]!))} (${run.length} Werktage)`,
      yes: `${run.length} Tage löschen`,
    });
    if (confirmed) await deleteDates(machine, booking, run);
  }
  return (
    <button className="btn dangerfill" onClick={handleClick}>
      Ganze Serie löschen
    </button>
  );
}

interface GroupDeleteButtonProps {
  booking: Booking;
  groupTitle: string;
  machineCount: number;
  workdayCount: number;
  firstDate: string;
  lastDate: string;
}

function GroupDeleteButton({
  booking,
  groupTitle,
  machineCount,
  workdayCount,
  firstDate,
  lastDate,
}: GroupDeleteButtonProps) {
  async function handleClick(): Promise<void> {
    const confirmed = await window.askConfirm({
      title: 'Ganze Buchungsgruppe löschen?',
      body: `<b>${escapeHtml(groupTitle || 'Buchung')}</b> von <b>${escapeHtml(booking.name)}</b><br>${machineCount} Maschine${machineCount === 1 ? '' : 'n'}, ${workdayCount} Werktag${workdayCount === 1 ? '' : 'e'}: ${escapeHtml(formatDateLong(firstDate))} – ${escapeHtml(formatDateLong(lastDate))}`,
      yes: 'Buchungsgruppe löschen',
    });
    if (!confirmed) return;
    closeReactModal();
    const result = await window.mutate(
      (fresh) => deleteGroup(fresh, booking.gid!),
      `Gruppe gelöscht: ${groupTitle || booking.gid} (${booking.name})`,
    );
    if (result && !result.abort) {
      offerUndo(`Buchungsgruppe gelöscht (${result.deletedCount} Tag(e)).`, result.undo, 'Löschen');
    }
  }
  return (
    <button className="btn dangerfill" onClick={handleClick}>
      Ganze Buchungsgruppe löschen
    </button>
  );
}

interface BookingFactsProps {
  machine: Machine;
  date: string;
  booking: Booking;
}

/** The read-only fact rows: machine (+ the Statistik shortcut, now a small icon right next to
 *  the name instead of its own labeled button), date, who booked it, and the optional
 *  note/entered-at rows. A CSS grid (`.bkdetail-facts`), not the shared `.formrow` flex row —
 *  `.formrow label`'s fixed min-width left a wide gap after short labels like "Datum"; a grid
 *  sized to the longest label tightens that up (user request) without affecting every other
 *  modal's own `.formrow` rows. */
function BookingFacts({ machine, date, booking }: BookingFactsProps) {
  return (
    <div className="bkdetail-facts">
      <label>Maschine</label>
      <div>
        {machine.name}{' '}
        <button
          className="iconbtn small"
          title={`Personenstatistik von ${booking.name} öffnen`}
          aria-label="Statistik"
          onClick={() => openStats(booking.name.toLowerCase())}
        >
          <Icon name="chart" />
        </button>
      </div>
      <label>Datum</label>
      <div>{formatDateLong(date)}</div>
      <label>Gebucht von</label>
      {/* No bold here (user request) — keeps a consistent visual weight across every fact
          value instead of singling this one out. */}
      <div>{booking.name}</div>
      {booking.note && (
        <>
          <label>Notiz</label>
          <div>{booking.note}</div>
        </>
      )}
      {booking.ts && (
        <>
          <label>Eingetragen</label>
          <div className="hint" style={{ margin: 0 }}>
            {formatTimestamp(booking.ts)}
          </div>
        </>
      )}
    </div>
  );
}

interface SeriesOrGroupHintProps {
  booking: Booking;
  run: readonly string[];
  group: BookingGroup | null;
  groupWorkdays: readonly string[];
}

/** Which "this is part of something bigger" hint to show, if any — a booking group (across
 *  possibly several machines) takes priority over a same-machine run, and a booking is never
 *  both (a grouped booking's cells don't also form a plain run in this UI). */
function SeriesOrGroupHint({ booking, run, group, groupWorkdays }: SeriesOrGroupHintProps) {
  if (group) {
    return (
      <p className="hint">
        <Icon name="folder" /> Teil einer Buchungsgruppe
        {booking.gtitle ? (
          <>
            : <b>{booking.gtitle}</b>
          </>
        ) : null}{' '}
        — {group.machineIds.size} Maschine{group.machineIds.size === 1 ? '' : 'n'},{' '}
        {groupWorkdays.length} Werktag{groupWorkdays.length === 1 ? '' : 'e'} (
        {formatDateLong(group.dates[0]!)} – {formatDateLong(group.dates[group.dates.length - 1]!)})
      </p>
    );
  }
  if (run.length > 1) {
    return (
      <p className="hint">
        Diese Buchung ist Teil einer Serie: {formatDateLong(run[0]!)} –{' '}
        {formatDateLong(run[run.length - 1]!)} ({run.length} Werktage)
      </p>
    );
  }
  return null;
}

interface BookingDetailModalProps {
  machine: Machine;
  date: string;
  booking: Booking;
}

export function BookingDetailModal({ machine, date, booking }: BookingDetailModalProps) {
  const run = findSameNameWorkdayRun(store.get('data')!.bookings, machine.id, date, booking.name);
  const group = booking.gid ? findBookingGroup(store.get('data')!.bookings, booking.gid) : null;
  const groupWorkdays = group ? group.dates.filter((d) => !isWeekend(parseIsoDateString(d))) : [];

  // Title is the machine + date (user request), not the generic "Buchung" — immediate context
  // without having to read the fact rows below. "Schließen" moved to a top-right "×" icon (same
  // row as the title), freeing the bottom action row for just the two destructive actions.
  return (
    <>
      <div className="bkdetail-head">
        <h2>
          {machine.name} – {formatDateLong(date)}
        </h2>
        <button
          className="iconbtn"
          onClick={closeReactModal}
          aria-label="Schließen"
          title="Schließen"
        >
          <Icon name="close" />
        </button>
      </div>
      <BookingFacts machine={machine} date={date} booking={booking} />
      <SeriesOrGroupHint booking={booking} run={run} group={group} groupWorkdays={groupWorkdays} />
      {/* The two destructive actions sit at opposite ends, not packed together (user request:
          separate them to prevent a catastrophic accidental click) — the broader-scope one
          (a whole series/group) also gets the bolder filled-red treatment (.dangerfill) so it
          visibly outweighs "just this one day" (.danger, outline only), matching the actual
          difference in blast radius between the two. */}
      <div className="modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        {group ? (
          <GroupDeleteButton
            booking={booking}
            groupTitle={booking.gtitle ?? ''}
            machineCount={group.machineIds.size}
            workdayCount={groupWorkdays.length}
            firstDate={group.dates[0]!}
            lastDate={group.dates[group.dates.length - 1]!}
          />
        ) : (
          run.length > 1 && <RunDeleteButton machine={machine} booking={booking} run={run} />
        )}
        <button
          className="btn danger"
          style={{ marginLeft: 'auto' }}
          onClick={() => void deleteDates(machine, booking, [date])}
        >
          Diesen Tag löschen
        </button>
      </div>
    </>
  );
}

/** Opens the booking detail modal for one booked cell. Not sticky — Escape/outside-click
 *  close it, like most modals. */
export function openBookingDetail(machine: Machine, date: string, booking: Booking): void {
  openReactModal(<BookingDetailModal machine={machine} date={date} booking={booking} />);
}

/** The cell action a click/Enter routes to: the booking detail when the cell is occupied,
 *  the booking form (single cell) otherwise — unless the machine is blocked or unavailable
 *  that day, in which case a toast just explains why instead of opening anything. */
export function openCellAction(machineId: string, date: string): void {
  const machine = machById(machineId);
  if (!machine) return;
  const booking = store.get('data')!.bookings[machineId]?.[date];
  if (isMachineBlockedOnDate(machine, date) && !booking) {
    toast(`${machine.name}: ${maintText(getMaintenanceSlotAtDate(machine, date))}`);
    return;
  }
  if (!isMachineAvailableOnWeekday(machine, date) && !booking) {
    toast(
      `${machine.name}: an diesem Wochentag nicht verfügbar (verfügbar: ${daysMaskText(machine)}).`,
    );
    return;
  }
  if (booking) openBookingDetail(machine, date, booking);
  else openBookingForm([machineId], date, date);
}
