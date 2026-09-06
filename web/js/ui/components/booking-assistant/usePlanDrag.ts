import * as React from 'react';
import { PointerSensor } from '@dnd-kit/core';
import { useSensor } from '@dnd-kit/core';
import { useSensors } from '@dnd-kit/core';
import { type DragEndEvent } from '@dnd-kit/core';
import { type DragStartEvent } from '@dnd-kit/core';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { type DragSource } from './model.ts';
import { parseDragId } from './model.ts';
import { deviceIdsOf } from './model.ts';
import { normalizePlan } from './model.ts';
import { createDeviceEntry } from './model.ts';

const mergeInto = (list: PlanEntry[], targetId: string, deviceIds: string[]): PlanEntry[] =>
  list.map<PlanEntry>((entry) => {
    if (entry.id !== targetId) return entry;
    const merged = [...deviceIdsOf(entry), ...deviceIds];
    return {
      kind: 'group',
      id: entry.id,
      deviceIds: merged,
      requiredCount: entry.kind === 'group' ? Math.min(entry.requiredCount, merged.length) : 1,
    };
  });

function movePlan(current: PlanEntry[], source: DragSource, overId: string): PlanEntry[] {
  const isMerge = overId.startsWith('merge:');
  const targetEntryId = overId.split(':')[1] ?? '';
  /* (a) ganze Karte bewegt */
  if (source.type === 'entry') {
    const fromIndex = current.findIndex((e) => e.id === source.entryId);
    if (fromIndex < 0) return current;
    const moving = current[fromIndex]!;

    if (isMerge) {
      if (targetEntryId === source.entryId) return current;
      const without = current.filter((e) => e.id !== source.entryId);
      return normalizePlan(mergeInto(without, targetEntryId, deviceIdsOf(moving)));
    }

    const toIndex = current.findIndex((e) => e.id === targetEntryId);
    if (toIndex < 0 || toIndex === fromIndex) return current;
    const next = [...current];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moving);
    return next;
  }

  /* (b) einzelnes Gerät aus einer Bedarfsgruppe gezogen */
  const stripped = current.map<PlanEntry>((entry) =>
    entry.id === source.entryId && entry.kind === 'group'
      ? { ...entry, deviceIds: entry.deviceIds.filter((id) => id !== source.deviceId) }
      : entry,
  );

  if (isMerge) {
    /* zurück auf die eigene Gruppe = nichts tun */
    if (targetEntryId === source.entryId) return current;
    return normalizePlan(mergeInto(stripped, targetEntryId, [source.deviceId]));
  }

  /* aus der Gruppe herausgelöst → eigene Karte an der Zielposition */
  const cleaned = normalizePlan(stripped);
  const insertAt =
    overId === 'plan-list'
      ? cleaned.length
      : Math.max(
          0,
          cleaned.findIndex((e) => e.id === targetEntryId),
        );
  const next = [...cleaned];
  next.splice(insertAt, 0, createDeviceEntry(source.deviceId));
  return next;
}
export function usePlanDrag(
  plan: PlanEntry[],
  setPlan: React.Dispatch<React.SetStateAction<PlanEntry[]>>,
) {
  const [activeDrag, setActiveDrag] = React.useState<DragSource | null>(null);
  const [mergeTargetId, setMergeTargetId] = React.useState<string | null>(null);
  const sensors = useSensors(
    /* 5px Toleranz, damit Klicks auf Buttons in der Karte nicht als Drag gelten */
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDrag(parseDragId(String(event.active.id)));
  };

  const handleDragOver = (event: { over: { id: string | number } | null }) => {
    const overId = event.over ? String(event.over.id) : '';
    setMergeTargetId(overId.startsWith('merge:') ? overId.slice('merge:'.length) : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const source = parseDragId(String(event.active.id));
    setActiveDrag(null);
    setMergeTargetId(null);
    if (source && event.over)
      setPlan((current) => movePlan(current, source, String(event.over!.id)));
  };
  const draggedEntry =
    activeDrag?.type === 'entry' ? plan.find((e) => e.id === activeDrag.entryId) : undefined;
  return {
    sensors,
    activeDrag,
    setActiveDrag,
    mergeTargetId,
    setMergeTargetId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    draggedEntry,
  };
}
