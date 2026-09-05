import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { cn } from 'cn';

// `appearance-none border-0 bg-transparent` is load-bearing, not defensive tidying: this app
// skips Tailwind's Preflight (see web/css/tailwind.css), so a bare <button>/<input> keeps the
// browser's own grey fill and 2px outset bevel unless the reset is spelled out here.
const STEPPER_BUTTON =
  'flex w-9 shrink-0 appearance-none items-center justify-center border-0 bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';

export interface NumberInputProps {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  className?: string;
  decrementLabel: string;
  incrementLabel: string;
}

/**
 * One segmented numeric control: decrement | input | increment, joined inside a single
 * bordered 36px-tall group so it lines up with the text inputs beside it (a hand-rolled
 * button+input+button trio drifted out of alignment because each part sized itself).
 * Integers only, clamped to `[min, max]`, with the decrement disabled at the floor.
 */
export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  className,
  decrementLabel,
  incrementLabel,
}: NumberInputProps) {
  return (
    <NumberFieldPrimitive.Root
      value={value}
      min={min}
      max={max}
      step={1}
      // A cleared input reports null — fall back to the floor rather than propagating an
      // empty value the search would then have to defend against.
      onValueChange={(next) => onValueChange(next ?? min)}
      data-slot="number-field"
      className={cn('inline-flex', className)}
    >
      <NumberFieldPrimitive.Group className="inline-flex h-9 items-stretch overflow-hidden rounded-lg border border-input bg-transparent dark:bg-input/30">
        <NumberFieldPrimitive.Decrement
          aria-label={decrementLabel}
          disabled={value <= min}
          className={STEPPER_BUTTON}
        >
          <IconMinus size={14} aria-hidden="true" />
        </NumberFieldPrimitive.Decrement>
        <NumberFieldPrimitive.Input className="w-12 appearance-none border-0 border-x border-solid border-input bg-transparent text-center text-sm tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
        <NumberFieldPrimitive.Increment
          aria-label={incrementLabel}
          disabled={value >= max}
          className={STEPPER_BUTTON}
        >
          <IconPlus size={14} aria-hidden="true" />
        </NumberFieldPrimitive.Increment>
      </NumberFieldPrimitive.Group>
    </NumberFieldPrimitive.Root>
  );
}
