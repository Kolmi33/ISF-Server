import * as React from 'react';
import { PointerSensor } from '@dnd-kit/core';
import { useSensor } from '@dnd-kit/core';
import { useSensors } from '@dnd-kit/core';
import { type DragEndEvent } from '@dnd-kit/core';
import { type DragOverEvent } from '@dnd-kit/core';
import { type DragStartEvent } from '@dnd-kit/core';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { type DropPlan } from './plan-drop.ts';
import { applyDrop } from './plan-drop.ts';
import { planDrop } from './plan-drop.ts';
import { entryIdOf } from './plan-tree.ts';
import { findEntry } from './plan-tree.ts';
import { zoneOf } from './planTargeting.ts';

export function usePlanDrag(
  plan: PlanEntry[],
  setPlan: React.Dispatch<React.SetStateAction<PlanEntry[]>>,
) {
  const [draggedId, setDraggedId] = React.useState<string | null>(null);
  /* Die eine Ankündigung eines Zuges — ein Ring um den Eintrag, dessen Mitglied die Karte
     wird, oder eine Marke in der Fuge, in die sie sich stellt. Beide überlagern nur, sie
     verschieben nichts: der Platz der gezogenen Karte bleibt, wo er ist. */
  const [preview, setPreview] = React.useState<DropPlan | null>(null);
  const sensors = useSensors(
    /* 12px Toleranz: Klicks auf Buttons in der Karte gelten nicht als Drag, und ein
       beim Klicken verrutschter Zeiger sortiert die Liste nicht versehentlich um. */
    useSensor(PointerSensor, { activationConstraint: { distance: 12 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedId(entryIdOf(String(event.active.id)) || null);
  };

  /* Quelle und Zone kommen aus dem Ereignis, nicht aus dem State: dnd-kit meldet das erste
     `over` noch im selben Durchlauf wie den Start, `draggedId` wäre dann leer. */
  const handleDragOver = (event: DragOverEvent) => {
    const sourceId = entryIdOf(String(event.active.id));
    const overId = event.over ? String(event.over.id) : '';
    setPreview(
      sourceId && overId ? planDrop(plan, sourceId, overId, zoneOf(event.collisions)) : null,
    );
  };

  /** Alles zurück auf Anfang — nach dem Ablegen wie nach dem Abbrechen. */
  const cancelDrag = () => {
    setDraggedId(null);
    setPreview(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const sourceId = entryIdOf(String(event.active.id));
    const overId = event.over ? String(event.over.id) : '';
    const zone = zoneOf(event.collisions);
    cancelDrag();
    if (!sourceId || !overId) return;
    setPlan((current) => {
      const drop = planDrop(current, sourceId, overId, zone);
      return drop ? applyDrop(current, sourceId, drop) : current;
    });
  };

  return {
    sensors,
    draggedId,
    draggedEntry: draggedId ? findEntry(plan, draggedId) : undefined,
    mergeTargetId: preview?.kind === 'merge' ? preview.targetId : null,
    preview,
    cancelDrag,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
}
