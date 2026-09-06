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
import { entryIdOf } from './model.ts';
import { normalizePlan } from './model.ts';
import { insertIndexOf } from './model.ts';
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
  const targetEntryId = entryIdOf(overId);
  /* Auf sich selbst gruppieren heißt nichts tun — bei der eigenen Karte wie bei der
     eigenen Bedarfsgruppe. */
  const isMerge = zone === 'merge' && targetEntryId !== '';

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

    /* Umsortieren folgt der Lücke, die die Liste beim Ziehen aufmacht: die Karte nimmt den
       Platz der Zielkarte ein. Vorher/dahinter wäre eine zweite, widersprüchliche Aussage. */
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
    if (targetEntryId === source.entryId) return current;
    return normalizePlan(mergeInto(stripped, targetEntryId, [source.deviceId]));
  }

  /* Herausgelöst → eigene Karte an der Stelle, die die grüne Linie gezeigt hat. Das
     Ausdünnen der Quellgruppe verschiebt keine Indizes: bleibt ein Gerät übrig, wird die
     Gruppe an derselben Stelle zur normalen Karte. */
  const cleaned = normalizePlan(stripped);
  const insertAt = insertIndexOf(cleaned, overId, zone) ?? cleaned.length;
  const next = [...cleaned];
  next.splice(insertAt, 0, createDeviceEntry(source.deviceId));
  return next;
}
export function usePlanDrag(
  plan: PlanEntry[],
  setPlan: React.Dispatch<React.SetStateAction<PlanEntry[]>>,
) {
  const [activeDrag, setActiveDrag] = React.useState<DragSource | null>(null);
  /* Die zwei Anzeigen, die ein Zug hat: der Ring um die Karte, auf die gruppiert wird, und
     die grüne Linie an der Stelle, an der ein herausgelöstes Gerät landet. Nie beide. */
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
    const overId = event.over ? String(event.over.id) : '';
    const source = parseDragId(String(event.active.id));
    const zone = zoneOf(event.collisions);
    const targetEntryId = entryIdOf(overId);
    const onSelf = targetEntryId === source?.entryId;
    setMergeTargetId(zone === 'merge' && targetEntryId && !onSelf ? targetEntryId : null);
    /* Nur beim Herauslösen aus einer Bedarfsgruppe: beim Umsortieren ganzer Karten zeigt
       schon die Lücke in der Liste, wohin die Karte fällt. */
    setDropIndex(source?.type === 'member' ? insertIndexOf(plan, overId, zone) : null);
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
