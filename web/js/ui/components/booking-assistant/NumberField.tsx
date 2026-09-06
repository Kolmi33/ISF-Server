import * as React from 'react';
import { Minus } from 'lucide-react';
import { Plus } from 'lucide-react';
import { cn } from 'cn';
import { Button } from './primitives.tsx';
import { Input } from './primitives.tsx';
import { Label } from './primitives.tsx';
import { LABEL_CLASS } from '../app/typography.ts';

export type LimitEdge = 'upper' | 'lower';

export interface NumberInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  ariaLabel: string;
  /** Kompakte Variante für die Kopfzeile einer Bedarfsgruppe */
  compact?: boolean;
  /** Wird gerufen, wenn der Nutzer über die Grenze hinaus will */
  onLimit?: (edge: LimitEdge) => void;
}

export function NumberInput({
  id,
  value,
  onChange,
  min = 1,
  max = 90,
  ariaLabel,
  compact = false,
  onLimit,
}: NumberInputProps) {
  const { draft, setDraft, atMin, atMax, step, commit } = useNumberDraft({
    value,
    onChange,
    min,
    max,
    onLimit,
  });

  const iconSize = compact ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-disabled={atMin}
        aria-label={`${ariaLabel} verringern`}
        onClick={() => step(-1)}
        className={cn('shrink-0 rounded-md', compact ? 'size-6' : 'size-8', atMin && 'opacity-50')}
      >
        <Minus className={iconSize} />
      </Button>

      <NumberDraft
        id={id}
        ariaLabel={ariaLabel}
        compact={compact}
        draft={draft}
        setDraft={setDraft}
        commit={commit}
        step={step}
      />

      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-disabled={atMax}
        aria-label={`${ariaLabel} erhöhen`}
        onClick={() => step(1)}
        className={cn('shrink-0 rounded-md', compact ? 'size-6' : 'size-8', atMax && 'opacity-50')}
      >
        <Plus className={iconSize} />
      </Button>
    </div>
  );
}

/** NumberInput mit zentriert darüberstehendem Label. */
export function NumberField({
  label,
  ...props
}: Omit<NumberInputProps, 'id' | 'ariaLabel'> & { label: string }) {
  const id = React.useId();
  return (
    <div className="flex flex-col items-center gap-2">
      <Label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </Label>
      <NumberInput id={id} ariaLabel={label} {...props} />
    </div>
  );
}
function useNumberDraft({
  value,
  onChange,
  min = 1,
  max = 90,
  onLimit,
}: Omit<NumberInputProps, 'ariaLabel'>) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);

  const atMin = value <= min;
  const atMax = value >= max;

  const step = (delta: number) => {
    if (delta > 0 && atMax) return onLimit?.('upper');
    if (delta < 0 && atMin) return onLimit?.('lower');
    onChange(value + delta);
  };

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return setDraft(String(value));
    if (parsed > max) onLimit?.('upper');
    if (parsed < min) onLimit?.('lower');
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
    setDraft(String(clamped));
  };

  return { draft, setDraft, atMin, atMax, step, commit };
}
function NumberDraft({
  id,
  ariaLabel,
  compact,
  draft,
  setDraft,
  commit,
  step,
}: Pick<NumberInputProps, 'id' | 'ariaLabel' | 'compact'> &
  Pick<ReturnType<typeof useNumberDraft>, 'draft' | 'setDraft' | 'commit' | 'step'>) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={(e) => commit(e.target.value)}
      /* verhindert, dass ein Klick ins Feld einen Drag der Karte startet */
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(e.currentTarget.value);
          e.currentTarget.blur();
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          step(1);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          step(-1);
        }
      }}
      className={cn(
        'shrink-0 px-1 text-center font-mono font-semibold tabular-nums',
        compact ? 'h-6 w-11 text-[13px]' : 'h-8 w-12 text-sm',
      )}
    />
  );
}
