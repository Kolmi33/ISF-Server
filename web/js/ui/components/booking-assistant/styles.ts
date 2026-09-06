/* Rahmen der drei Fußzeilen-Blöcke: unsichtbar im Ruhezustand, beim Hover
   erscheint eine Umrandung (alle drei exakt gleich hoch). Nur der Assistent hat diese
   Fußzeile — deshalb bleiben diese drei hier und wandern nicht in das gemeinsame Kit. */
export const FOOTER_SHELL = 'h-[68px] shrink-0 rounded-lg border transition-colors';
export const FOOTER_SHELL_IDLE = 'border-transparent hover:border-border hover:bg-background';
export const FOOTER_SHELL_ACTIVE = 'border-primary/50 bg-background shadow-sm';
