import { AppDialog } from '../app/AppDialog.tsx';
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
      {/* Der Dialog ist so hoch wie sein Inhalt, aber nie höher als das Fenster: die Mitte
          schrumpft (siehe ihr `flex-[1_1_506px]`), Kopf und Fußzeile bleiben stehen. Sonst
          rutschte die Fußzeile auf niedrigen Fenstern aus dem Bild. Die `booking-assistant`-
          Klasse trägt nur noch die Fußzeilen-Regeln (web/css/booking-assistant.css). */}
      <AppDialog size="xl" labelledBy="buchungsassistent-title" className="booking-assistant">
        <AssistantHeader />
        {state.view === 'results' ? (
          <ResultsPanel state={state} />
        ) : (
          <div className="flex min-h-0 flex-[1_1_506px] flex-col border-t border-border md:flex-row">
            <CatalogPanel state={state} />
            <PlanPanel state={state} />
          </div>
        )}
        <AssistantFooter state={state} />
      </AppDialog>
    </DeviceProvider>
  );
}
