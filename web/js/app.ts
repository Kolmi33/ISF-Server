// Clean ES-module entry point for the reworked frontend.
//
// It runs BEFORE the legacy monolith (index.html loads this as `type="module"`,
// which — together with legacy.js being `defer` — executes it first, in document
// order, after parsing). Its job during the strangler-fig transition: re-export
// each extracted module's public functions onto `window`, so the not-yet-extracted
// code in legacy.js (which calls them as bare globals) keeps resolving unchanged.
//
// As modules are carved out of legacy.js, they are imported here and bridged. When
// legacy.js reaches zero (Phase 5), the bridge is deleted and this becomes the real
// boot/orchestration entry.

import * as dates from './core/dates.ts';

// Bridge extracted pure modules onto the global scope for the legacy layer.
Object.assign(window, dates);
