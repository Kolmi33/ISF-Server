import { Separator as SeparatorPrimitive } from '@base-ui/react/separator';
import { cn } from 'cn';

/** A themed rule, replacing hand-rolled `border-top` divs so every divider in the app reads
 *  the same and carries the right (decorative) semantics. */
export function Separator({ className, ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className,
      )}
      {...props}
    />
  );
}
