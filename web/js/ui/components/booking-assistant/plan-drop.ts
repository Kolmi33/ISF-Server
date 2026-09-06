// =======================================================================================
// WAS EIN ABLEGEN BEDEUTET (web/js/ui/components/booking-assistant/plan-drop.ts)
// =======================================================================================
//
// Eine Regel, in beide Richtungen gelesen: **auf einen Eintrag gelegt heißt "werde sein
// Mitglied", zwischen zwei Einträge gelegt heißt "stell dich dazwischen"**. Aus ihr folgt
// alles Weitere von selbst — auch die Bedarfsgruppe in der Bedarfsgruppe: zieht man eine
// Gruppe auf eine andere, wird sie deren Mitglied, statt sich in ihr aufzulösen.
//
// `planDrop` beantwortet die Frage einmal, und beide Seiten fragen dieselbe Funktion: die
// Anzeige während des Ziehens und die Änderung beim Loslassen. Die Marke kann deshalb nichts
// versprechen, was das Ablegen dann anders macht.
//
// =======================================================================================

import { type PlanEntry } from '../../../core/booking-assistant-types.ts';
import { PLAN_LIST_ID } from './plan-tree.ts';
import { addMember } from './plan-tree.ts';
import { entryContains } from './plan-tree.ts';
import { entryIdOf } from './plan-tree.ts';
import { findEntry } from './plan-tree.ts';
import { insertBeside } from './plan-tree.ts';
import { normalizePlan } from './plan-tree.ts';
import { withoutEntry } from './plan-tree.ts';

/** Wohin ein Zug innerhalb des getroffenen Eintrags zielt: auf ihn drauf (gruppieren) oder
 *  in die Fuge davor bzw. dahinter (einreihen). */
export type DropZone = 'before' | 'merge' | 'after';

/** Was ein Ablegen an dieser Stelle bewirken würde. `null` = der Zug ändert nichts, dann
 *  zeigt die Liste auch keine Marke. */
export type DropPlan =
  | { kind: 'merge'; targetId: string }
  | { kind: 'insert'; targetId: string; side: 'before' | 'after' }
  | { kind: 'append' };

export function planDrop(
  plan: PlanEntry[],
  sourceId: string,
  overId: string,
  zone: DropZone,
): DropPlan | null {
  const moving = findEntry(plan, sourceId);
  if (!moving) return null;
  /* Die freie Fläche unter den Karten ist die letzte Fuge der obersten Ebene — dort
     loslassen heißt "raus damit", ohne eine Fuge treffen zu müssen. */
  if (overId === PLAN_LIST_ID)
    return plan[plan.length - 1]?.id === sourceId ? null : { kind: 'append' };
  const targetId = entryIdOf(overId);
  if (!targetId || !findEntry(plan, targetId)) return null;
  /* Nichts kann in sich selbst oder in eines seiner eigenen Mitglieder wandern. */
  if (entryContains(moving, targetId)) return null;
  if (zone === 'merge') return { kind: 'merge', targetId };
  const side = zone === 'after' ? 'after' : 'before';
  /* Die Fugen unmittelbar vor und hinter dem Eintrag sind sein eigener Platz. */
  return neighbourOf(plan, targetId, side) === sourceId ? null : { kind: 'insert', targetId, side };
}

/** Der Eintrag, der auf derselben Ebene direkt vor bzw. hinter `targetId` steht. */
function neighbourOf(plan: PlanEntry[], targetId: string, side: 'before' | 'after'): string | null {
  const index = plan.findIndex((entry) => entry.id === targetId);
  if (index >= 0) return plan[side === 'after' ? index + 1 : index - 1]?.id ?? null;
  for (const entry of plan)
    if (entry.kind === 'group') {
      const hit = neighbourOf(entry.members, targetId, side);
      if (hit) return hit;
    }
  return null;
}

/** Führt aus, was `planDrop` angekündigt hat. */
export function applyDrop(plan: PlanEntry[], sourceId: string, drop: DropPlan): PlanEntry[] {
  const moving = findEntry(plan, sourceId);
  if (!moving) return plan;
  const rest = withoutEntry(plan, sourceId);
  if (drop.kind === 'append') return normalizePlan([...rest, moving]);
  if (drop.kind === 'merge') return normalizePlan(addMember(rest, drop.targetId, moving));
  return normalizePlan(insertBeside(rest, drop.targetId, drop.side, moving));
}
