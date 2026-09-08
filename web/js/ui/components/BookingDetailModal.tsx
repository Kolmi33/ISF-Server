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
// - BLAST RADIUS IS VISIBLE: the wider-scope delete is a filled destructive tint, the
//   single-day one is text-only, and they sit at opposite ends of the footer so the two can
//   never be confused for each other.
//
// =======================================================================================

import { useId } from 'react';
import { BarChart3, CalendarCheck, FolderOpen, X } from 'lucide-react';
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
import { openBookingForm } from './BookingForm.tsx';
import { store } from '../../store-instance.ts';
import { machById } from '../machine-lookup.ts';
import { openStats } from './StatsModal.tsx';
import { Button } from '../../components/ui/app-button.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { LABEL_CLASS } from './app/typography.ts';

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
    <Button variant="destructive" size="lg" onClick={handleClick}>
      Ganze Serie löschen
    </Button>
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
    <Button variant="destructive" size="lg" onClick={handleClick}>
      Ganze Buchungsgruppe löschen
    </Button>
  );
}

interface BookingFactsProps {
  machine: Machine;
  date: string;
  booking: Booking;
}

/** The read-only fact rows: machine (+ the Statistik shortcut, a small icon right next to the
 *  name instead of its own labeled button), date, who booked it, and the optional
 *  note/entered-at rows. A two-column grid sized to the longest label, so a short label like
 *  "Datum" leaves no gap before its value — each label's value is therefore its very next
 *  sibling element, which the placement test relies on. */
function BookingFacts({ machine, date, booking }: BookingFactsProps) {
  return (
    <dl className="bkdetail-facts grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-3">
      <dt className={LABEL_CLASS}>Maschine</dt>
      <dd className="flex items-center gap-1.5 text-sm text-foreground">
        {machine.name}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title={`Personenstatistik von ${booking.name} öffnen`}
          aria-label="Statistik"
          onClick={() => openStats(booking.name.toLowerCase())}
        >
          <BarChart3 className="size-4" />
        </Button>
      </dd>
      <dt className={LABEL_CLASS}>Datum</dt>
      <dd className="text-sm tabular-nums text-foreground">{formatDateLong(date)}</dd>
      <dt className={LABEL_CLASS}>Gebucht von</dt>
      {/* No bold here (user request) — keeps a consistent visual weight across every fact
          value instead of singling this one out. */}
      <dd className="text-sm text-foreground">{booking.name}</dd>
      {booking.note && (
        <>
          <dt className={LABEL_CLASS}>Notiz</dt>
          <dd className="text-sm text-foreground">{booking.note}</dd>
        </>
      )}
      {booking.ts && (
        <>
          <dt className={LABEL_CLASS}>Eingetragen</dt>
          <dd className="text-[11px] tabular-nums text-muted-foreground">
            {formatTimestamp(booking.ts)}
          </dd>
        </>
      )}
    </dl>
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
      <p className="flex flex-wrap items-center gap-1.5 rounded-xl border border-brand/30 bg-brand-soft px-3 py-2.5 text-[11px] leading-relaxed text-brand-foreground">
        <FolderOpen className="size-3.5 shrink-0" /> Teil einer Buchungsgruppe
        {booking.gtitle ? (
          <>
            : <b className="font-semibold">{booking.gtitle}</b>
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
      <p className="rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
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
  const titleId = useId();

  // Title is the machine + date (user request), not the generic "Buchung" — immediate context
  // without having to read the fact rows below.
  return (
    <AppDialog size="md" labelledBy={titleId}>
      <AppDialogHeader
        icon={<CalendarCheck className="size-6" />}
        title={`${machine.name} – ${formatDateLong(date)}`}
        titleId={titleId}
        subtitle={`Gebucht von ${booking.name}`}
        actions={
          <Button variant="ghost" size="icon" onClick={closeReactModal} aria-label="Schließen">
            <X className="size-4" />
          </Button>
        }
      />
      <AppDialogBody className="overflow-y-auto [scrollbar-gutter:stable]">
        <BookingFacts machine={machine} date={date} booking={booking} />
        <SeriesOrGroupHint
          booking={booking}
          run={run}
          group={group}
          groupWorkdays={groupWorkdays}
        />
      </AppDialogBody>
      {/* The two destructive actions sit at opposite ends, not packed together (user request:
          separate them to prevent a catastrophic accidental click) — the broader-scope one
          (a whole series/group) also gets the filled destructive tint so it visibly outweighs
          "just this one day" (text only), matching the difference in blast radius. */}
      <AppDialogFooter>
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
        <Button
          variant="ghost"
          size="lg"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={() => void deleteDates(machine, booking, [date])}
        >
          Diesen Tag löschen
        </Button>
      </AppDialogFooter>
    </AppDialog>
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
