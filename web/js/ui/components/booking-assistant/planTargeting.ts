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
// ZIELE STEHEN IN EINER RANGORDNUNG, NIE IM WETTBEWERB. Auf einer Ebene kacheln die Karten
// lückenlos — jede trägt ihren Abstand als eigenes `pb-2`, die Liste hat kein `gap` —, also
// trifft der Zeiger dort genau eine und nie eine Fuge. Über die Ebenen hinweg überlappen
// sie zwangsläufig, weil eine Bedarfsgruppe in einer Bedarfsgruppe in ihr drinliegt; dann
// gewinnt der innerste Treffer. Und erst wenn gar kein Eintrag getroffen ist, fängt die
// Listenfläche den Zug auf. Zwei gleichrangige Ziele gibt es nie: sonst spränge `over`
// mehrmals pro Karte hin und her, und mit ihm die Anzeige.
//
// =======================================================================================

import { pointerWithin } from '@dnd-kit/core';
import { type ClientRect } from '@dnd-kit/core';
import { type Collision } from '@dnd-kit/core';
import { type CollisionDetection } from '@dnd-kit/core';
import { type Coordinates } from '@dnd-kit/utilities';
import { ENTRY_PREFIX } from './plan-tree.ts';
import { PLAN_LIST_ID } from './plan-tree.ts';
import { type DropZone } from './plan-drop.ts';

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

/** Fläche eines Ziels — je kleiner, desto tiefer im Baum, denn eine Untergruppe liegt immer
 *  ganz innerhalb ihrer Gruppe. */
const areaOf = (rect: ClientRect | undefined) => (rect ? rect.width * rect.height : Infinity);

/** Der getroffene Eintrag, angereichert um die Zone.
 *
 *  Auf einer Ebene überlappen die Ziele nie — die Karten kacheln die Liste lückenlos. Über
 *  die Ebenen hinweg tun sie es zwangsläufig: eine Bedarfsgruppe in einer Bedarfsgruppe
 *  liegt in ihr drin. Dann gewinnt der innerste Treffer, also der mit der kleinsten Fläche;
 *  so zielt man auf die Untergruppe, wo sie sichtbar ist, und auf die äußere Gruppe überall
 *  sonst auf ihrer Karte.
 *
 *  Trifft der Zeiger gar keinen Eintrag, steht er aber noch in der Listenfläche, fängt diese
 *  den Zug auf. Sie kann nie mit den Einträgen konkurrieren, weil sie erst gefragt wird,
 *  wenn keiner getroffen ist — die Reihenfolge hier ist die ganze Rangordnung. Ohne dieses
 *  Auffangziel wäre die Fläche unter der letzten Karte tot, und ein Gerät aus einer
 *  Bedarfsgruppe ließe sich nur durch genaues Treffen einer Fuge herauslösen. */
export const planTargets: CollisionDetection = (args) => {
  const within = (match: (id: string) => boolean) =>
    pointerWithin({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => match(String(c.id))),
    });
  const hits = within((id) => id.startsWith(ENTRY_PREFIX));
  if (hits.length === 0) return within((id) => id === PLAN_LIST_ID).slice(0, 1);
  const hit = hits.reduce((innermost, candidate) =>
    areaOf(args.droppableRects.get(candidate.id)) < areaOf(args.droppableRects.get(innermost.id))
      ? candidate
      : innermost,
  );
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
