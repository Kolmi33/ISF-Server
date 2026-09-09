# Booking editor and favorites verification plan

Status: complete (2026-09-09)

## 1. UI and data analysis

- [x] Inspect the supplied `BelegungsPlan.tsx`, booking UI guide and integration notes.
- [x] Trace the current booking card action, campaign view model, live store, mutation pipeline,
  machine availability and maintenance rules.
- [x] Trace favorites through persistence, main-grid grouping, filters and assistant lists.
- [x] Capture the current browser state and compare the finished editor against the supplied mockup.

## 2. Backend and domain mapping

- [x] Derive editor rows and occupied dates only from the selected real booking group/campaign.
- [x] Derive foreign occupancy, maintenance and weekday availability from the live backend state.
- [x] Keep group id/title, owner, note and timestamps when cells move or devices change.
- [x] Persist one atomic compare-and-set cell mutation through the existing `/api/mutate` path.

## 3. Favorites verification and fixes

- [x] Verify add/remove persistence, dedicated favorites group, category switching and filtering.
- [x] Ignore stale favorite IDs that no longer exist without breaking counts or empty states.
- [x] Verify the main filter and booking assistant use the same favorite set and real device IDs.

## 4. Booking editor implementation

- [x] Add a focused, testable schedule/diff reducer separate from the visual component.
- [x] Implement the supplied bar editor using existing shadcn-style buttons, dialog and tokens.
- [x] Support per-device move, start/end resize, day toggle and keyboard movement/resize.
- [x] Support whole-group shift, device reset, same-category replacement and device removal.
- [x] Connect `Bearbeiten` for owned, non-completed campaigns; keep foreign/completed/read-only
  campaigns view-only or disabled according to existing permissions.
- [x] Keep `Freien Termin suchen` as the bridge to the existing assistant preset.

## 5. Application states and edge cases

- [x] Prevent empty bookings, out-of-axis moves, duplicate devices and writes to past dates.
- [x] Prevent growth into maintenance, unavailable weekdays and foreign bookings.
- [x] Allow a move preview to show conflicts, then block save until all conflicts are resolved.
- [x] Handle sparse booking days, single-day bookings, mixed Maschinen/Messtechnik groups,
  deleted machines, long campaigns and changes arriving while the editor is open.
- [x] Show unchanged, pending, success, partial-conflict and backend-failure states without duplicate
  requests or premature dialog closure.

## 6. Tests

- [x] Unit-test real schedule construction, shifts/resizes/toggles, clamping, conflicts and diffs.
- [x] Unit-test atomic save generation, ownership checks, stale data and metadata preservation.
- [x] Component-test opening from the menu, row/group controls, save states and assistant fallback.
- [x] Extend favorites tests for stale IDs, category/filter behavior and persistence.
- [x] Run booking, grid, assistant and backend mutation regression suites.

## 7. Integration, build and deployment

- [x] Run formatting, TypeScript, lint, dead-code analysis and the full coverage suite.
- [x] Build frontend and server production artifacts.
- [x] Deploy through the existing Docker Compose workflow.
- [x] Verify favorites and the editor at desktop and narrow widths against live backend data,
  including keyboard access, browser console and network/health status.

## Completion record

- Quality gate: 79 test files, 1,047 tests; statement coverage 96.99% and branch coverage 92.19%.
- Production builds: Vite frontend and TypeScript server completed successfully.
- Backup confirmed before deployment: `/data/backups/buchungen_2026-09-09.db` (2,060,288 bytes).
- Deployment: `docker compose up -d --build`; container healthy at revision 36.
- Browser QA: 1400x950 and 760x900; main view, Meine Buchungen, editor, portalled device
  menu and favorites with a stale ID; no console/page errors. Live booking data was not mutated
  during visual QA; save success/failure and atomic rollback are covered by component/server tests.
