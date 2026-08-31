// The machine form's dynamic maintenance/downtime slot list (Phase 7 slice B6): add, edit, and
// remove rows. Split out of `MachineFormModal.tsx` purely to stay under the file-length/
// function-length budgets; part of the same form conceptually.

import type { MaintSlotDraft } from '../machine-form.ts';

interface MaintenanceSlotRowProps {
  slot: MaintSlotDraft;
  onChange: (patch: Partial<MaintSlotDraft>) => void;
  onRemove: () => void;
}

function MaintenanceSlotRow({ slot, onChange, onRemove }: MaintenanceSlotRowProps) {
  return (
    <div
      className="maintrow"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'center',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 6,
        marginBottom: 6,
      }}
    >
      <select value={slot.type} onChange={(event) => onChange({ type: event.target.value })}>
        <option value="wartung">in Wartung</option>
        <option value="defekt">defekt</option>
      </select>
      <label style={{ minWidth: 'auto' }}>von</label>
      <input
        type="date"
        value={slot.from}
        onChange={(event) => onChange({ from: event.target.value })}
      />
      <label style={{ minWidth: 'auto' }}>bis</label>
      <input
        type="date"
        value={slot.until}
        onChange={(event) => onChange({ until: event.target.value })}
      />
      <input
        type="text"
        value={slot.note}
        onChange={(event) => onChange({ note: event.target.value })}
        placeholder="Grund/Notiz"
        style={{ flex: 1, minWidth: 120 }}
      />
      <button
        className="btn small danger"
        title="Slot löschen"
        aria-label="Slot löschen"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

interface MaintenanceSlotEditorProps {
  slots: readonly MaintSlotDraft[];
  onChange: (next: MaintSlotDraft[]) => void;
}

/** The "Wartung / Ausfallzeiten" section: the slot list (or a hint when empty) plus the "add"
 *  button. Rows are keyed by index — they have no identity beyond position; add always appends,
 *  remove always splices by index, matching legacy's own `data-mt="${i}"` indexing. */
export function MaintenanceSlotEditor({ slots, onChange }: MaintenanceSlotEditorProps) {
  function updateSlot(index: number, patch: Partial<MaintSlotDraft>): void {
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }
  function removeSlot(index: number): void {
    onChange(slots.filter((_, i) => i !== index));
  }
  return (
    <div className="mfsection">
      <h3 style={{ margin: '10px 0 4px', fontSize: 15 }}>Wartung / Ausfallzeiten</h3>
      <div>
        {slots.length ? (
          slots.map((slot, i) => (
            <MaintenanceSlotRow
              key={i}
              slot={slot}
              onChange={(patch) => updateSlot(i, patch)}
              onRemove={() => removeSlot(i)}
            />
          ))
        ) : (
          <p className="hint" style={{ margin: '2px 0 6px' }}>
            Keine Wartungs-/Ausfallzeiten. Mit „＋" hinzufügen.
          </p>
        )}
      </div>
      <div className="formrow">
        <button
          className="btn small"
          onClick={() => onChange([...slots, { type: 'wartung', from: '', until: '', note: '' }])}
        >
          ＋ Wartung/Defekt hinzufügen
        </button>
      </div>
    </div>
  );
}
