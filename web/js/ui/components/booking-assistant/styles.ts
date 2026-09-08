/* Gemeinsame Geometrie für Zeitraum und Tagessteuerung. Nur der klickbare Zeitraum
   erhält im Ruhezustand eine Hover-Fläche; Tagessteuerung und Aktionen bleiben neutral. */
export const FOOTER_SHELL = 'h-[68px] shrink-0 rounded-lg border transition-colors';
export const FOOTER_SHELL_IDLE = 'border-transparent hover:border-border hover:bg-background';
export const FOOTER_SHELL_ACTIVE = 'border-primary/50 bg-background';
