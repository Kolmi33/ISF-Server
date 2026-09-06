// =======================================================================================
// PLAN DRAG TARGETING (web/js/ui/components/booking-assistant/planTargeting.ts)
// =======================================================================================
//
// Wohin ein Zug in der Planliste zielt. Eine Karte ist ein Ziel — genau eines. Ob auf sie
// gruppiert oder vor bzw. hinter sie eingefügt wird, entscheidet allein die Höhe des
// Zeigers innerhalb dieser Karte.
//
// Die Liste ordnet sich während eines Zuges nicht um: der Platz der gezogenen Karte bleibt
// als blasser Abdruck stehen, keine Karte verschiebt sich, und was passieren würde, sagen
// zwei Überlagerungen — eine grüne Linie in der Fuge, in der die Karte landet, oder ein
// Ring um die Karte, mit der sie eine Bedarfsgruppe bildet. Damit ist ein Springen der
// Liste baulich ausgeschlossen und nicht bloß gut eingestellt. (Deshalb auch kein
// `@dnd-kit/sortable`: dessen Aufgabe ist genau das Umlegen der Karten während des Zuges.)
//
// Bleibt die eine Regel, die dieses Modul durchsetzt:
// ZIELE STEHEN IN EINER RANGORDNUNG, NIE IM WETTBEWERB. Die Karten kacheln die Liste
// lückenlos — jede trägt ihren Abstand als eigenes `pb-2`, die Liste hat kein `gap` —,
// also trifft der Zeiger dort immer genau eine Karte und nie eine Fuge. Nur wenn keine
// Karte getroffen ist, fängt die Listenfläche den Zug auf. Zwei Ziele gleichzeitig gibt
// es nie: sonst spränge `over` mehrmals pro Karte hin und her, und mit ihm die Anzeige.
//
// =======================================================================================

import { pointerWithin } from '@dnd-kit/core';
import { type ClientRect } from '@dnd-kit/core';
import { type Collision } from '@dnd-kit/core';
import { type CollisionDetection } from '@dnd-kit/core';
import { type Coordinates } from '@dnd-kit/utilities';
import { ENTRY_PREFIX } from './model.ts';
import { PLAN_LIST_ID } from './model.ts';
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
 *  Ziele gibt es nicht, und ein zweiter Platz wäre nur eine Karte, auf der der Zeiger gar
 *  nicht steht.
 *
 *  Trifft der Zeiger keine Karte, steht er aber noch in der Listenfläche, fängt diese den
 *  Zug auf. Sie überlappt die Karten zwar, kann aber nie mit ihnen konkurrieren, weil sie
 *  erst gefragt wird, wenn keine Karte getroffen ist — die Reihenfolge hier ist die ganze
 *  Rangordnung. Ohne dieses Auffangziel wäre die Fläche unter der letzten Karte tot, und
 *  ein Gerät aus einer Bedarfsgruppe ließe sich nur durch genaues Treffen einer Fuge
 *  herauslösen. */
export const planTargets: CollisionDetection = (args) => {
  const within = (match: (id: string) => boolean) =>
    pointerWithin({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => match(String(c.id))),
    });
  const [hit] = within((id) => id.startsWith(ENTRY_PREFIX));
  if (!hit) return within((id) => id === PLAN_LIST_ID).slice(0, 1);
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
