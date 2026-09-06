// Vitest setup: pin the timezone to UTC so date helpers that read *local* calendar
// components (mondayOfDate, todayAsIsoDateString) are deterministic regardless of the
// host timezone. The dev container already runs in UTC; this makes tests reproducible
// anywhere.
process.env.TZ = 'UTC';

// React Testing Library's jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...).
// Harmless to import for non-component tests — it only extends `expect`, no DOM required
// until a matcher is actually called.
import '@testing-library/jest-dom/vitest';

// jsdom has no `PointerEvent`, and Base UI's controls (Checkbox, Button, Select …) construct
// one when they replay a click. Two test files already stubbed it per-file; now that the
// primitives are used across every migrated dialog (Phase 15), it belongs here once.
// `MouseEvent` is a faithful enough stand-in: the code only reads standard mouse modifiers
// off it. Only defined when missing, so the Node-environment tests are untouched and a real
// browser-grade environment keeps its own.
if (typeof globalThis.PointerEvent === 'undefined' && typeof globalThis.MouseEvent === 'function') {
  globalThis.PointerEvent = globalThis.MouseEvent as unknown as typeof globalThis.PointerEvent;
}
