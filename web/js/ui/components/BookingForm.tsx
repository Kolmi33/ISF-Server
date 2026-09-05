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

import { useState } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { getAllDaysInRange, formatDateLong } from '../../../../shared/dates.ts';
import { bookCells, type Conflict } from '../../core/bookings.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { toast, offerUndo } from '../toast.ts';
import { store } from '../../store-instance.ts';
import { machById } from '../machine-lookup.ts';

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
    <div style={{ flex: 1 }}>
      {machines.map((machine) => (
        <div key={machine.id}>{machine.name}</div>
      ))}
    </div>
  );
}

function ConflictList({ conflicts }: { conflicts: readonly Conflict[] }) {
  const shown = conflicts.slice(0, MAX_CONFLICTS_SHOWN);
  return (
    <div className="conflictbox">
      <b>{conflicts.length} Termin(e) bereits belegt / gesperrt:</b>
      <br />
      {shown.map((conflict, index) => (
        <span key={`${conflict.machineId}-${conflict.date}`}>
          {index > 0 && <br />}• {machById(conflict.machineId)?.name ?? conflict.machineId}{' '}
          {formatDateLong(conflict.date)}: {conflict.by}
        </span>
      ))}
      {conflicts.length > MAX_CONFLICTS_SHOWN && (
        <>
          <br />…
        </>
      )}
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
    <div className="formrow">
      <label>Termine</label>
      <span>{dates.map((date) => formatDateLong(date)).join(', ')}</span>
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
  return (
    <>
      <div className="formrow">
        <label>Maschine(n)</label>
        <MachineList machines={machines} />
      </div>
      <div className="formrow">
        <label>Name</label>
        <input
          type="text"
          value={fields.name}
          onChange={(event) => fields.setName(event.target.value)}
        />
      </div>
      {fixedDates ? (
        <FixedDatesRow dates={fixedDates} />
      ) : (
        <div className="formrow">
          <label>Von</label>
          <input
            type="date"
            value={fields.fromDate}
            onChange={(event) => fields.setFromDate(event.target.value)}
          />
          <label style={{ minWidth: 'auto' }}>Bis</label>
          <input
            type="date"
            value={fields.toDate}
            onChange={(event) => fields.setToDate(event.target.value)}
          />
        </div>
      )}
      <div className="formrow">
        <label>Notiz</label>
        <input
          type="text"
          placeholder="optional – Zweck / Kommentar"
          value={fields.note}
          onChange={(event) => fields.setNote(event.target.value)}
        />
      </div>
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

  return (
    <>
      <h2>Buchen</h2>
      <BookingFormFields
        machines={machines}
        fields={{ name, setName, fromDate, setFromDate, toDate, setToDate, note, setNote }}
        fixedDates={dates}
      />
      <div id="bkConflicts">
        {conflicts && (
          <>
            <ConflictList conflicts={conflicts} />
            <div className="modal-actions" style={{ marginTop: 4 }}>
              <button className="btn primary" onClick={() => submit(true)}>
                Nur freie Termine buchen
              </button>
            </div>
          </>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={closeReactModal}>
          Abbrechen
        </button>
        <button className="btn primary" onClick={() => submit(false)}>
          Buchen
        </button>
      </div>
    </>
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
