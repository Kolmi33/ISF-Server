// The booking form (Phase 7 slice B4). Faithful port of legacy `openBookingForm`/
// `submitBooking` — one form for 1..n machines, used identically by a single click, a
// range/rectangle selection, and the (still-legacy) assistant.
//
// Shape decision (E2 — flagged, not silently absorbed): legacy closes the modal immediately,
// then reopens a fresh one prefilled with the same values if the write hits a conflict. Since
// `window.mutate`'s reducer call is itself synchronous (it applies to the in-memory `S.data`;
// only the network persist afterward is a real background task — see `mutate`'s own comment),
// closing first buys no real responsiveness here, only an extra close+reopen flicker. This
// component instead keeps the SAME modal open and shows the conflict list as state, closing
// only once the outcome is actually known (a clean success, or Abbrechen). The visible result
// for the user is identical or smoother — never a hidden behavior change.

import { useState } from 'react';
import type { Machine } from '../../../../shared/types.ts';
import { getAllDaysInRange, formatDateLong } from '../../../../shared/dates.ts';
import { bookCells, type Conflict } from '../../core/booking.ts';
import { closeReactModal, openReactModal } from '../modal.tsx';
import { toast, offerUndo } from '../toast.ts';
import { store } from '../../store-instance.ts';
import { machById } from '../machine-lookup.ts';

const MAX_CELLS_PER_BOOKING = 500;
const MAX_CONFLICTS_SHOWN = 15;

/** A short random group id, generated only when a booking actually needs one. Faithful port
 *  of legacy `genGid`. */
function generateGroupId(): string {
  return 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** The submit form's validation, as a pure function of its inputs: the days to book, or the
 *  German message to toast when the input is invalid. Faithful port of legacy `submitBooking`'s
 *  guard clauses. */
function validateBookingInput(
  name: string,
  fromDate: string,
  toDate: string,
  machineCount: number,
): { dates: string[] } | { error: string } {
  if (!name.trim()) return { error: 'Bitte Namen eingeben.' };
  if (!fromDate || !toDate || fromDate > toDate)
    return { error: 'Bitte gültigen Zeitraum wählen.' };
  // Book EVERY day in range, weekends included: the machine stays part of the series on
  // Sat/Sun too, rather than looking spuriously "free" there.
  const dates = getAllDaysInRange(fromDate, toDate);
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
        <span key={`${conflict.mid}-${conflict.date}`}>
          {index > 0 && <br />}• {machById(conflict.mid)?.name ?? conflict.mid}{' '}
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

function BookingFormFields({
  machines,
  fields,
}: {
  machines: readonly Machine[];
  fields: FormFieldsState;
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
}

interface SubmitBookingInput {
  machineIds: readonly string[];
  name: string;
  fromDate: string;
  toDate: string;
  note: string;
  skipConflicts: boolean;
}

/** Validate and, if valid, actually book. Returns the conflict list (form stays open, shows
 *  them) or nothing (either the input was invalid — already toasted — or it succeeded and the
 *  form should close). Pulled out of the component so `BookingForm` itself stays a thin
 *  render + wiring layer. Faithful port of legacy `submitBooking`. */
async function submitBooking(input: SubmitBookingInput): Promise<readonly Conflict[] | undefined> {
  const validation = validateBookingInput(
    input.name,
    input.fromDate,
    input.toDate,
    input.machineIds.length,
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

export function BookingForm({ machineIds, from, to }: BookingFormProps) {
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
    });
    if (newConflicts) setConflicts(newConflicts);
  }

  return (
    <>
      <h2>Buchen</h2>
      <BookingFormFields
        machines={machines}
        fields={{ name, setName, fromDate, setFromDate, toDate, setToDate, note, setNote }}
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

/** Open the booking form for `machineIds` over `[from, to]`. Faithful port of legacy
 *  `openBookingForm`. The form is sticky — Escape/outside-click don't dismiss it, only the
 *  buttons do — matching legacy's `{sticky:true}`. */
export function openBookingForm(machineIds: readonly string[], from: string, to: string): void {
  openReactModal(<BookingForm machineIds={machineIds} from={from} to={to} />, { sticky: true });
}
