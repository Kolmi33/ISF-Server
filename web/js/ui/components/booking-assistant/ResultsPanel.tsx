import { ChevronLeft } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { Badge } from './primitives.tsx';
import { Button } from './primitives.tsx';
import { ScrollArea } from './primitives.tsx';
import { SECTION_LABEL_CLASS } from './styles.ts';
import { ResultCard } from './ResultCard.tsx';
import { type AssistantState } from './useAssistantState.ts';

export function ResultsPanel({ state }: { state: AssistantState }) {
  const { setView, results, changeResultDays, onBook, onShowCalendar } = state;

  return (
    <div className="flex min-h-0 flex-[1_1_506px] flex-col border-t border-border">
      <div className="flex shrink-0 items-center gap-3 px-6 py-4 sm:px-7">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setView('select')}>
          <ChevronLeft className="size-4" />
          Zurück zur Auswahl
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <h2 className={SECTION_LABEL_CLASS}>Passende Termine</h2>
          <Badge variant="secondary">{results.length}</Badge>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 sm:px-7">
        {results.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center">
            <Inbox className="size-7 text-muted-foreground/60" />
            <p className="max-w-[30ch] text-sm text-muted-foreground">
              Kein Fenster gefunden, in dem alle Geräte gleichzeitig frei sind.
            </p>
          </div>
        ) : (
          <ScrollArea className="-mr-3 min-h-0 flex-1 pr-3">
            <ul className="flex flex-col gap-3">
              {results.map((window) => (
                <ResultCard
                  key={window.id}
                  window={window}
                  onSelectedDaysChange={changeResultDays}
                  onBook={(w) => onBook?.(w)}
                  onShowCalendar={onShowCalendar}
                />
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
