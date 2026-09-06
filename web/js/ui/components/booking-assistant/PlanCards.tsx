import type { PlanGroupEntry, PlanDeviceEntry } from '../../../core/booking-assistant-types.ts';
import * as React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useCombinedRefs } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { Ungroup } from 'lucide-react';
import { cn } from 'cn';
import { Button } from './primitives.tsx';
import { useDevices } from './DeviceProvider.tsx';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { DeviceSubtitle } from './DeviceSubtitle.tsx';
import { entryContains } from './plan-tree.ts';
import { entryDragId } from './plan-tree.ts';
import { NumberInput } from './NumberField.tsx';
import { AlternativePicker } from './AlternativePicker.tsx';
import { type AlternativeCandidate } from './AlternativePicker.tsx';

export interface PlanCardHandlers {
  onRemoveEntry: (entryId: string) => void;
  onDissolveGroup: (entryId: string) => void;
  onRequiredCountChange: (entryId: string, value: number) => void;
  onGroupAlternatives: (entryId: string, alternativeIds: string[]) => void;
  alternativeCandidates: AlternativeCandidate[];
  /** Eintrag, dessen Mitglied die gezogene Karte würde — bekommt einen Ring. */
  mergeTargetId?: string | null;
  /** Fuge, in der die gezogene Karte landet: `[Eintrags-ID, Seite]`. */
  marker?: readonly [string, 'before' | 'after'] | null;
}

/** Ein Eintrag, gleich auf welcher Ebene: er zieht sich selbst, nimmt selbst etwas auf und
 *  zeigt selbst seine Marke. Eine Bedarfsgruppe rendert ihre Mitglieder wieder hierüber —
 *  daher kommt die Gruppe in der Gruppe ohne einen zweiten Kartentyp aus.
 *
 *  Bewusst ohne jede Transformation: während eines Zuges rührt sich in der Liste nichts,
 *  der Platz der gezogenen Karte bleibt als blasser Abdruck stehen. */
export function PlanCard({
  entry,
  position,
  depth = 0,
  ...handlers
}: PlanCardHandlers & {
  entry: PlanEntry;
  /** Laufende Nummer des Eintrags auf der obersten Ebene. */
  position?: string;
  depth?: number;
}) {
  const id = entryDragId(entry.id);
  const draggable = useDraggable({ id });
  const droppable = useDroppable({ id });
  const setNodeRef = useCombinedRefs(draggable.setNodeRef, droppable.setNodeRef);

  return (
    <li
      ref={setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      className={cn('relative cursor-grab touch-none pb-2', draggable.isDragging && 'opacity-40')}
    >
      <div
        className={cn('rounded-xl', handlers.mergeTargetId === entry.id && 'ring-2 ring-brand/60')}
      >
        <PlanCardBody entry={entry} position={position} depth={depth} {...handlers} />
      </div>

      <DropMarker side={handlers.marker?.[0] === entry.id ? handlers.marker[1] : null} />
    </li>
  );
}

/** Dieselbe Karte, wie sie am Zeiger hängt: ohne dnd-Haken, denn ihre IDs sind schon von den
 *  echten Karten belegt — zwei Knoten unter einer ID würden sich gegenseitig überschreiben.
 *  Auch die Mitglieder rendern deshalb hierüber weiter. */
export function PlanCardPreview({ entry }: { entry: PlanEntry }) {
  return (
    <li className="relative rotate-[1.5deg] list-none">
      <PlanCardBody
        entry={entry}
        depth={0}
        preview
        onRemoveEntry={noop}
        onDissolveGroup={noop}
        onRequiredCountChange={noop}
        onGroupAlternatives={noop}
        alternativeCandidates={[]}
      />
    </li>
  );
}
const noop = () => {};

/** Grüne Einfügemarke, mittig in der Fuge über bzw. unter dem Eintrag. */
function DropMarker({ side }: { side: 'before' | 'after' | null }) {
  if (!side) return null;
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary',
        side === 'before' ? '-top-1' : 'bottom-1',
      )}
    />
  );
}

function PlanCardBody({
  entry,
  position,
  depth,
  preview = false,
  ...handlers
}: PlanCardHandlers & {
  entry: PlanEntry;
  position?: string;
  depth: number;
  preview?: boolean;
}) {
  const isGroup = entry.kind === 'group';
  const alternativeAction = preview ? null : (
    <AlternativePicker
      entry={entry}
      position={position}
      candidates={alternativeCandidatesFor(entry, handlers.alternativeCandidates)}
      onGroup={handlers.onGroupAlternatives}
    />
  );
  return (
    <div
      className={cn(
        'rounded-xl border transition-[box-shadow,border-color,opacity] duration-150',
        isGroup ? 'border-primary/45 bg-primary/[0.05]' : 'border-border bg-background',
        depth === 0 && !isGroup && 'bg-muted/40',
        preview && 'border-primary/60 bg-card shadow-lg',
      )}
    >
      <div className={cn('flex items-center gap-3 px-3', isGroup ? 'py-2.5' : 'py-0')}>
        <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/45" />
        {entry.kind === 'group' ? (
          <GroupHeader
            entry={entry}
            position={position}
            alternativeAction={alternativeAction}
            {...handlers}
          />
        ) : (
          <DeviceHeader
            entry={entry}
            position={position}
            alternativeAction={alternativeAction}
            onRemoveEntry={handlers.onRemoveEntry}
          />
        )}
      </div>

      {entry.kind === 'group' && (
        <GroupMembers entry={entry} depth={depth} preview={preview} handlers={handlers} />
      )}
    </div>
  );
}

/** Every selected machine can be chosen except the card that opened the picker. A group card
 * excludes all of its members because adding them again would duplicate its own contents. */
export function alternativeCandidatesFor(
  entry: PlanEntry,
  candidates: AlternativeCandidate[],
): AlternativeCandidate[] {
  return candidates.filter((candidate) => !entryContains(entry, candidate.entry.id));
}

function GroupMembers({
  entry,
  depth,
  preview,
  handlers,
}: {
  entry: PlanGroupEntry;
  depth: number;
  preview: boolean;
  handlers: PlanCardHandlers;
}) {
  return (
    <ul className="flex flex-col px-3 pb-3">
      {entry.members.map((member, index) => (
        <React.Fragment key={member.id}>
          {index > 0 && <OrSeparator />}
          {preview ? (
            <PlanCardPreview entry={member} />
          ) : (
            <PlanCard entry={member} depth={depth + 1} {...handlers} />
          )}
        </React.Fragment>
      ))}
    </ul>
  );
}

function OrSeparator() {
  return (
    <li className="flex items-center gap-2 py-1.5" aria-hidden>
      <span className="h-px flex-1 bg-brand/30" />
      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-foreground">
        oder
      </span>
      <span className="h-px flex-1 bg-brand/30" />
    </li>
  );
}

function GroupHeader({
  entry,
  position,
  alternativeAction,
  onRequiredCountChange,
  onDissolveGroup,
}: Pick<PlanCardHandlers, 'onRequiredCountChange' | 'onDissolveGroup'> & {
  entry: PlanGroupEntry;
  position?: string;
  alternativeAction: React.ReactNode;
}) {
  /* "Geräten" stimmt nur, solange keine Untergruppe dabei ist — sonst sind es Möglichkeiten. */
  const noun = entry.members.every((m) => m.kind === 'device') ? 'Geräten' : 'Möglichkeiten';
  return (
    <>
      <NumberInput
        compact
        value={entry.requiredCount}
        min={1}
        max={entry.members.length}
        ariaLabel="Benötigte Geräte"
        onChange={(v) => onRequiredCountChange(entry.id, v)}
      />
      <span className="text-sm text-muted-foreground">
        von {entry.members.length} {noun} benötigt
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <PositionBadge position={position} />
        {alternativeAction}
        {/* Löst nur die Gruppierung auf; die Mitglieder bleiben als eigene Karten stehen. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Bedarfsgruppe auflösen"
          title="Bedarfsgruppe auflösen — die Geräte bleiben einzeln im Plan"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDissolveGroup(entry.id)}
          className="size-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Ungroup className="size-4" />
        </Button>
      </span>
    </>
  );
}

function DeviceHeader({
  entry,
  position,
  alternativeAction,
  onRemoveEntry,
}: Pick<PlanCardHandlers, 'onRemoveEntry'> & {
  entry: PlanDeviceEntry;
  position?: string;
  alternativeAction: React.ReactNode;
}) {
  const DEVICES_BY_ID = useDevices();
  const device = DEVICES_BY_ID[entry.deviceId]!;
  return (
    <>
      <span className="min-w-0 flex-1 py-2.5">
        <span className="block truncate text-sm font-medium text-foreground">{device.name}</span>
        <DeviceSubtitle device={device} />
      </span>
      <PositionBadge position={position} />
      {alternativeAction}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${device.name} entfernen`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemoveEntry(entry.id)}
        className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
    </>
  );
}

function PositionBadge({ position }: { position?: string }) {
  if (!position) return null;
  const label = position.includes(',') ? `Positionen ${position}` : `Position ${position}`;
  return (
    <span
      aria-label={label}
      className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/70 px-1.5 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground"
    >
      {position}
    </span>
  );
}
