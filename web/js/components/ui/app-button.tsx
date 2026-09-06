import { forwardRef, type ComponentProps } from 'react';
import { cn } from 'cn';
import { Button as BaseButton } from './button.tsx';

/** The app's button: the shadcn/Base UI `Button` with this application's sizing and its one
 *  filled affirmative colour (`primary-deep`, which carries better contrast on white than
 *  `primary`). Heights: sm 32 · default 36 · lg 40 · icon 36 (docs/UI_STYLE_GUIDE.md §8). */
export const Button = forwardRef<HTMLButtonElement, ComponentProps<typeof BaseButton>>(
  function Button({ className, variant = 'default', size = 'default', ...props }, ref) {
    return (
      <BaseButton
        ref={ref}
        variant={variant}
        size={size}
        {...props}
        className={cn(
          'gap-2',
          size === 'default' && 'h-9 px-4',
          size === 'lg' && 'h-10 px-4',
          size === 'sm' && 'h-8 px-3',
          size === 'icon' && 'size-9',
          variant === 'default' && 'bg-primary-deep hover:bg-primary-deep/90',
          className,
        )}
      />
    );
  },
);
