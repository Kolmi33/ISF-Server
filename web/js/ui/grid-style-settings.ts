/** Lightweight boot-time grid style setters, kept separate from the Settings modal chunk. */
export function applyGridlineWidth(px: number): void {
  document.documentElement.style.setProperty('--gridline-width', `${px}px`);
}

export function applyGridlineWidthHeader(px: number): void {
  document.documentElement.style.setProperty('--gridline-width-header', `${px}px`);
}
