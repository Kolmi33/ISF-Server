import * as React from 'react';
import { DndContext } from '@dnd-kit/core';
import { DragOverlay } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { Inbox } from 'lucide-react';
import { Info } from 'lucide-react';
import { ScrollArea } from './primitives.tsx';
import { Tooltip } from './primitives.tsx';
import { TooltipContent } from './primitives.tsx';
import { TooltipTrigger } from './primitives.tsx';
import { PLAN_LIST_ID } from './plan-tree.ts';
import { planTargets } from './planTargeting.ts';
import { SECTION_LABEL_CLASS } from './styles.ts';
import { PlanCard } from './PlanCards.tsx';
import { PlanCardPreview } from './PlanCards.tsx';
import { type AssistantState } from './useAssistantState.ts';
import { type PlanEntry } from '../../../core/booking-assistant-types.ts';

export function PlanPanel({ state }: { state: AssistantState }) {
  const { sensors, handleDragStart, handleDragOver, handleDragEnd, cancelDrag } = state;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-6 py-5 sm:px-7 md:basis-1/2">
      <PlanHeading />

      <DndContext
        sensors={sensors}
        collisionDetection={planTargets}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={cancelDrag}
      >
        <PlanList state={state} />

        {/* Die Karte selbst reist mit dem Zeiger — nicht nur ein Platzhalter. */}
        <PlanOverlay state={state} />
      </DndContext>
    </div>
  );
}
function PlanHeading() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <h2 className={SECTION_LABEL_CLASS}>Ausgewählte Geräte</h2>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Hinweis zu Bedarfsgruppen"
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[19rem]">
          Links Geräte auswählen, dann hier per Drag &amp; Drop übereinander ziehen — daraus wird
          eine <strong>Bedarfsgruppe</strong>, in der die Geräte austauschbar sind. Eine Gruppe auf
          eine andere gezogen wird deren Mitglied: so entsteht „entweder das eine Gerät oder diese
          zwei zusammen". Alles lässt sich wieder herausziehen.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
function PlanList({ state }: { state: AssistantState }) {
  const { plan, mergeTargetId, preview, removeEntry, dissolveGroup, setRequiredCount } = state;
  const listArea = useDroppable({ id: PLAN_LIST_ID });
  /* Die Marke sitzt an dem Eintrag, neben den die Karte rückt — beim Anhängen an die
     letzte Karte der obersten Ebene. */
  const marker =
    preview?.kind === 'insert'
      ? ([preview.targetId, preview.side] as const)
      : preview?.kind === 'append' && plan.length > 0
        ? ([plan[plan.length - 1]!.id, 'after'] as const)
        : null;
  const positions = planPositionLabels(plan);
  return (
    /* Auffangfläche: alles unterhalb der Überschrift, was keine Karte ist. Ein Gerät hier
       loszulassen löst es aus seiner Bedarfsgruppe und hängt es hinten an — dafür muss
       niemand eine Fuge treffen. Bewusst als Flex-Kind bemessen und nicht über eine
       Prozenthöhe, damit die Fläche unter der letzten Karte sicher dazugehört. */
    <div ref={listArea.setNodeRef} className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="-mr-3 min-h-0 flex-1 pr-3">
        {plan.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
            <Inbox className="size-7 text-muted-foreground/60" />
            <p className="max-w-[26ch] text-sm text-muted-foreground">Noch nichts ausgewählt.</p>
          </div>
        ) : (
          /* Kein `gap`: den Abstand trägt jede Karte selbst, damit die Drop-Ziele die Liste
           lückenlos kacheln (siehe `planTargeting.ts`). */
          <ul className="flex flex-col">
            {plan.map((entry, index) => (
              <PlanCard
                key={entry.id}
                entry={entry}
                position={positions[index]}
                mergeTargetId={mergeTargetId}
                marker={marker}
                onRemoveEntry={removeEntry}
                onDissolveGroup={dissolveGroup}
                onRequiredCountChange={setRequiredCount}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

/** A group occupies one visible plan position for every required alternative. */
export function planPositionLabels(plan: PlanEntry[]): string[] {
  let nextPosition = 1;
  return plan.map((entry) => {
    const count = entry.kind === 'group' ? entry.requiredCount : 1;
    const positions = Array.from({ length: count }, () => String(nextPosition++).padStart(2, '0'));
    return positions.join(', ');
  });
}
function PlanOverlay({ state }: { state: AssistantState }) {
  const { draggedEntry } = state;
  return (
    <DragOverlay dropAnimation={null}>
      {draggedEntry && <PlanCardPreview entry={draggedEntry} />}
    </DragOverlay>
  );
}
