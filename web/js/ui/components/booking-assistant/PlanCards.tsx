import type { PlanGroupEntry, PlanDeviceEntry } from '../../../core/booking-assistant-types.ts';
import * as React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useCombinedRefs } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { X } from 'lucide-react';
import { cn } from 'cn';
import { Button } from './primitives.tsx';
import { useDevices } from './DeviceProvider.tsx';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { DeviceSubtitle } from './DeviceSubtitle.tsx';
import { entryDragId } from './model.ts';
import { memberDragId } from './model.ts';
import { NumberInput } from './NumberField.tsx';

export function GroupMemberRow({
  entryId,
  deviceId,
  onRemove,
  overlay = false,
}: {
  entryId: string;
  deviceId: string;
  onRemove?: () => void;
  /** true = wird im DragOverlay gerendert, dann kein Sortable-Hook */
  overlay?: boolean;
}) {
  const DEVICES_BY_ID = useDevices();
  const device = DEVICES_BY_ID[deviceId]!;
  const draggable = useDraggable({
    id: memberDragId(entryId, deviceId),
    disabled: overlay,
  });

  return (
    <div
      ref={overlay ? undefined : draggable.setNodeRef}
      {...(overlay ? {} : draggable.listeners)}
      {...(overlay ? {} : draggable.attributes)}
      className={cn(
        'flex cursor-grab touch-none items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2',
        draggable.isDragging && 'border-dashed opacity-40',
        overlay && 'border-primary/60 shadow-lg',
      )}
    >
      <GripVertical className="size-4 shrink-0 text-muted-foreground/40" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{device.name}</span>
        <DeviceSubtitle device={device} />
      </span>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${device.name} aus Bedarfsgruppe entfernen`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}

export interface PlanCardProps {
  entry: PlanEntry;
  /** laufende Nummer, nur bei Einzelgeräten und bewusst sehr klein */
  position?: string;
  onRemoveEntry: (entryId: string) => void;
  onRemoveMember: (entryId: string, deviceId: string) => void;
  onRequiredCountChange: (entryId: string, value: number) => void;
  /** true = Rendering im DragOverlay (keine dnd-Hooks, keine Drop-Zone) */
  overlay?: boolean;
}

export function PlanCardContent({
  entry,
  position,
  onRemoveEntry,
  onRemoveMember,
  onRequiredCountChange,
  overlay = false,
}: PlanCardProps) {
  const isGroup = entry.kind === 'group';

  return (
    <div
      className={cn(
        'rounded-xl border transition-[box-shadow,border-color,opacity] duration-150',
        isGroup ? 'border-primary/45 bg-primary/[0.05]' : 'border-border bg-muted/40',
        overlay && 'border-primary/60 bg-card shadow-lg',
      )}
    >
      <div className={cn('flex items-center gap-3 px-3', isGroup ? 'py-2.5' : 'py-0')}>
        <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/45" />

        {isGroup ? (
          <GroupHeader
            entry={entry}
            onRequiredCountChange={onRequiredCountChange}
            onRemoveEntry={onRemoveEntry}
          />
        ) : (
          <DeviceHeader entry={entry} position={position} onRemoveEntry={onRemoveEntry} />
        )}
      </div>

      {isGroup && (
        <div className="flex flex-col px-3 pb-3">
          {entry.deviceIds.map((deviceId, index) => (
            <React.Fragment key={deviceId}>
              {index > 0 && (
                <div className="flex items-center gap-2 py-1.5" aria-hidden>
                  <span className="h-px flex-1 bg-brand/30" />
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-foreground">
                    oder
                  </span>
                  <span className="h-px flex-1 bg-brand/30" />
                </div>
              )}
              <GroupMemberRow
                entryId={entry.id}
                deviceId={deviceId}
                overlay={overlay}
                onRemove={
                  entry.deviceIds.length > 1
                    ? () => onRemoveMember(entry.id, deviceId)
                    : () => onRemoveEntry(entry.id)
                }
              />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** Die Karte ist Drag-Quelle und zugleich das einzige Drop-Ziel auf ihrer Höhe (dieselbe
 *  ID in beiden Registern). Der Abstand zur nächsten Karte steckt als `pb-2` in ihr drin
 *  und nicht als `gap` in der Liste — so kacheln die Ziele die Liste lückenlos (siehe
 *  `planTargeting.ts`).
 *
 *  Die Karte trägt bewusst keine Transformation: während eines Zuges rührt sich in der
 *  Liste nichts, der Platz der gezogenen Karte bleibt als blasser Abdruck stehen. Ring und
 *  Einfügemarke sind reine Überlagerungen. */
export function PlanCard(
  props: PlanCardProps & { mergeActive: boolean; indicator?: 'before' | 'after' },
) {
  const { entry, mergeActive, indicator, ...rest } = props;
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
      <div className={cn('rounded-xl', mergeActive && 'ring-2 ring-brand/60')}>
        <PlanCardContent entry={entry} {...rest} />
      </div>

      {/* Grüne Einfügemarke, mittig in der Fuge über bzw. unter der Karte. */}
      {indicator && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary',
            indicator === 'before' ? '-top-1' : 'bottom-1',
          )}
        />
      )}
    </li>
  );
}
function GroupHeader({
  entry,
  onRequiredCountChange,
  onRemoveEntry,
}: Pick<PlanCardProps, 'onRequiredCountChange' | 'onRemoveEntry'> & { entry: PlanGroupEntry }) {
  return (
    <>
      <NumberInput
        compact
        value={entry.requiredCount}
        min={1}
        max={entry.deviceIds.length}
        ariaLabel="Benötigte Geräte"
        onChange={(v) => onRequiredCountChange(entry.id, v)}
      />
      <span className="text-sm text-muted-foreground">
        von {entry.deviceIds.length} Geräten benötigt
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Bedarfsgruppe auflösen"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemoveEntry(entry.id)}
        className="ml-auto size-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
    </>
  );
}
function DeviceHeader({
  entry,
  position,
  onRemoveEntry,
}: Pick<PlanCardProps, 'position' | 'onRemoveEntry'> & { entry: PlanDeviceEntry }) {
  const DEVICES_BY_ID = useDevices();
  return (
    <>
      {position && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {position}
        </span>
      )}
      <span className="min-w-0 flex-1 py-2.5">
        <span className="block truncate text-sm font-medium text-foreground">
          {DEVICES_BY_ID[entry.deviceId]!.name}
        </span>
        <DeviceSubtitle device={DEVICES_BY_ID[entry.deviceId]!} />
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${DEVICES_BY_ID[entry.deviceId]!.name} entfernen`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemoveEntry(entry.id)}
        className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
    </>
  );
}
