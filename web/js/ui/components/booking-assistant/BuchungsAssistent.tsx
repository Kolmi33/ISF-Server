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
      {/* The workspace fills the viewport; its middle scrolls while header and footer stay visible. */}
      <AppDialog
        size="xl"
        fullHeight
        labelledBy="buchungsassistent-title"
        className="booking-assistant"
      >
        <AssistantHeader onClose={state.onCancel} />
        {state.view === 'results' ? (
          <ResultsPanel state={state} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border md:flex-row">
            <CatalogPanel state={state} />
            <PlanPanel state={state} />
          </div>
        )}
        <AssistantFooter state={state} />
      </AppDialog>
    </DeviceProvider>
  );
}
