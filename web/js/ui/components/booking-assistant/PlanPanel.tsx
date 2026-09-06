import * as React from 'react';
import { DndContext } from '@dnd-kit/core';
import { DragOverlay } from '@dnd-kit/core';
import { Inbox } from 'lucide-react';
import { Info } from 'lucide-react';
import { ScrollArea } from './primitives.tsx';
import { Tooltip } from './primitives.tsx';
import { TooltipContent } from './primitives.tsx';
import { TooltipTrigger } from './primitives.tsx';
import { planTargets } from './planTargeting.ts';
import { SECTION_LABEL_CLASS } from './styles.ts';
import { GroupMemberRow } from './PlanCards.tsx';
import { PlanCardContent } from './PlanCards.tsx';
import { PlanCard } from './PlanCards.tsx';
import { type AssistantState } from './useAssistantState.ts';

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
          eine <strong>Bedarfsgruppe</strong>, in der die Geräte austauschbar sind. Einzelne Geräte
          lassen sich wieder herausziehen.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
function PlanList({ state }: { state: AssistantState }) {
  const { plan, mergeTargetId, dropIndex, removeEntry, removeMember, setRequiredCount } = state;
  /* Die Einfügestelle ist die Fuge über der Karte an dieser Stelle — hinter der letzten
     Karte gibt es keine mehr, dort trägt sie die letzte Karte an ihrer Unterkante. */
  const indicatorFor = (index: number) => {
    if (dropIndex === index) return 'before' as const;
    if (dropIndex === plan.length && index === plan.length - 1) return 'after' as const;
    return undefined;
  };
  return (
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
              position={entry.kind === 'device' ? String(index + 1).padStart(2, '0') : undefined}
              mergeActive={mergeTargetId === entry.id}
              indicator={indicatorFor(index)}
              onRemoveEntry={removeEntry}
              onRemoveMember={removeMember}
              onRequiredCountChange={setRequiredCount}
            />
          ))}
        </ul>
      )}
    </ScrollArea>
  );
}
function PlanOverlay({ state }: { state: AssistantState }) {
  const { activeDrag, draggedEntry } = state;
  return (
    <DragOverlay dropAnimation={null}>
      {activeDrag?.type === 'entry' && draggedEntry && (
        <div className="rotate-[1.5deg]">
          <PlanCardContent
            overlay
            entry={draggedEntry}
            onRemoveEntry={() => {}}
            onRemoveMember={() => {}}
            onRequiredCountChange={() => {}}
          />
        </div>
      )}
      {activeDrag?.type === 'member' && (
        <div className="rotate-[1.5deg]">
          <GroupMemberRow overlay entryId={activeDrag.entryId} deviceId={activeDrag.deviceId} />
        </div>
      )}
    </DragOverlay>
  );
}
