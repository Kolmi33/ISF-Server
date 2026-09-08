# Meine Buchungen — Backend integration plan

Status: complete (2026-09-08)

## Universal booking-group migration (2026-09-08)

Status: complete

- [x] Trace group creation through the booking form, in-memory reducer, `/api/mutate`, REST
  booking writes, SQLite imports, weekend bridges and the "Meine Buchungen" projection.
- [x] Define the migration rule: every booking operation creates one group; all device/day cells
  written by that operation share its `gid`. A one-device booking is therefore a one-member group.
- [x] Make the frontend booking reducer assign a group ID unconditionally.
- [x] Enforce the same invariant in the authoritative server mutation path and REST endpoints.
- [x] Preserve group membership for automatically generated weekend bridge cells.
- [x] Upgrade existing rows without a `gid` to stable legacy groups. Preserve consecutive workday
  runs for the same owner/device and their weekend bridges; do not guess cross-device relationships
  because legacy data did not persist them.
- [x] Ensure JSON imports are normalized to the same invariant.
- [x] Update unit/API/migration tests for single-device groups, multi-device shared groups and
  existing ungrouped data.
- [x] Run formatting, type checks, lint, focused tests, the full quality gate and production build.
- [x] Back up the production database, deploy with the existing workflow, then verify that no
  booking without a group ID remains and that creation/group actions still work.

Verification: a production-data copy migrated 12,309 legacy cells into 1,484 stable legacy
groups without changing the 12,621-cell total. Production now reports 0 ungrouped cells and 1,492
groups. Temporary REST writes verified a shared generated `gid` and adding a second device to an
existing one-device group; all test rows were deleted afterward. Desktop/mobile Playwright checks
reported no browser errors.

## System findings

- The supplied `MeineBuchungen.tsx` is the visual reference, but its `CAMPAIGNS`, device
  registry, statuses, maintenance conflicts, cancellation state and export action are demo-only.
- The authoritative application model is `bookings[machineId][ISO day] = Booking`, loaded from
  `/api/state` and kept fresh through SSE. A booking carries the entered user name, optional
  note, timestamp and optional `gid`/`gtitle`; machines already carry category and maintenance.
- The current user identity is the locally entered name. The application has no account/session
  authentication or role model. Existing server mutation rules and read-only mode are the only
  authorization boundary and must remain authoritative.
- Existing writes go through `window.mutate` → `/api/mutate` → `applyMutate`; own-cell deletion,
  conflict handling, revision/CAS behavior, activity logging, SSE updates and undo already use
  this path.
- The backend has no persisted cancelled-booking state, campaign entity, campaign PATCH or report
  endpoint. The production UI must therefore not fabricate cancelled history, editing, or report
  downloads. “Stornieren” maps to confirmed deletion of the user's still-existing cells.
- Application initial loading and fatal-load errors are handled before the toolbar becomes usable.
  Mutation errors are surfaced by the shared mutation/toast flow. The modal subscribes to live
  store state so successful local or remote mutations refresh without stale snapshots.

## Implementation checklist

### 1. UI analysis

- [x] Compare supplied overview markup, hierarchy, cards, tabs, search, empty state and actions
  with the current modal and shared design system.
- [x] Identify demo-only UI behavior and fields.
- [x] Preserve the supplied header, muted content surface, status tabs, searchable campaign cards,
  expansion details, overflow actions, spacing and responsive wrapping using repository primitives.

### 2. Backend/API mapping

- [x] Inspect `/api/state`, SSE, `/api/mutate`, REST booking endpoints and SQLite schema.
- [x] Map real multi-machine `gid` groups to campaign cards and ungrouped consecutive bookings to
  stable single-resource cards.
- [x] Derive statuses from real ISO days relative to today (`aktiv`, `geplant`, `abgeschlossen`).
- [x] Resolve all resource labels/categories/maintenance data from shared `Machine` records.

### 3. Missing functionality

- [x] Record unsupported persisted cancellation history, report export and campaign PATCH.
- [x] Remove/omit unsupported controls instead of wiring placeholders.
- [x] Reuse plan navigation as the supported edit/view path and the Assistant for new bookings.

### 4. Component rewiring

- [x] Replace future-only run rendering with real campaign aggregation across past/current/future.
- [x] Wire new booking, expand/details, plan navigation and confirmed cancellation.
- [x] Keep machine IDs as the only joins; do not copy the supplied demo registry/types.

### 5. State management

- [x] Subscribe the modal to the existing store and derive view data from current server state.
- [x] Keep only UI state locally (tab, search, expansion, pending cancellation).
- [x] Avoid frozen booking snapshots and duplicate API/domain state.

### 6. Loading/error/empty states

- [x] Preserve application-level initial loading/error handling.
- [x] Add polished no-bookings and no-filter-results states with a reset/new-booking escape.
- [x] Surface mutation failures via the existing shared flow and always clear pending state.

### 7. Booking actions

- [x] New booking opens the existing Assistant.
- [x] Editing/viewing navigates to the real calendar booking and closes the modal.
- [x] Cancellation confirms, prevents duplicate submission, deletes only current user's live cells,
  offers undo and refreshes from store truth.
- [x] Respect read-only mode and never show a destructive action that cannot succeed.

### 8. Responsive behavior

- [x] Preserve fixed status/action alignment on desktop and intentional stacking on narrow widths.
- [x] Retain bounded list scrolling at desktop, short-height and 520px mobile viewports.

### 9. Tests

- [x] Add pure view-model coverage for ownership, grouping, status/date boundaries, metadata,
  searching/filtering and stable ordering.
- [x] Add component/integration coverage for empty/filter states, expansion, plan navigation,
  successful/failed/pending/declined cancellation, live refresh and read-only restrictions.

### 10. Integration testing

- [x] Run focused Vitest suites, then the repository quality gate.
- [x] Exercise no/one/many bookings, mixed statuses and network/mutation error behavior.

### 11. Deployment

- [x] Build frontend and server production artifacts.
- [x] Use the existing Docker Compose production workflow only after the gate is green.

### 12. Post-deployment verification

- [x] Check health/state endpoints, current-name flow, real booking data, actions, console and failed
  requests on desktop and narrow viewports without creating destructive test data.
- [x] Record exact verification evidence and remaining backend limitations in the final report.

## Verification evidence

- `npm run verify`: 76 test files and 1,018 tests passed; formatting, TypeScript, ESLint,
  dead-code analysis and coverage passed.
- Focused booking suites: 36 tests passed.
- Frontend Vite build and server TypeScript build passed.
- Existing production Compose workflow rebuilt and restarted the application successfully.
- `/api/health`: `ok: true`, revision 15; `/api/state`: 245 machines and booking data for
  191 machines.
- Playwright screenshots passed without console/page errors for desktop light/dark, mobile,
  populated bookings and a fresh empty-bookings identity.
- Follow-up production verification confirms the Inter default font, absent top maintenance
  banner, fixed two-column device details, non-duplicated named titles, hidden technical IDs for
  named groups and a visible action menu that no longer dismisses the dialog.
- The final menu matches the supplied action hierarchy: edit opens the existing plan, repeat
  opens the Assistant with the campaign's real device IDs and fixed duration from next Monday,
  and cancellation remains separated as the destructive action.
