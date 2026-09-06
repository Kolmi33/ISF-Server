import { TooltipProvider } from './primitives.tsx';
import { DeviceProvider } from './DeviceProvider.tsx';
import { type BuchungsAssistentProps } from './useAssistantState.ts';
import { useAssistantState } from './useAssistantState.ts';
import { AssistantHeader } from './AssistantHeader.tsx';
import { ResultsPanel } from './ResultsPanel.tsx';
import { CatalogPanel } from './CatalogPanel.tsx';
import { PlanPanel } from './PlanPanel.tsx';
import { AssistantFooter } from './AssistantFooter.tsx';

export function BuchungsAssistent(props: BuchungsAssistentProps) {
  const state = useAssistantState(props);
  return (
    <DeviceProvider catalog={props.catalog}>
      <TooltipProvider delayDuration={150}>
        <div className="booking-assistant flex w-full items-center justify-center">
          {/* Der Dialog ist so hoch wie sein Inhalt, aber nie höher als das Fenster: die Mitte
              schrumpft (siehe ihr `flex-[1_1_506px]`), Kopf und Fußzeile bleiben stehen. Sonst
              rutschte die Fußzeile auf niedrigen Fenstern aus dem Bild. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="buchungsassistent-title"
            className="relative flex max-h-[calc(100dvh_-_32px)] w-full max-w-[1040px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            <AssistantHeader state={state} />
            {state.view === 'results' ? (
              <ResultsPanel state={state} />
            ) : (
              <div className="flex min-h-0 flex-[1_1_506px] flex-col border-t border-border md:flex-row">
                <CatalogPanel state={state} />
                <PlanPanel state={state} />
              </div>
            )}
            <AssistantFooter state={state} />
          </div>
        </div>
      </TooltipProvider>
    </DeviceProvider>
  );
}
