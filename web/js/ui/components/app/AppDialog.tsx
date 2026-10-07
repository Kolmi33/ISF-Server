// =======================================================================================
// APP DIALOG (web/js/ui/components/app/AppDialog.tsx)
// =======================================================================================
//
// The dialog frame every secondary window uses, lifted verbatim out of the Buchungsassistent
// (docs/UI_STYLE_GUIDE.md §7). One mechanism, so sizing, radius, scroll containment and the
// `#modal` overrides can never drift between two windows.
//
// Layout contract: the sheet is as tall as its content, capped at the viewport; the header
// and footer are `shrink-0` and the body is the only thing that shrinks and scrolls. Never
// let the sheet itself scroll — the footer has to stay reachable on a short window.
//
// =======================================================================================

import { useLayoutEffect, type ReactNode } from 'react';
import { cn } from 'cn';
import { TooltipProvider } from '../../../components/ui/tooltip.tsx';

export type AppDialogSize = 'sm' | 'md' | 'lg' | 'xl';

/** sm prompts · md forms (the legacy `#modal` width) · lg lists · xl the Assistant/statistics. */
export function AppDialog({
  size = 'md',
  fullHeight = false,
  labelledBy,
  className,
  children,
}: {
  size?: AppDialogSize;
  /** Fill the available viewport for workspaces with a flexible scrolling body. */
  fullHeight?: boolean;
  /** id of the `AppDialogHeader` title that names this dialog. */
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  // AppDialog is the single source of truth for the portal host's semantic size. This avoids
  // coupling legacy `#modal` sizing to rendered descendants via CSS `:has()`.
  useLayoutEffect(() => {
    const modal = document.getElementById('modal');
    const overlay = document.getElementById('overlay');
    if (!modal || !overlay) return;
    modal.dataset.dialogSize = size;
    overlay.dataset.reactDialog = '';
    return () => {
      if (modal.dataset.dialogSize === size) delete modal.dataset.dialogSize;
      delete overlay.dataset.reactDialog;
    };
  }, [size]);

  return (
    /* `ui-scope` sits on the outer wrapper because it is `#modal`'s direct child — that is
       what the `#modal:has(> .ui-scope)` chrome override keys off (web/css/ui-scope.css). */
    <div className="ui-scope flex w-full items-center justify-center">
      <TooltipProvider delayDuration={150}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          className={cn(
            'relative flex max-h-[calc(100dvh_-_32px)] w-full max-w-none flex-col overflow-hidden rounded-2xl border border-border bg-card',
            fullHeight && 'h-[calc(100dvh_-_32px)]',
            className,
          )}
        >
          {children}
        </div>
      </TooltipProvider>
    </div>
  );
}

export function AppDialogHeader({
  icon,
  title,
  titleId,
  subtitle,
  actions,
}: {
  /** A Lucide icon at `size-6`; it sits in the tinted tile. */
  icon: ReactNode;
  title: ReactNode;
  titleId: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-start gap-4 px-6 py-5 sm:px-7 sm:py-6">
      <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-deep">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h1
          id={titleId}
          className="text-[22px] font-semibold leading-tight tracking-tight text-foreground"
        >
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

/** The scrolling middle. Its children get the panel rhythm (`gap-4`); a long list inside
 *  belongs in a `ScrollArea` with the `-mr-3 … pr-3` gutter, not in this element's overflow. */
export function AppDialogBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-4 border-t border-border px-6 py-5 sm:px-7',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The action band. Put secondary information first and the actions in an `ml-auto` group. */
export function AppDialogFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <footer
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-muted/50 px-6 py-4 sm:px-7',
        className,
      )}
    >
      {children}
    </footer>
  );
}
