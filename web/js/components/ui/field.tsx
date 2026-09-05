import { Field as FieldPrimitive } from '@base-ui/react/field';
import { cn } from 'cn';

/** Label → control → description/error, with a single consistent vertical rhythm. Base UI
 *  wires the label's `htmlFor`, the description's `aria-describedby`, and `aria-invalid`
 *  onto whichever control the field contains, so no hand-managed ids are needed. */
function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      className={cn('flex min-w-0 flex-col gap-2', className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn('text-sm font-medium text-foreground', className)}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Field, FieldLabel, FieldDescription };
