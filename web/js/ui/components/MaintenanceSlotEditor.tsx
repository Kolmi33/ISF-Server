// =======================================================================================
// MAINTENANCE SLOT EDITOR COMPONENT (web/js/ui/components/MaintenanceSlotEditor.tsx)
// =======================================================================================
//
// The machine form's dynamic maintenance/downtime slot list: add, edit, and remove rows.
// Split out of `MachineFormModal.tsx` purely to stay under the file-length/function-length
// budgets — part of the same form conceptually.
//
// =======================================================================================

import { useId, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { MaintSlotDraft } from '../machine-form.ts';
import { Button } from '../../components/ui/app-button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { NativeSelect } from '../../components/ui/native-select.tsx';
import { EmptyState } from './app/EmptyState.tsx';
import { SectionHeading } from './app/SectionHeading.tsx';
import { LABEL_CLASS } from './app/typography.ts';

interface MaintenanceSlotRowProps {
  slot: MaintSlotDraft;
  onChange: (patch: Partial<MaintSlotDraft>) => void;
  onRemove: () => void;
}

/** One labelled control in a slot row. Deliberately not `FormField`: this grid puts the
 *  remove button on the same baseline as the fields, so the wrappers must stay flat. */
function SlotField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ''}`}>
      <label htmlFor={htmlFor} className={LABEL_CLASS}>
        {label}
      </label>
      {children}
    </div>
  );
}

function MaintenanceSlotRow({ slot, onChange, onRemove }: MaintenanceSlotRowProps) {
  const ids = { type: useId(), from: useId(), until: useId(), note: useId() };
  return (
    <div className="maintrow grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-muted/40 p-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <SlotField label="Art" htmlFor={ids.type}>
        <NativeSelect
          id={ids.type}
          value={slot.type}
          onChange={(event) => onChange({ type: event.target.value })}
        >
          <option value="wartung">in Wartung</option>
          <option value="defekt">defekt</option>
        </NativeSelect>
      </SlotField>
      <SlotField label="von" htmlFor={ids.from}>
        <Input
          id={ids.from}
          type="date"
          className="h-10 rounded-lg"
          value={slot.from}
          onChange={(event) => onChange({ from: event.target.value })}
        />
      </SlotField>
      <SlotField label="bis" htmlFor={ids.until}>
        <Input
          id={ids.until}
          type="date"
          className="h-10 rounded-lg"
          value={slot.until}
          onChange={(event) => onChange({ until: event.target.value })}
        />
      </SlotField>
      <Button
        variant="ghost"
        size="icon"
        className="size-10 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        title="Slot löschen"
        aria-label="Slot löschen"
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
      <SlotField label="Grund / Notiz" htmlFor={ids.note} className="sm:col-span-4">
        <Input
          id={ids.note}
          type="text"
          className="h-10 rounded-lg"
          value={slot.note}
          onChange={(event) => onChange({ note: event.target.value })}
          placeholder="Grund/Notiz"
        />
      </SlotField>
    </div>
  );
}

interface MaintenanceSlotEditorProps {
  slots: readonly MaintSlotDraft[];
  onChange: (next: MaintSlotDraft[]) => void;
}

/** The "Wartung / Ausfallzeiten" section: the slot list (or a hint when empty) plus the
 *  "add" button. Rows are keyed by index — they have no identity beyond their position;
 *  add always appends, remove always splices by index. */
export function MaintenanceSlotEditor({ slots, onChange }: MaintenanceSlotEditorProps) {
  function updateSlot(index: number, patch: Partial<MaintSlotDraft>): void {
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }
  function removeSlot(index: number): void {
    onChange(slots.filter((_, i) => i !== index));
  }
  return (
    <div className="mfsection flex flex-col gap-3">
      <SectionHeading label="Wartung / Ausfallzeiten" badge={slots.length || undefined} />
      {slots.length ? (
        <div className="flex flex-col gap-3">
          {slots.map((slot, i) => (
            <MaintenanceSlotRow
              key={i}
              slot={slot}
              onChange={(patch) => updateSlot(i, patch)}
              onRemove={() => removeSlot(i)}
            />
          ))}
        </div>
      ) : (
        <EmptyState className="py-8">Keine Wartungs-/Ausfallzeiten hinterlegt.</EmptyState>
      )}
      <Button
        variant="outline"
        className="self-start"
        onClick={() => onChange([...slots, { type: 'wartung', from: '', until: '', note: '' }])}
      >
        <Plus className="size-4" /> Wartung/Defekt hinzufügen
      </Button>
    </div>
  );
}
