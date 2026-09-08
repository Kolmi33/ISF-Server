# Main screen, filters and consolidated bookings — implementation plan

Status: completed and production-verified (2026-09-09)

## Visual finalization checklist

- [x] Preserve the verified grouped-booking/backend implementation in a checkpoint commit.
- [x] Re-audit the latest screenshot, `UI-Handbuch.md`, `occupancy-model_1.ts` and supplied React code.
- [x] Apply the exact warm-neutral/brand-green design tokens and Inter typography.
- [x] Match the reference shell, two-row toolbar, category corner, header heights, 300px label column,
  116px workday columns, 40px rows, scrollbar and legend proportions.
- [x] Replace per-person rainbow occupancy colors with semantic bars: own green, foreign neutral,
  maintenance/block orange; keep one separate rounded bar per resource row.
- [x] Use the existing shadcn-style Button, Checkbox, Popover/ScrollArea and tooltip primitives where
  the migrated React surfaces need interactive controls, without replacing backend behavior.
- [x] Add/update visual-semantic and interaction regression tests.
- [x] Run the complete quality gate and both production builds.
- [x] Deploy with the existing Docker Compose workflow and verify the live desktop/narrow layouts,
  filter, booking modes, menus, grid behavior and health endpoint.

## Reference and system findings

- The supplied screenshot and `UI-Handbuch.md` are the visual/interaction source of truth.
  `Maschinenbelegung.tsx` and `BookingsList.tsx`, named by the handoff, were not present in the
  supplied Downloads folder; the screenshot, handbook and domain/occupancy files cover their
  specified behavior.
- The production grid is already backed by `/api/state`, SSE and `/api/mutate`. Its React grid,
  selection engine, assistant handoff, grouped bookings, maintenance logic and persisted user
  preferences must be retained rather than replaced by the prototype's mock models.
- The current toolbar exposes separate machine/group filters plus separate “Meine Buchungen” and
  “Alle Buchungen” dialogs. The target has one “Filtern” control, one “Buchungen” dialog, a
  “Nur meine” grid switch and an overflow menu for secondary actions.
- The current all-bookings view groups by per-machine name runs and only includes future entries.
  The consolidated list must instead use the existing booking-group campaign projection for both
  own and foreign groups so cards, device categories, status and actions stay consistent.
- Identity is still the application's locally selected user name; the backend has no login/session
  role model. Existing mutation ownership/conflict rules and read-only mode remain authoritative.

## Checklist

### 1. UI analysis

- [x] Compare screenshot/handbook dimensions, hierarchy, typography, colors, grid, toolbar and
  responsive behavior with the current production screen.
- [x] Inventory every existing toolbar action and decide its target position without dropping it.

### 2. Backend and domain mapping

- [x] Confirm the live machine/booking/maintenance/category fields and universal `gid` invariant.
- [x] Build one group-based campaign projection for “Meine” and “Alle”, derived only from live state.
- [x] Keep ownership and destructive permissions tied to the current user and existing mutate path.

### 3. Main-screen shell

- [x] Recompose the two-row header to match the reference: title/navigation/month/user above;
  Assistant/Bookings/Filter and “Nur meine”/overflow below.
- [x] Move Statistics, Manage, Settings and Help into a functional overflow menu.
- [x] Preserve refresh, month navigation, category switcher, sticky grid and keyboard behavior.

### 4. Filter redesign and state

- [x] Replace the parallel machine/group dropdowns with one filter panel: search, multi-location,
  available in visible period, operational only and favorites only.
- [x] Persist established user preferences where appropriate; keep transient query/facets local.
- [x] Render removable active-filter chips, “clear all” and the visible/total device count.
- [x] Hide empty group headers and update their counts through the existing grid row derivation.

### 5. “Nur meine” grid mode

- [x] Add a real accessible switch and dim/hide foreign booking content without changing backend data.
- [x] Ensure live SSE updates, selection, booking blocks and own-booking accents remain correct.

### 6. Consolidated bookings dialog

- [x] Replace both toolbar entry points with one `BookingsModal` and “Meine | Alle” mode switch.
- [x] Reuse the existing campaign cards in both modes; add owner filter/chips and foreign-action rules
  in “Alle”.
- [x] Keep edit, repeat/template, cancellation, details, search, status filtering and live refresh
  functional according to ownership/read-only rules.
- [x] Remove the obsolete duplicate toolbar route; retain the legacy module only as a regression-tested
  compatibility surface while all user-facing access goes through the consolidated dialog.

### 7. Loading, empty and error states

- [x] Preserve stable application loading and backend failure handling.
- [x] Provide useful no-device/no-filter/no-booking states with reset or booking actions.
- [x] Preserve pending mutation locks, errors, undo and live invalidation behavior.

### 8. Responsive and visual verification

- [x] Match the reference’s dimensions, spacing, type weights, controls, borders, booking bars and
  sticky layers at desktop width.
- [x] Verify toolbar wrapping, filter panel, chips, modal tabs and grid access at narrow widths.

### 9. Tests

- [x] Add pure tests for combined facets, availability/health/favorite rules and own-booking mode.
- [x] Add component/integration tests for the new toolbar, overflow menu, filter panel/chips/reset and
  consolidated booking modes/actions/permissions.
- [x] Retain and adapt the existing grid, Assistant, My Bookings and All Bookings regression suites.

### 10. Integration and regression

- [x] Run focused tests, formatting, TypeScript, lint, dead-code analysis and complete coverage suite.
- [x] Build frontend/backend and verify booking creation, assistant, group actions, machine management,
  authentication/name flow, navigation, SSE and REST behavior.

### 11. Deployment

- [x] Create/confirm a current production database backup and deploy through existing Docker Compose.

### 12. Post-deployment verification

- [x] Verify health/state, desktop/mobile rendering, both booking modes, filters, “Nur meine”, overflow
  actions, console/network errors and absence of test residue in production.

## Completion record

- Quality gate: Prettier, TypeScript, ESLint and Knip passed; 77 test files and 1,029 tests passed.
  Coverage: 97.83% statements and 92.59% branches.
- Production builds: Vite frontend and TypeScript server builds passed in the existing Docker image.
- Backup: `/data/backups/buchungen_2026-09-08_pre_main_revamp.db` (1,892,352 bytes).
- Deployment: existing `docker compose up -d --build` workflow; container health is `healthy` and
  `/api/health` reports `{ ok: true, rev: 32 }` at final verification.
- Browser verification: production grid at 1400 × 800, desktop Chrome at 1296 × 770 and responsive
  640 × 800; filter panel, consolidated Meine/Alle dialog, three-action booking menu, owner filter,
  foreign read-only actions, overflow menu and exclusive category tabs were inspected against live
  state without mutating booking data. The headless desktop and narrow runs reported no console errors.

## Follow-up: full-width layout and device controls (2026-09-09)

- [x] Remove the 1,400 px content cap so the occupancy board uses the full available viewport width.
- [x] Increase desktop device labels to 16 px while retaining a readable 15 px mobile fallback.
- [x] Match the supplied segmented category control: 40 px container, two equal columns, 34 px
  buttons, neutral track and white active surface.
- [x] Run formatting, type checks and production frontend/backend builds.
- [x] Rebuild the existing Docker deployment and verify the healthy backend endpoint and both category
  control states in the browser.
