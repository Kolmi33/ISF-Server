// The write-collision banner (Phase 7 slice B8): a persistent, manual-dismiss-only notice shown
// when the server reports a partial write conflict (someone else's change landed on the same
// cell first). Faithful port of legacy `showCollision` + the `#collOk` click wiring. Kept a
// plain module rather than a React component — `#collBanner` is fully static markup already in
// index.html; only the `.show` class toggles, so there's no dynamic shape to render.

/** Show the collision banner. Faithful port of legacy `showCollision`; called by the still-
 *  legacy `persist()` when the server reports conflicts. */
export function showCollisionBanner(): void {
  document.getElementById('collBanner')!.classList.add('show');
}

function hideCollisionBanner(): void {
  document.getElementById('collBanner')!.classList.remove('show');
}

/** Wire the banner's "Verstanden" dismiss button. Called once at boot. */
export function initCollisionBanner(): void {
  document.getElementById('collOk')!.onclick = hideCollisionBanner;
}

// ---- Legacy bridge alias ----------------------------------------------------------
// `legacy.js`'s still-unported `persist()` calls this by its OLD name (`showCollision`) as a
// bare global; it is deliberately NOT edited by this pass — deleted whole in Phase 7 slice B10.
// Delete this alias in that slice.
export const showCollision = showCollisionBanner;
