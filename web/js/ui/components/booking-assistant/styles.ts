export const LABEL_CLASS =
  'text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-muted-foreground';
export const SECTION_LABEL_CLASS =
  'text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground';

/* Rahmen der drei Fußzeilen-Blöcke: unsichtbar im Ruhezustand, beim Hover
   erscheint eine Umrandung (alle drei exakt gleich hoch). */
export const FOOTER_SHELL = 'h-[68px] shrink-0 rounded-lg border transition-colors';
export const FOOTER_SHELL_IDLE = 'border-transparent hover:border-border hover:bg-background';
export const FOOTER_SHELL_ACTIVE = 'border-primary/50 bg-background shadow-sm';
