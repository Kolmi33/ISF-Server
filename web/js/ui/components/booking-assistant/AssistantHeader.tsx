import { FlaskConical } from 'lucide-react';
import { X } from 'lucide-react';
import { Button } from './primitives.tsx';
import { type AssistantState } from './useAssistantState.ts';

export function AssistantHeader({ state }: { state: AssistantState }) {
  const { onClose } = state;

  return (
    <header className="flex shrink-0 items-start gap-4 px-6 py-5 sm:px-7 sm:py-6">
      <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-deep">
        <FlaskConical className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <h1
          id="buchungsassistent-title"
          className="text-[22px] font-semibold leading-tight tracking-tight text-foreground"
        >
          Buchungsassistent
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Laborgeräte reservieren</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dialog schließen"
        onClick={onClose}
        className="-mr-1 rounded-lg"
      >
        <X className="size-5" />
      </Button>
    </header>
  );
}
