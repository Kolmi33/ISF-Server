import * as React from 'react';
import { PointerSensor } from '@dnd-kit/core';
import { useSensor } from '@dnd-kit/core';
import { useSensors } from '@dnd-kit/core';
import { type DragEndEvent } from '@dnd-kit/core';
import { type DragOverEvent } from '@dnd-kit/core';
import { type DragStartEvent } from '@dnd-kit/core';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { type DragSource } from './model.ts';
import { type DropZone } from './model.ts';
import { parseDragId } from './model.ts';
import { deviceIdsOf } from './model.ts';
import { normalizePlan } from './model.ts';
import { planDrop } from './model.ts';
import { moveEntryTo } from './model.ts';
import { createDeviceEntry } from './model.ts';
import { zoneOf } from './planTargeting.ts';

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

function movePlan(
  current: PlanEntry[],
  source: DragSource,
  overId: string,
  zone: DropZone,
): PlanEntry[] {
  const drop = planDrop(current, source, overId, zone);
  if (!drop) return current;

  /* (a) ganze Karte bewegt */
  if (source.type === 'entry') {
    const from = current.findIndex((e) => e.id === source.entryId);
    if (from < 0) return current;
    /* Auf eine andere Karte gelegt: die beiden werden eine Bedarfsgruppe. Ist das Ziel
       schon eine, wandern die Geräte der gezogenen Karte einfach hinein. */
    if (drop.kind === 'merge') {
      const without = current.filter((e) => e.id !== source.entryId);
      return normalizePlan(mergeInto(without, drop.targetId, deviceIdsOf(current[from]!)));
    }
    return moveEntryTo(current, from, drop.index);
  }

  /* (b) einzelnes Gerät aus einer Bedarfsgruppe gezogen */
  const stripped = current.map<PlanEntry>((entry) =>
    entry.id === source.entryId && entry.kind === 'group'
      ? { ...entry, deviceIds: entry.deviceIds.filter((id) => id !== source.deviceId) }
      : entry,
  );
  if (drop.kind === 'merge')
    return normalizePlan(mergeInto(stripped, drop.targetId, [source.deviceId]));

  /* Herausgelöst → eigene Karte in der Fuge, in der die grüne Linie stand. Das Ausdünnen
     der Quellgruppe verschiebt keine Fugen: bleibt ein Gerät übrig, wird die Gruppe an
     derselben Stelle zur normalen Karte. */
  const cleaned = normalizePlan(stripped);
  const next = [...cleaned];
  next.splice(drop.index, 0, createDeviceEntry(source.deviceId));
  return next;
}
export function usePlanDrag(
  plan: PlanEntry[],
  setPlan: React.Dispatch<React.SetStateAction<PlanEntry[]>>,
) {
  const [activeDrag, setActiveDrag] = React.useState<DragSource | null>(null);
  /* Die zwei Anzeigen eines Zuges — nie beide zugleich, weil `planDrop` sich für eine
     Auslegung entscheidet: der Ring um die Karte, auf die gruppiert wird, und die grüne
     Linie in der Fuge, in der die Karte landet. Beide überlagern nur, sie verschieben
     nichts: der Platz der gezogenen Karte bleibt, wo er ist. */
  const [mergeTargetId, setMergeTargetId] = React.useState<string | null>(null);
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);
  const sensors = useSensors(
    /* 12px Toleranz: Klicks auf Buttons in der Karte gelten nicht als Drag, und ein
       beim Klicken verrutschter Zeiger sortiert die Liste nicht versehentlich um. */
    useSensor(PointerSensor, { activationConstraint: { distance: 12 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDrag(parseDragId(String(event.active.id)));
  };

  /* Quelle und Zone kommen aus dem Ereignis, nicht aus dem State: dnd-kit meldet das erste
     `over` noch im selben Durchlauf wie den Start, `activeDrag` wäre dann leer. */
  const handleDragOver = (event: DragOverEvent) => {
    const source = parseDragId(String(event.active.id));
    const overId = event.over ? String(event.over.id) : '';
    const drop = source && overId ? planDrop(plan, source, overId, zoneOf(event.collisions)) : null;
    setMergeTargetId(drop?.kind === 'merge' ? drop.targetId : null);
    setDropIndex(drop?.kind === 'insert' ? drop.index : null);
  };

  /** Alles zurück auf Anfang — nach dem Ablegen wie nach dem Abbrechen. */
  const cancelDrag = () => {
    setActiveDrag(null);
    setMergeTargetId(null);
    setDropIndex(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const source = parseDragId(String(event.active.id));
    const zone = zoneOf(event.collisions);
    cancelDrag();
    if (source && event.over)
      setPlan((current) => movePlan(current, source, String(event.over!.id), zone));
  };
  const draggedEntry =
    activeDrag?.type === 'entry' ? plan.find((e) => e.id === activeDrag.entryId) : undefined;
  return {
    sensors,
    activeDrag,
    mergeTargetId,
    dropIndex,
    cancelDrag,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    draggedEntry,
  };
}
