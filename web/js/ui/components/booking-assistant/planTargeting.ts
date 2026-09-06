// =======================================================================================
// PLAN DRAG TARGETING (web/js/ui/components/booking-assistant/planTargeting.ts)
// =======================================================================================
//
// Wohin ein Zug in der Planliste zielt. Eine Karte ist ein Ziel — genau eines. Ob auf sie
// gruppiert oder vor bzw. hinter sie eingefügt wird, entscheidet allein die Höhe des
// Zeigers innerhalb dieser Karte.
//
// Warum das eine Regel und keine zweite Drop-Zone ist:
// `SortableContext` bestimmt die Zielposition über `items.indexOf(over.id)`. Jedes
// Drop-Ziel, das kein Sortable-Eintrag ist, ergibt dort `-1`, und
// `verticalListSortingStrategy` nimmt `-1` wörtlich: die Bedingung `index < activeIndex &&
// index >= overIndex` trifft dann auf *jede* Karte oberhalb der gezogenen zu und schiebt
// sie um eine volle Kartenhöhe nach unten. Früher gab es genau solche Ziele — eine
// Merge-Zone über der mittleren Hälfte jeder Karte und die Liste selbst — und die Fugen
// zwischen den Karten gehörten zu gar keinem Ziel. Beim Ziehen wechselte `over` deshalb
// mehrmals pro Karte zwischen "Sortable" und "kein Sortable", und die halbe Liste sprang
// jedes Mal um eine Kartenhöhe auf und ab.
//
// Daraus die zwei Regeln, die hier durchgesetzt werden:
// 1. NUR KARTEN SIND ZIELE. Die Karten kacheln die Liste lückenlos (jede Karte trägt ihren
//    Abstand als eigenes `pb-2`, die Liste hat kein `gap`), also trifft der Zeiger überall
//    innerhalb der Liste genau eine Karte — nie eine Fuge, nie die Liste selbst.
// 2. DIE STRATEGIE SIEHT `-1` NIE. Bleibt doch kein Ziel übrig (der Zeiger hat die Liste
//    verlassen), rührt sich die Liste gar nicht, statt die Karten falsch herum zu schieben.
//
// =======================================================================================

import { pointerWithin } from '@dnd-kit/core';
import { type ClientRect } from '@dnd-kit/core';
import { type Collision } from '@dnd-kit/core';
import { type CollisionDetection } from '@dnd-kit/core';
import { type Coordinates } from '@dnd-kit/utilities';
import { verticalListSortingStrategy } from '@dnd-kit/sortable';
import { type SortingStrategy } from '@dnd-kit/sortable';
import { ENTRY_PREFIX } from './model.ts';
import { type DropZone } from './model.ts';

/** Anteil der Kartenhöhe in der Mitte, der "auf diese Karte gruppieren" bedeutet; der Rest
 *  verteilt sich gleichmäßig auf die Einfügeränder oben und unten. */
const MERGE_BAND = 0.5;

function zoneAt(pointer: Coordinates | null, rect: ClientRect | undefined): DropZone {
  if (!pointer || !rect || rect.height === 0) return 'merge';
  const offset = (pointer.y - rect.top) / rect.height;
  const edge = (1 - MERGE_BAND) / 2;
  if (offset < edge) return 'before';
  if (offset > 1 - edge) return 'after';
  return 'merge';
}

/** Die getroffene Karte, angereichert um die Zone. Höchstens ein Treffer: überlappende
 *  Ziele gibt es nicht mehr, und ein zweiter Platz wäre nur eine Karte, auf der der Zeiger
 *  gar nicht steht. */
export const planTargets: CollisionDetection = (args) => {
  const cards = args.droppableContainers.filter((container) =>
    String(container.id).startsWith(ENTRY_PREFIX),
  );
  const [hit] = pointerWithin({ ...args, droppableContainers: cards });
  if (!hit) return [];
  return [
    {
      ...hit,
      data: { ...hit.data, zone: zoneAt(args.pointerCoordinates, args.droppableRects.get(hit.id)) },
    },
  ];
};

/** Die Zone, die `planTargets` an den Treffer gehängt hat. */
export function zoneOf(collisions: Collision[] | null | undefined): DropZone {
  const zone: unknown = collisions?.[0]?.data?.['zone'];
  return zone === 'before' || zone === 'after' ? zone : 'merge';
}

/** Die Liste macht eine Lücke nur dort auf, wo die Karte auch wirklich landet: nicht beim
 *  Gruppieren (dann wird kein Platz gebraucht, das sagt der Ring um die Zielkarte) und
 *  nicht ohne Ziel (siehe Regel 2 oben). */
export const planSorting =
  (merging: boolean): SortingStrategy =>
  (args) =>
    merging || args.overIndex === -1 ? null : verticalListSortingStrategy(args);
