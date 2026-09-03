// =======================================================================================
// WRITE-COLLISION BANNER MODULE (web/js/ui/collision-banner.ts)
// =======================================================================================
//
// The write-collision banner: a persistent, manual-dismiss-only notice shown when the
// server reports a partial write conflict (someone else's change landed on the same cell
// first, before this client's write went through).
//
// Key Principles:
// - PLAIN MODULE, NOT REACT: `#collBanner` is fully static markup already in `index.html`;
//   only its `.show` class ever toggles, so there's no dynamic shape to render — a
//   component would add ceremony without buying anything here.
//
// =======================================================================================

/** Shows the collision banner — called directly by `ui/mutate.ts`'s `persist()` whenever
 *  the server reports conflicts on a write. */
export function showCollisionBanner(): void {
  document.getElementById('collBanner')!.classList.add('show');
}

function hideCollisionBanner(): void {
  document.getElementById('collBanner')!.classList.remove('show');
}

/** Wires the banner's "Verstanden" dismiss button. Called once at boot. */
export function initCollisionBanner(): void {
  document.getElementById('collOk')!.onclick = hideCollisionBanner;
}
