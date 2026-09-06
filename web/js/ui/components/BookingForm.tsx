// =======================================================================================
// BOOKING FORM COMPONENT (web/js/ui/components/BookingForm.tsx)
// =======================================================================================
//
// The booking form: one form for 1..n machines, used identically by a single click, a
// range/rectangle selection, and the Assistant's "Buchen…" action.
//
// Key Principles:
// - THE SAME MODAL STAYS OPEN THROUGH A CONFLICT: since `window.mutate`'s reducer call is
//   itself synchronous (it applies to the in-memory data immediately; only the network
//   persist afterward is a real background task), closing the modal and reopening a fresh
//   one prefilled with the same values on conflict would buy no real responsiveness — only
//   an extra close+reopen flicker. This component instead keeps the SAME modal open and
//   shows the conflict list as state, closing only once the outcome is actually known (a
//   clean success, or Abbrechen).
//
// =======================================================================================

import { useId, useState } from 'react';
import { CalendarPlus, TriangleAlert } from 'lucide-react';
import type { Machine } from '../../../../shared/types.ts';
import { getAllDaysInRange, formatDateLong } from '../../../../shared/dates.ts';
import { bookCells, type Conflict } from '../../core/bookings.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { toast, offerUndo } from '../toast.ts';
import { store } from '../../store-instance.ts';
import { machById } from '../machine-lookup.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { AppDialog, AppDialogBody, AppDialogFooter, AppDialogHeader } from './app/AppDialog.tsx';
import { FormField } from './app/FormField.tsx';

const MAX_CELLS_PER_BOOKING = 500;
const MAX_CONFLICTS_SHOWN = 15;

/** Generates a short random group id, called only when a booking actually needs one. */
function generateGroupId(): string {
  return 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Validates the submit form's inputs, as a pure function of them: returns the days to
 *  book, or the German message to toast when the input is invalid. When `fixedDates` is
 *  given (the Assistant's own already-resolved day list — possibly gapped under a custom
 *  "Buchbare Wochentage" selection), it's used verbatim instead of expanding a Von/Bis
 *  range — expanding would silently book excluded weekdays the search never considered
 *  available in the first place. Every other caller (plain grid rectangle/single-cell
 *  selection, the booking-detail modal) has no such list and keeps the original "book EVERY
 *  day in range, weekends included" behavior: the machine stays part of the series on Sat/Sun
 *  too, rather than looking spuriously "free" there. */
function validateBookingInput(
  name: string,
  fromDate: string,
  toDate: string,
  machineCount: number,
  fixedDates?: readonly string[],
): { dates: readonly string[] } | { error: string } {
  if (!name.trim()) return { error: 'Bitte Namen eingeben.' };
  let dates: readonly string[];
  if (fixedDates) {
    dates = fixedDates;
  } else {
    if (!fromDate || !toDate || fromDate > toDate)
      return { error: 'Bitte gültigen Zeitraum wählen.' };
    dates = getAllDaysInRange(fromDate, toDate);
  }
  if (!dates.length) return { error: 'Bitte gültigen Zeitraum wählen.' };
  if (dates.length * machineCount > MAX_CELLS_PER_BOOKING) {
    return { error: 'Zeitraum zu groß (max. ~500 Einzelbuchungen).' };
  }
  return { dates };
}

function MachineList({ machines }: { machines: readonly Machine[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {machines.map((machine) => (
        <li
          key={machine.id}
          className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground"
        >
          {machine.name}
        </li>
      ))}
    </ul>
  );
}

function ConflictList({ conflicts }: { conflicts: readonly Conflict[] }) {
  const shown = conflicts.slice(0, MAX_CONFLICTS_SHOWN);
  return (
    <div className="conflictbox flex min-h-0 flex-col gap-2 rounded-xl border border-brand/40 bg-brand-soft px-3 py-2.5 text-brand-foreground">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <TriangleAlert className="size-3.5 shrink-0" />
        {conflicts.length} Termin(e) bereits belegt / gesperrt:
      </p>
      <ScrollArea className="-mr-3 max-h-32 min-h-0 pr-3">
        <ul className="flex flex-col gap-0.5 text-[11px] tabular-nums">
          {shown.map((conflict) => (
            <li key={`${conflict.machineId}-${conflict.date}`}>
              • {machById(conflict.machineId)?.name ?? conflict.machineId}{' '}
              {formatDateLong(conflict.date)}: {conflict.by}
            </li>
          ))}
          {conflicts.length > MAX_CONFLICTS_SHOWN && <li>…</li>}
        </ul>
      </ScrollArea>
    </div>
  );
}

interface FormFieldsState {
  name: string;
  setName: (value: string) => void;
  fromDate: string;
  setFromDate: (value: string) => void;
  toDate: string;
  setToDate: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
}

/** Fixed-dates mode (opened from the Assistant with an already-resolved, possibly gapped day
 *  list) shows the exact dates as a read-only line instead of editable Von/Bis fields — free
 *  Von/Bis editing would recompute a full calendar range and silently re-include the very
 *  weekdays the search excluded. */
function FixedDatesRow({ dates }: { dates: readonly string[] }) {
  return (
    <FormField label="Termine">
      <p className="text-sm leading-relaxed tabular-nums text-foreground">
        {dates.map((date) => formatDateLong(date)).join(', ')}
      </p>
    </FormField>
  );
}

function DateRangeFields({ fields }: { fields: FormFieldsState }) {
  const fromId = useId();
  const toId = useId();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField label="Von" htmlFor={fromId}>
        <Input
          id={fromId}
          type="date"
          className="h-10 rounded-lg"
          value={fields.fromDate}
          onChange={(event) => fields.setFromDate(event.target.value)}
        />
      </FormField>
      <FormField label="Bis" htmlFor={toId}>
        <Input
          id={toId}
          type="date"
          className="h-10 rounded-lg"
          value={fields.toDate}
          onChange={(event) => fields.setToDate(event.target.value)}
        />
      </FormField>
    </div>
  );
}

function BookingFormFields({
  machines,
  fields,
  fixedDates,
}: {
  machines: readonly Machine[];
  fields: FormFieldsState;
  fixedDates?: readonly string[];
}) {
  const nameId = useId();
  const noteId = useId();
  return (
    <>
      <FormField label={`Maschine(n) · ${machines.length}`}>
        <MachineList machines={machines} />
      </FormField>
      <FormField label="Name" htmlFor={nameId}>
        <Input
          id={nameId}
          type="text"
          className="h-10 rounded-lg"
          value={fields.name}
          onChange={(event) => fields.setName(event.target.value)}
        />
      </FormField>
      {fixedDates ? <FixedDatesRow dates={fixedDates} /> : <DateRangeFields fields={fields} />}
      <FormField label="Notiz" htmlFor={noteId} hint="Dient zugleich als Titel der Buchungsgruppe.">
        <Input
          id={noteId}
          type="text"
          className="h-10 rounded-lg"
          placeholder="optional – Zweck / Kommentar"
          value={fields.note}
          onChange={(event) => fields.setNote(event.target.value)}
        />
      </FormField>
    </>
  );
}

interface BookingFormProps {
  machineIds: readonly string[];
  from: string;
  to: string;
  /** The Assistant's own already-resolved day list, when opened from a search result — see
   *  `validateBookingInput`'s doc comment for why this bypasses Von/Bis range expansion. */
  dates?: readonly string[];
}

interface SubmitBookingInput {
  machineIds: readonly string[];
  name: string;
  fromDate: string;
  toDate: string;
  note: string;
  skipConflicts: boolean;
  fixedDates?: readonly string[];
}

/** Validates and, if valid, actually books. Returns the conflict list (the form stays open
 *  and shows them) or nothing — either the input was invalid (already toasted), or it
 *  succeeded and the form should close. Pulled out of the component so `BookingForm` itself
 *  stays a thin render + wiring layer. */
async function submitBooking(input: SubmitBookingInput): Promise<readonly Conflict[] | undefined> {
  const validation = validateBookingInput(
    input.name,
    input.fromDate,
    input.toDate,
    input.machineIds.length,
    input.fixedDates,
  );
  if ('error' in validation) {
    toast(validation.error);
    return undefined;
  }

  const trimmedName = input.name.trim();
  const trimmedNote = input.note.trim();
  const result = await window.mutate(
    (fresh) =>
      bookCells(fresh, input.machineIds, validation.dates, {
        name: trimmedName,
        note: trimmedNote,
        title: trimmedNote, // note doubles as the group title, exactly as legacy combines them
        skipConflicts: input.skipConflicts,
        ts: new Date().toISOString(),
        newGid: generateGroupId,
      }),
    `Buchung: ${trimmedName}, ${input.machineIds.length} Maschine(n), ${input.fromDate} bis ${input.toDate}`,
  );

  if (result?.conflicts) return result.conflicts;
  closeReactModal();
  if (result && !result.abort) {
    offerUndo(`${result.count} Buchung(en) eingetragen ✓`, result.undo, 'Buchung');
  }
  return undefined;
}

export function BookingForm({ machineIds, from, to, dates }: BookingFormProps) {
  const machines = machineIds.map((id) => machById(id)).filter((m): m is Machine => !!m);
  const [name, setName] = useState(store.get('user'));
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);
  const [note, setNote] = useState('');
  const [conflicts, setConflicts] = useState<readonly Conflict[] | null>(null);

  async function submit(skipConflicts: boolean): Promise<void> {
    const newConflicts = await submitBooking({
      machineIds,
      name,
      fromDate,
      toDate,
      note,
      skipConflicts,
      fixedDates: dates,
    });
    if (newConflicts) setConflicts(newConflicts);
  }

  const titleId = useId();
  return (
    <AppDialog size="md" labelledBy={titleId}>
      <AppDialogHeader
        icon={<CalendarPlus className="size-6" />}
        title="Buchen"
        titleId={titleId}
        subtitle={`${machines.length} Maschine${machines.length === 1 ? '' : 'n'} reservieren`}
      />
      <AppDialogBody className="max-h-[65vh] overflow-y-auto">
        <BookingFormFields
          machines={machines}
          fields={{ name, setName, fromDate, setFromDate, toDate, setToDate, note, setNote }}
          fixedDates={dates}
        />
        <div id="bkConflicts" className="contents">
          {conflicts && (
            <>
              <ConflictList conflicts={conflicts} />
              <Button className="self-start" onClick={() => submit(true)}>
                Nur freie Termine buchen
              </Button>
            </>
          )}
        </div>
      </AppDialogBody>
      <AppDialogFooter>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="lg" onClick={closeReactModal}>
            Abbrechen
          </Button>
          <Button size="lg" onClick={() => submit(false)}>
            Buchen
          </Button>
        </div>
      </AppDialogFooter>
    </AppDialog>
  );
}

/** Opens the booking form for `machineIds` over `[from, to]`. The form is sticky —
 *  Escape/outside-click don't dismiss it, only the buttons do, since an accidental
 *  dismissal here would lose a partially-filled booking.
 *
 *  `dates`, when given, is the Assistant's own already-resolved day list (possibly gapped
 *  under a custom "Buchbare Wochentage" selection) — it's booked verbatim instead of
 *  re-expanding `[from, to]` into every calendar day between them. Every other caller (plain
 *  grid rectangle/single-cell selection, the booking-detail modal) omits it and keeps the
 *  original full-range behavior. */
export function openBookingForm(
  machineIds: readonly string[],
  from: string,
  to: string,
  dates?: readonly string[],
): void {
  openReactModal(<BookingForm machineIds={machineIds} from={from} to={to} dates={dates} />, {
    sticky: true,
  });
}
