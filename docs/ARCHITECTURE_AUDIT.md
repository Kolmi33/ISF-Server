# Architecture Audit — 2026-09-01

Started as a pre-implementation audit, requested separately from any refactor work — at that
point nothing in it had been acted on; it was a map of the current system and a set of
proposed, incremental improvements, gated on review before any code moved. **That gate has
since been cleared for almost everything here**: see §10/§11 for the current status —
F1–F9 are all done (each its own reviewed, verified commit), F10 was checked and correctly
left alone, and only F7's full-merge option remains open by design. The individual write-ups
below are kept in their original (pre-implementation) tense as the record of what was
proposed, with an "Update" note appended inline wherever the outcome differs from or extends
the original proposal. Method: read every governing doc/config fresh, enumerate the full
source tree, grep every non-test `import` and `export` statement to build the real
dependency/export graph, and verify every suspected duplication/dead-code claim against
actual call sites rather than filenames or guesses (per the original request: "do not remove
code simply because it looks similar").

Scope note up front: `ARCHITECTURE.md §18` records that Phase 7 (the React migration)
deliberately reused `core/`, `net/`, `state.ts` and the pre-existing `ui/*` modules
**unchanged** — a view-layer swap, not a redesign. That's a strong signal the original
`core → net → ui` split is sound. This audit finds that to be true: no core/net boundary
violation exists anywhere in the tree (confirmed by grep, not just by the lint rule that
would catch it). The drift this audit *does* find is concentrated in code that's newer
than that split: the `app.ts` window-bridge (grown, not shrunk, across Phase 7), a few
functions that outgrew their original home, and one small piece of duplicated date logic
that the team already flagged twice before and correctly deferred.

---

## 1. Current architecture

**Shape.** A zero-runtime-dependency Node/TypeScript backend (`server/`) serves a
SQLite-backed REST + SSE API; a TypeScript/React frontend (`web/js/`) consumes it. A
`shared/types.ts` contract (`Machine`, `Booking`, `AppState`, wire types, …) is imported
by both sides — the only cross-boundary coupling, and it's one-directional (backend never
imports frontend code or vice versa; confirmed, zero such imports exist).

**Backend.** `server/server.ts` is the impure HTTP/SSE shell (routing, static file
serving, daily backup). All actual logic is pure and unit-tested: `db.ts` (schema/import),
`model.ts` (row → wire-shape read model), `mutate.ts` (the single write path — every
booking/admin change is validated and applied here, client input is never trusted),
`bridge.ts` (the weekend auto-bridge invariant, both directions: `core/weekend.ts`'s
client-side *sweep* removes orphaned Sat/Sun on write, `bridge.ts`'s server-side *maintain*
adds them back when a Fri→Mon span completes — deliberately separate, see §6).

**Frontend.** `web/js/app.ts` is the sole entry point. It:
1. Hydrates `AppState` from `localStorage` + today's date (`hydrateState`).
2. Creates the store (`state.ts`'s `createStore`) and binds it to `window.S`.
3. Mounts **four independent React roots** (`Grid`, `ContextMenu`,
   `MachineFilterDropdown`, `GroupFilterDropdown`) — not one component tree.
4. Wires ~10 top-level DOM handlers imperatively (toolbar buttons, user chip, boot).
5. Imports **43 modules** as namespaces and `Object.assign`s every one of them onto
   `window`, plus declares ~35 of their functions on a global `Window` interface.

That last step is a holdover from the strangler-fig migration (`web/public/legacy.js`,
deleted in Phase 7 slice B10g, used to call these as bare globals). It was never pruned
after legacy's deletion — see §4/§5, this is the audit's largest concrete finding.

**State.** `AppState` (16 fields: server data, filters, view window, user, …) lives in the
`Store` returned by `createStore`. In practice, almost nothing in the app calls
`store.set()`/`store.get()` — verified zero call sites outside `state.ts` itself. Every
module reads and writes the raw object through `window.S.<field>` directly, and manually
calls `window.notify()` afterward. The store's only genuinely-used member is `subscribe`
(called exactly once, in `app.ts`, to wire the Grid's re-render).

**Write path.** Deliberately two-layered, and correctly so: `ui/mutate.ts`'s `mutate()`
applies a reducer **synchronously and optimistically** to `window.S.data` (via
`core/booking.ts`'s pure reducers: `bookCells`, four `delete*` variants, machine CRUD),
repaints immediately, then persists to the server in the background; `server/mutate.ts` is
the actual authority — it revalidates everything from scratch and is the only place a
write is ever durably accepted. This client/server split is CLAUDE.md's own rule ("one
authoritative server write path; never trust the client") — not duplication, see §6.

**Gate.** `npm run verify` = prettier + `tsc --noEmit` + eslint (with the layering rules
in `eslint.config.js`: `core/` may not touch DOM globals or import `ui/`/`net/`; `net/`
may not import `ui/`) + `knip` (dead-export detection) + vitest with coverage floors
(90/85 on `core/`, `state.ts`, `net/`, `ui/`; 90/70 repo-wide). All green as of this audit.

---

## 2. Module map

Grouped by layer. "Problems" is blank where the audit found none worth recording.

### `core/` — pure, no DOM (lint-enforced)

| Module | Responsibility | Important exports | Main consumers | Problems |
|---|---|---|---|---|
| `core/dates.ts` (152L) | Calendar arithmetic (parse/format ISO dates, week math, ranges) | `parseIsoDateString`, `addDays`, `isWeekend`, `mondayOfDate`, `getIsoWeekNumber`, `getWeekdaysInRange`, … + 7 short-name aliases (`ymd`, `mondayOf`, …) | Almost every other module (13 direct importers) | The 7 aliases (`ymd = formatDateAsIsoString`, etc., lines 146–152) exist only for the historical short call-sites in the now-deleted `legacy.js`. Grep confirms **zero current importers use the aliases** — every live call site uses the full name. Dead re-exports (§5). |
| `core/machines.ts` (110L) | Machine category, maintenance/availability predicates | `categoryOf`, `CATEGORIES`, `dayAvailable`, `isBlockedOnDate`, `maintenanceSlotAt`, `cellBookable` | `core/booking.ts`, `ui/grid.ts`, most `ui/components/*` | — |
| `core/weekend.ts` (46L) | The *sweep* half of the weekend-bridge invariant (removes orphaned Sat/Sun on a write) | `sweepWeekends` | `core/booking.ts` (all 4 delete reducers) | — |
| `core/booking.ts` (409L) | The client's write-path reducers (pure; optimistic apply) | `bookCells`, `deleteCells`/`deleteOwnCells`/`deleteSelectedCells`/`deleteGroup`, `saveMachine`, `deleteMachine`, `moveMachine` | `ui/mutate.ts` callers — every `*Modal.tsx` that writes | — |
| `core/booking-queries.ts` (77L) | Read-only booking queries (not writes): "what's the rest of this run/group" | `findSameNameWorkdayRun`, `findBookingGroup` | `BookingDetailModal.tsx` only | Contains a private `adjacentWorkday` helper that duplicates logic in 3 other files — see §6. |
| `core/assistant.ts` (358L) | Assistant device-tree ops + the N-of-M scheduling solver | `treeFind`/`treeDetach`/…, `chooseDevicesForTree`, `nextWeekday`, `groupRuns`, … (29 exports) | `AssistantModal.tsx`, `AssistantTree.tsx`, `AssistantResults.tsx` | Largest `core/` file by export count; still one coherent domain (the Assistant), not flagged as a split candidate. `nextWeekday` is one of the 4 duplicate implementations, §6. |

### `net/` — I/O allowed, may not import `ui/` (lint-enforced)

| Module | Responsibility | Important exports | Main consumers | Problems |
|---|---|---|---|---|
| `net/api.ts` (72L) | HTTP client: `fetch` wrapper, response validation/normalization | `apiGet`, `apiPost`, `readFile`, `validateData` | `ui/live-connection.ts`, `ui/mutate.ts` | — |
| `net/sse.ts` (122L) | Pure SSE event-shape logic (not the connection itself) | `applyUpdate`, `presenceInfo`, `isForeign`, `remoteMessage` | `ui/live-connection.ts` (the one impure adapter that owns the actual `EventSource`) | — |

### `state.ts` + `app.ts`

| Module | Responsibility | Important exports | Main consumers | Problems |
|---|---|---|---|---|
| `state.ts` (52L) | Defines `Store`/`createStore` | `createStore`, `Store` | `app.ts` only | `set`/`get` are dead — zero callers anywhere in the app (§7). |
| `app.ts` (421L) | Boot: hydrate state, mount React roots, wire imperative DOM handlers, **bridge 43 modules onto `window`** | (side-effecting entry, no exports) | n/a — it's the root | The single largest finding of this audit: fan-in of 43 modules, most of that fan-in existing only to feed a bridge 26 of whose 43 targets have zero real callers. See §4/§5. |

### `ui/` non-component modules

| Module | Responsibility | Important exports | Main consumers | Problems |
|---|---|---|---|---|
| `ui/grid.ts` (296L) | **Mixed**: pure cell/dot classification (rendering) **+** machine ordering/grouping **+** a booking-lookup accessor | `classifyCell`, `cellClass`, `classifyDot`, `buildGridRows`, `orderedMachines`, `displayGroup`, `getBooking`, `visibleWeeks` | `cell-patch.ts`, `favorite-jump.ts`, `Grid.tsx`, `AssistantModal.tsx`, `ContextMenu.tsx`, `MyBookingsModal.tsx`, `StatsModal.tsx`, `MachineFilterDropdown.tsx`, `AllBookingsModal.tsx` (9 consumers — highest fan-in of any `ui/` module) | `getBooking` (a pure `bookings[mid]?.[date]` lookup, no DOM) is a domain data-accessor living in a rendering module purely because the grid was its first caller. `orderedMachines`/`displayGroup` (favorites-aware sort/grouping) are also DOM-free domain logic, not rendering. See §5. |
| `ui/cell-patch.ts` (108L) | Targeted single-cell DOM repaint (vs. a full grid render) | `refreshCell`, `refreshDot`, `patchCells` | `ui/mutate.ts`, `ui/live-connection.ts` | — |
| `ui/grid-interaction.ts` (383L) | Selection state, drag-select, keyboard nav, click/dblclick routing | `selection`, `paintSelection`, `clearSelection`, `initGridInteraction` | `Grid.tsx`, `favorite-jump.ts`, several modals | Heaviest `window.S` consumer in the app (22 direct field accesses) — see §7. |
| `ui/grid-scroll.ts` (336L) | Infinite scroll, week-window growth, month/date jump | `prependWeek`, `ensureOverflow`, `centerToday`, `gotoDate`, `resetView`, … | `app.ts`, several modals | Second-heaviest `window.S` consumer (20 accesses). |
| `ui/selection.ts` (49L) | Pure selection-rectangle geometry | `computeSelCells`, `clampIndex` | `ui/grid-interaction.ts` only | — |
| `ui/navigation.ts` (51L) | Pure next/prev-free-day scan (predicate-injected) | `nextFreeDay`, `prevFreeDay` | `ui/favorite-jump.ts` only | — |
| `ui/favorite-jump.ts` (141L) | Favorites toggle + "jump to next/prev free day" orchestration | `toggleFav`, `gotoNextFree`, `gotoPrevFree` | Bridged (`window.*`, live — see §4) | — |
| `ui/machine-lookup.ts` (19L) | Memoized O(1) id→Machine map | `machById` | Bridged (`window.machById`, 18 call sites — live) | Its own comment explains the deliberate bridge choice ("dozens of call sites"); verified accurate — this one bridge target earns its keep. |
| `ui/machine-text.ts` (54L) | German status/availability text formatting | `maintText`, `statusRangeText`, `daysMaskText` | `cell-patch.ts`, most modals | — |
| `ui/machine-form.ts` (107L) | Machine-form draft state + validation | `initialMachineFormState`, `validateMachineForm` | `MachineFormModal.tsx` only | — |
| `ui/machine-filter.ts` (127L) | Machine-filter dropdown row-building | `buildMachineFilterRows` | `MachineFilterDropdown.tsx` only | — |
| `ui/mutate.ts` (157L) | **The** optimistic write pipeline (§1) | `mutate`, `refreshNow`, `stampRef` | Bridged (`window.mutate`, 58 call sites — the single busiest bridge target) | — |
| `ui/live-connection.ts` (163L) | SSE connection lifecycle, presence polling | `connectSSE`, `presenceTick`, `activeUserRows` | Bridged (live) | — |
| `ui/confirm.ts`, `ui/toast.ts`, `ui/collision-banner.ts`, `ui/debug-panel.ts`, `ui/theme.ts`, `ui/user-chip.ts`, `ui/escape-html.ts`, `ui/toolbar-dropdown.ts`, `ui/column-resize.ts`, `ui/category-fold.ts` | Small single-purpose UX-chrome modules | — | Various | `ui/toast.ts` and `ui/collision-banner.ts` are bridged but dead (§4/§5); the rest are either live-bridged or directly imported, no problems found. |
| `ui/assistant-checklist.ts`, `ui/assistant-results.ts` | Pure Assistant view-model builders | `buildChecklistRows`, `buildAssistantResults` | `AssistantChecklist.tsx`, `AssistantResults.tsx` | — |
| `ui/modal.tsx` (small) | Generic React-portal modal open/close lifecycle | `openReactModal`, `closeReactModal`, `collapseReactModal` | Every `*Modal.tsx` (11 consumers) | — |

### `ui/views/*` — pure read-model kernels (one per screen)

| Module | Responsibility | Important exports | Main consumers | Problems |
|---|---|---|---|---|
| `ui/views/my-bookings.ts` (63L) | "My bookings" run-grouping | `computeMyRuns` | `MyBookingsModal.tsx` | Own `nextWorkday` closure — duplication, §6. |
| `ui/views/all-bookings.ts` (131L) | All-bookings run-grouping + filter/sort | `computeAllRuns`, `filterAllRuns` | `AllBookingsModal.tsx` | Own `nextWorkday` closure — duplication, §6. |
| `ui/views/stats.ts` (286L) | Statistics aggregation | `computeStats`, `buildResourceRows`, `buildMaintRows`, `buildPersonRows` | `StatsModal.tsx` and its sub-components | Largest `views/` file (286L) but one coherent concept (stats), not flagged. |
| `ui/views/admin.ts` (36L) | Admin machine-list sort/filter | `filterAdminMachines` | `AdminModal.tsx` | — |

### `ui/components/*` — React components (33 files)

Not tabulated individually (would be ~33 near-identical rows: "renders one modal/screen,
imports its own view-model + core queries + `modal.tsx`"). The pattern is consistent and
healthy: each component imports exactly the `core/`/`ui/views/`/`ui/*` helpers it needs
directly (real ES imports, not the window bridge) plus `Icon.tsx`/`modal.tsx` for chrome.
No component imports another layer it shouldn't, and no cross-component import cycle was
found. Exceptions worth naming individually:

| Module | Note |
|---|---|
| `Grid.tsx` + `GridBody.tsx` | The booking grid itself — one of 4 independently-mounted React roots (§4). `render` is bridged (`window.render`) and is the single most-called bridge target after `mutate`. |
| `ContextMenu.tsx` | A second independent React root; bridges `showCtx`/`hideCtx` (live, called from `grid-interaction.ts`). |
| `MachineFilterDropdown.tsx`, `GroupFilterDropdown.tsx` | Two more independent React roots; bridge `saveFilters`/`updateMachBtn`/`fillGroupSel` (live). |
| `AdminModal.tsx`, `MachineFormModal.tsx`, `BookingDetailModal.tsx`, `StatsModal.tsx` | Each bridges exactly one `open*` function, called from `app.ts`'s imperative wiring or another modal — all live, all single-purpose. |

### `server/`

| Module | Responsibility | Important exports | Main consumers | Problems |
|---|---|---|---|---|
| `server/server.ts` | Impure shell: HTTP routing, SSE fan-out, daily backup | (entry, coverage-excluded) | n/a | — |
| `server/db.ts` | SQLite schema, meta, one-time JSON import | `openDb`, `bumpRev`, `importFromJson` | `server.ts`, `mutate.ts`, `model.ts` | — |
| `server/model.ts` | Pure read model: row → wire-shape mappers | `getState`, `machineOut`, `bookingOut`, `isBlocked` | `server.ts` | — |
| `server/mutate.ts` | **The** authoritative write path | `applyMutate` | `server.ts` | — |
| `server/bridge.ts` | The *maintain* half of the weekend-bridge invariant | `missingBridges`, `maintainBridges`, `backfillBridges` | `mutate.ts` (maintain), `backfill.ts` (one-time CLI) | — |
| `server/backfill.ts`, `server/import.ts` | One-time CLI entry shells | (entry, coverage-excluded) | Ops scripts | — |
| `server/types.ts` | Backend-internal wire/row types | `MachineRow`, `BookingRow`, `MutateResult`, … | All of `server/*` | — |

### `shared/`

| Module | Responsibility | Important exports | Main consumers | Problems |
|---|---|---|---|---|
| `shared/types.ts` (121L) | The domain contract both sides import | `Machine`, `Booking`, `Bookings`, `BookingData`, `ServerData`, `AppState` | Everywhere | — |

---

## 3. Domain ownership

| Concept | Current location(s) | Proposed owner | Reason |
|---|---|---|---|
| Calendar arithmetic (parse/format/add/week-number) | `core/dates.ts` | Unchanged — already the single, well-used owner | Sound as-is |
| "Next/previous workday, weekends skipped" | Duplicated independently in `core/assistant.ts` (`nextWeekday`), `core/booking-queries.ts` (private `adjacentWorkday`), `ui/views/all-bookings.ts` and `ui/views/my-bookings.ts` (local closures) | `core/dates.ts`, alongside `addDays`/`isWeekend` | It's calendar arithmetic, not domain logic specific to any of the 4 files it's currently duplicated in. Already twice-flagged (original Phase 7 plan + an independent `/ultrareview` pass) and correctly deferred as a real-but-small follow-up — see §6. |
| Machine category/availability predicates | `core/machines.ts` | Unchanged | Sound as-is; single owner, well-consumed |
| Booking write path (client optimistic apply) | `core/booking.ts` | Unchanged | Sound; correctly separate from the server's authoritative path (§6) |
| Booking write path (server authoritative) | `server/mutate.ts` | Unchanged | Sound; CLAUDE.md's own rule |
| Booking read queries (run/group lookup for the detail modal) | `core/booking-queries.ts` | Unchanged, **once** the duplicate `adjacentWorkday` is replaced by an import from `core/dates.ts` | Small, single-consumer, correctly separated from the write-path file by size (see the file's own header comment) |
| A single booking's lookup (`bookings[mid]?.[date]`) | `ui/grid.ts`'s `getBooking` | `core/booking-queries.ts` (or a new small `core/bookings.ts` if that file is felt to be about the wrong axis — read vs. write, not lookup) | It's a pure data accessor with 9 consumers spanning components that have nothing to do with grid rendering (`AssistantModal`, `StatsModal`, `ContextMenu`, …); it lives in `ui/grid.ts` only because the grid was its first caller |
| Weekend-bridge invariant | Split by direction: `core/weekend.ts` (sweep/remove, client) + `server/bridge.ts` (maintain/add, server) | Unchanged | Deliberate, documented split — not duplication (§6) |
| Assistant scheduling (tree ops + N-of-M solver) | `core/assistant.ts` | Unchanged | One coherent domain; large file but not a split candidate |
| App-wide UI state (filters, view window, user, …) | `shared/types.ts` (`AppState` shape) + `state.ts` (`Store`) + `window.S` (the actual read/write surface in practice) | No structural move — but see §7: the *pattern* (bypass `store.set`, mutate the raw object, remember to call `notify()`) is the real ownership problem, not the file location | A "smallest useful improvement" fix here is behavioral (route new/touched call sites through `store.set`), not a file move |
| Networking (fetch + SSE wire shapes) | `net/api.ts` + `net/sse.ts` | Unchanged | Clean, lint-enforced boundary; zero violations found |
| SSE connection lifecycle (the actual `EventSource`, presence polling) | `ui/live-connection.ts` | Unchanged | Correctly the one *impure* adapter over the pure `net/sse.ts` logic |
| Grid rendering (cell/dot classification, row building) | `ui/grid.ts` | Unchanged for this part | Correctly pure-over-`core/`, DOM-free, single responsibility |
| Machine ordering/grouping for display (favorites-aware sort) | `ui/grid.ts`'s `orderedMachines`/`displayGroup` | Left in place, flagged only as worth a look — see below | Borderline: DOM-free like `getBooking`, but conceptually about "how the grid presents machines" rather than a generic domain accessor. Not moving this is defensible; it's called out for completeness, not urgency |
| Cross-React-root communication (Grid ↔ ContextMenu ↔ the 2 filter dropdowns ↔ modals) | Ad hoc, via the `window.*` bridge in `app.ts` | No structural verdict from this audit — see §4's proposed options | This is the one place where "if I need to change this in six months, where do I look?" doesn't have a clean answer today: the answer is "grep `window.` and hope the comment in `app.ts`'s `Window` interface is still accurate" (§4 shows several already aren't) |
| Debug/log panel | `ui/debug-panel.ts` | Unchanged | Small, single owner |
| Toast/confirm/collision-banner UX chrome | `ui/toast.ts`, `ui/confirm.ts`, `ui/collision-banner.ts` | Unchanged | Small, single owner each |

---

## 4. Dependency problems

1. **`app.ts` is a 43-module fan-in hub whose only job for most of those imports is to
   feed a bridge that ~60% of the time has no reader.** It imports every `core/`, `net/`,
   and `ui/` module in the tree as a namespace, plus all 33 `ui/components/*`, purely to
   `Object.assign(window, mod)` each one. This makes `app.ts` look — at a glance, or to
   any tool doing import-graph analysis — like it depends on the entire application, when
   in truth the vast majority of that "dependency" is a side-effecting re-export nobody
   reads. See §5 for the precise breakdown.

2. **The store (`state.ts`) is imported by exactly one file (`app.ts`) and only two of its
   four methods are ever called.** `store.set`/`store.get` — the two methods that would
   make `state.ts` a genuine abstraction over the raw state object — have zero call sites
   anywhere in the app, verified by grep across every non-test `.ts`/`.tsx` file. The
   `Store` type exists, is exported, is unit-tested (`state.test.ts`), and is functionally
   inert beyond `subscribe`/`notify`/`.state`. Every real state read or write in the
   codebase goes through `window.S.<field>` instead (§7 has the concrete counts).

3. **`ui/grid.ts` has the highest fan-in of any `ui/` module (9 direct consumers) and
   mixes three concerns**: pure rendering classification (`classifyCell`/`cellClass`/
   `classifyDot`, genuinely belongs here), machine ordering for display (`orderedMachines`/
   `displayGroup`, borderline), and a generic booking-lookup accessor (`getBooking`, does
   not belong here — see §3). Components with nothing to do with grid rendering
   (`AssistantModal.tsx`, `StatsModal.tsx`, `ContextMenu.tsx`) import `ui/grid.ts` **only**
   for `getBooking`, which is the concrete symptom of the ownership problem: they're
   importing a rendering module to get a data accessor.

4. **Four independently-mounted React roots** (`Grid`, `ContextMenu`,
   `MachineFilterDropdown`, `GroupFilterDropdown`) talk to each other and to
   `app.ts`'s imperative code exclusively through the `window` bridge, because they have
   no shared parent component to pass props/context through. This is the root cause behind
   most of the 17 bridge targets that *are* genuinely still live (§5) — it isn't legacy
   debt, it's the current, load-bearing integration mechanism between separately-mounted
   trees. Worth naming as a dependency problem because it's the one place `window` is
   doing real architectural work rather than leftover work, and because it's why a naive
   "just delete the whole bridge" fix would break the app.

5. **No lint rule stops `ui/` from importing `server/`, or the frontend generally from
   reaching into backend code.** In practice this has never happened (verified: zero such
   imports exist), so this is not a live problem — noted only because every other layer
   boundary in this project *is* machine-enforced and this one isn't, which is an
   inconsistency worth being aware of if the frontend/backend line ever gets less obvious
   (e.g. a future shared "validation" utility that could accidentally end up importable
   from either side without a boundary catching a wrong-direction import).

---

## 5. Export problems

**The headline finding.** `app.ts` bridges 43 modules onto `window` via
`Object.assign(window, mod)`. Checking every one of those modules' exports against actual
`window.<name>` call sites in the rest of the (non-test) codebase — not the `declare
global` comments, which turn out to be an unreliable guide, see below — finds:

- **26 of the 43 bridge targets are dead**: not one export of that module is ever read as
  `window.<name>` anywhere in production code. Every real caller uses a direct ES import
  instead (confirmed for each — e.g. `AdminModal.tsx` imports `moveMachine` directly from
  `core/booking.ts`; nothing calls `window.moveMachine`). The dead list: `core/dates.ts`,
  `core/machines.ts`, `core/weekend.ts`, `core/booking.ts`, `core/assistant.ts`,
  `net/sse.ts`, `ui/grid.ts`, `ui/selection.ts`, `ui/grid-interaction.ts`,
  `ui/navigation.ts`, `ui/views/my-bookings.ts`, `ui/views/stats.ts`,
  `ui/views/all-bookings.ts`, `ui/views/admin.ts`, `ui/machine-text.ts`, `ui/toast.ts`,
  `ui/collision-banner.ts`, and 9 `ui/components/*.tsx` files (`HelpModal`, `LogModal`,
  `AskUserNameModal`, `SettingsModal`, `BookingForm`, `MyBookingsModal`, `AllBookingsModal`,
  `AssistantModal`, `ActiveUsersModal`).
- **17 are genuinely live** — concentrated almost entirely in the two real needs named in
  §4.4: cross-React-root calls (`openAdmin`, `openMachineForm`, `openCellAction`,
  `openStats`, `showCtx`/`hideCtx`, `saveFilters`/`updateMachBtn`, `fillGroupSel`, `render`)
  and a handful of modules whose own comments correctly anticipated "dozens of scattered
  call sites" (`mutate`/`refreshNow`/`stampRef`, `machById`, `dbg`/`dbgOn`/`applyDebug`/
  `handleError`, `askConfirm`, `applyTheme`, `updateUserChip`, `connectSSE`/`presenceTick`,
  `prependWeek`/`ensureOverflow`/`centerToday`/`syncJumpControls`, `toggleFav`/
  `gotoNextFree`/`gotoPrevFree`/`prevFreeBefore`/`nextFreePtr`, `patchCells`, `readFile`).

**A stale/phantom declaration.** `app.ts`'s `declare global { interface Window { … } }`
block declares `Sel: { anchor: Cell | null; … }` with a comment saying it's "read/mutated
directly by legacy's still-unported `jumpToSlot`... and `showCtx` (still legacy)". Grep
finds **zero assignments to `window.Sel` and zero reads of it anywhere in the non-test
codebase** — not even the `Object.assign(window, gridInteraction)` call actually produces
it (that assigns `window.selection`, not `window.Sel` — the names don't match). The type
declaration and its comment describe a bridge member that does not exist at runtime.
Likely explanation: `legacy.js`'s deletion (B10g) removed the real `jumpToSlot`/`showCtx`
call sites this was written for, and the `Window` interface entry wasn't cleaned up with it.

**Comments that no longer match reality.** Several `Window` interface entries carry
"called directly by X" comments that are now wrong given a direct-import call graph — e.g.
`openBookingForm`'s comment says it's "called directly by `ui/components/ContextMenu.tsx`
(B10b) and the assistant", but `ContextMenu.tsx` in fact does
`import { openBookingForm } from './BookingForm.tsx'` — a real ES import, not a window
call. The comment is describing the bridge as if it were load-bearing there when the
direct import already replaced it. This matters beyond tidiness: a reader trying to answer
"can I safely remove this bridge entry" from the comments alone would get the wrong answer.

**Two dead export categories not tied to the window bridge**, found independently:
- `core/dates.ts`'s 7 short-name aliases (`ymd`, `mondayOf`, `fmtLong`, `todayStr`,
  `weekdayRange`, `allDaysRange`, `parseYmd`) exist only for `legacy.js`'s short call-site
  style. Zero current importers use them (every live call site uses the full name) —
  confirmed by grep, not just by `knip` (whose `ignoreExportsUsedInFile` setting and the
  window-bridge pattern together mean it isn't fully authoritative for this specific case,
  as established earlier in this project).
- No genuinely orphaned *module* was found (every `.ts`/`.tsx` file has at least one real,
  non-bridge consumer or is itself an entry point) — worth stating explicitly since it was
  checked (e.g. `core/booking-queries.ts` looked suspiciously unreferenced from the import
  grep alone and turned out to have exactly one real consumer, `BookingDetailModal.tsx`).

---

## 6. Duplication

**Confirmed and already known — the `nextWorkday` quadruplication.** Four independent
implementations of "step to the next (or previous) workday, treating Saturday/Sunday as
not-a-day, Friday and the following Monday as adjacent":
- `core/assistant.ts`: exported `nextWeekday(isoDateString)`.
- `core/booking-queries.ts`: private `adjacentWorkday(isoDate, direction)`.
- `ui/views/all-bookings.ts`: a local closure named `nextWorkday`.
- `ui/views/my-bookings.ts`: a local closure named `nextWorkday`, identical to the one in
  `all-bookings.ts`.

This was already flagged in the original Phase 7 plan (`PHASE7-PLAN.md`, deferred as a
real-but-small follow-up rather than folded into an unrelated slice) and independently
corroborated by an `/ultrareview` cloud pass afterward (commit `cb29a36`, `bug_001`,
severity "nit", all verifiers agreed). This audit re-confirms the same four sites still
exist and recommends the same fix the team already proposed: hoist one implementation to
`core/dates.ts` (next to `addDays`/`isWeekend`, which is what it's built from in every one
of the four copies) and have all four call it. **Should be merged** — the four
implementations were checked line-by-line and are behaviorally identical (same do-while
skip-weekend loop, same direction semantics), so this is safe under the "don't merge
without confirming identical behavior first" instruction. Small, isolated, low-risk; the
kind of item the "smallest useful improvement" framing favors doing rather than continuing
to defer.

**Looks like duplication, is not — checked and rejected as a merge candidate.**
- `core/booking.ts` (client, optimistic apply) vs. `server/mutate.ts` (server, authoritative
  apply). Both "apply a booking write", but deliberately: the client version runs
  synchronously against a local copy for instant UI feedback with no network round-trip;
  the server version is the only one that's ever durably trusted, re-validates everything
  from scratch (id format, date format, batch-size cap, foreign-write conflict detection)
  independently of what the client claims, and is explicitly required to stay separate by
  CLAUDE.md's own written rule. Not a refactor target.
- `core/weekend.ts`'s `sweepWeekends` (client, *removes* orphaned weekend days) vs.
  `server/bridge.ts`'s `maintainBridges` (server, *adds* missing weekend days). Mirror-image
  logic over the same domain concept, but opposite directions, on opposite sides of the
  trust boundary, already documented as an intentional design split in `PROGRESS.md`
  (Phase 6.3). Not a refactor target.
- `getBooking` (§3/§5) is a single definition with 9 consumers, not multiple
  implementations — a **placement** problem, not a **duplication** problem. Filed under §3
  instead.

**No other duplication found.** Checked and rejected as false positives during this pass:
validation logic (client `ui/machine-form.ts`'s `validateMachineForm` vs. server
`mutate.ts`'s inline field-by-field validation) — same "don't trust the client" split as
above, not a duplicate; date-range helpers across `ui/views/*` (`getWeekdaysInRange`/
`getAllDaysInRange`) — all three views import the same `core/dates.ts` functions, no local
reimplementation found.

---

## 7. State ownership — supporting detail for §3/§4

Quantified (grep, non-test files only), to ground the "state ownership" finding in
evidence rather than impression:

- **172** occurrences of `window.S.<field>` across **29** files outside `app.ts`/`state.ts`.
  Heaviest: `ui/grid-interaction.ts` (22), `ui/grid-scroll.ts` (20),
  `MyBookingsModal.tsx` (19), `Grid.tsx` (17), `ui/mutate.ts` (14).
- **0** calls to `store.set()` or `store.get()` anywhere outside `state.ts` itself.
- **1** call to `store.subscribe()` (in `app.ts`, wiring the Grid's re-render) — the store's
  only load-bearing use.
- Direct field mutation is common and bypasses `notify()` unless the caller remembers to
  call it manually — e.g. `ui/grid-scroll.ts`: `window.S.startMonday = addDays(...)`,
  `window.S.extraWeeks++`, immediately followed by a separate, easy-to-forget
  `window.notify()` a few lines later (present today, but structurally optional — nothing
  enforces the pairing).

This matches the request's own framing: "whether data should instead be injected as
parameters" and "whether business logic unnecessarily depends on global state" are real
questions here, and the honest answer is that essentially all of it does, by a pattern
established in Phase 3.1 and never revisited. **This audit does not recommend fixing it
now.** Per the request's explicit instruction for this dimension ("do not redesign the
state system unless the current architecture genuinely requires it; prefer the smallest
useful improvement") and per `PROGRESS.md`'s own existing "carry forward" note (already
flagged, pre-dating this audit, as real but not urgent — no bug traced to it): this is
correctly sized as a distinct, larger, separately-decided piece of work, not something to
fold into the incremental cleanup that should follow this audit. It's recorded here in
full because the audit was asked to investigate it, not because it's being proposed for
the next round of changes.

---

## 8. Proposed target architecture

Deliberately conservative — per the request, this is *not* a redesign. The
`core → net → ui` shape stays exactly as it is (§1 already found it sound); nothing here
proposes new top-level directories, new abstractions, or a framework-level change to how
state or components work. Shown conceptually; exact file names/splits are a decision for
implementation time, not this document.

```text
web/js/
  core/
    dates.ts          # + nextWorkday/prevWorkday, absorbing the 3 duplicate impls (§6)
                       #   drop the 7 dead short-name aliases (§5)
    machines.ts        # unchanged
    weekend.ts          # unchanged
    booking.ts           # unchanged
    booking-queries.ts    # unchanged, minus its private adjacentWorkday (now core/dates.ts)
                          # + getBooking, moved in from ui/grid.ts (§3) — a pure lookup,
                          #   not a rendering concern; this file already owns "read queries
                          #   over bookings"
    assistant.ts          # unchanged; its nextWeekday becomes a thin call to core/dates.ts

  net/
    api.ts              # unchanged
    sse.ts               # unchanged

  state.ts               # unchanged structurally; §7's "smallest useful improvement" is
                          # behavioral (route new call sites through store.set), not a move

  ui/
    grid.ts             # shrinks to its actual single concern: cell/dot classification +
                         # row building (classifyCell/cellClass/classifyDot/buildGridRows/
                         # visibleWeeks). orderedMachines/displayGroup stay here too — see
                         # §3, this one's a judgment call, not a strong recommendation.
    (all other ui/*.ts, ui/views/*, ui/components/* — unchanged)

  app.ts                # the bridge shrinks from 43 Object.assign targets to the ~17
                         # confirmed-live ones (§5); the 26 dead ones and the phantom
                         # window.Sel declaration are deleted together with their now-
                         # provably-stale comments. The remaining live bridge is exactly
                         # the cross-React-root + high-call-count set (§4.4) — worth a
                         # follow-up decision (separate from this audit) on whether to
                         # keep it explicit like this, or eventually give the 4 mounted
                         # roots a shared parent so the bridge shrinks further — but that
                         # is a larger, framework-shaped call this audit does not make.

server/                 # unchanged — no problems found in this audit
shared/types.ts          # unchanged
```

**What this buys, concretely:** `app.ts` stops looking like it depends on the entire
application (43 imports → the ~17 actually load-bearing ones once the dead re-export need
is gone — the live-bridged modules' *own* consumers still import them directly for
everything except their one bridged entry point, so most of those 17 imports shrink too,
to just the specific bridged export rather than the whole namespace). Four call sites
(`AssistantModal.tsx`, `StatsModal.tsx`, `ContextMenu.tsx`, and `ui/grid.ts` itself) get a
more honest import: "I need a booking lookup" instead of "I need the grid renderer, which
happens to also have a booking lookup." One small, twice-already-flagged duplication
across four files collapses to one implementation. Nothing about how the app boots, how
writes flow, how the store works, or how any screen renders changes.

**Explicitly out of scope for the incremental follow-up**, recorded here so it isn't lost:
the `window.S` → `store` migration (§7) and any decision about consolidating the 4 React
roots (§4.4) are both real, both larger, and both belong to a separate, deliberately-scoped
piece of work if and when they're picked up — not bundled into whatever lands from this
audit.

---

## 9. Second pass — a deeper look, prompted by "does dates belong in core?"

The first pass of this audit (§1–8) treated `core/dates.ts` as settled because it satisfies
the project's own definition of `core/` (pure, no DOM — `ARCHITECTURE.md §5`). Asked to look
harder specifically at date logic and to re-verify every call site rather than trust the
first pass, this second pass checked (a) whether the backend has its own date logic instead
of sharing the frontend's, and (b) whether the same kind of drift shows up in non-date
business rules once the same method is applied there too. Both turned up real findings; one
of them is a correctness bug, not an architecture nit.

**Does `dates` belong in `core/`?** Yes, by the project's actual, written definition —
`core/` means "pure, no DOM" (`ARCHITECTURE.md §5`), not "domain-specific." `core/dates.ts`
is pure, is depended on by the real domain modules (`booking.ts`, `weekend.ts`,
`assistant.ts` all import it), and every one of its 13 direct importers is legitimate. There
is no case for moving it out of `web/js/core/`. The real, confirmed answer to "why do date
functions appear in different files" is not that `core/dates.ts` is the wrong home on the
frontend — it's that the **backend never got a copy of it**: `server/bridge.ts` and
`server/server.ts` each independently reimplement `parseIsoDateString`/`formatDateAsIsoString`/
`addDays` as private one-liners, because the frontend (`web/js/core/`) and backend
(`server/`) are separate build/runtime targets with no shared *runtime* module today —
`shared/types.ts` only ever carried type-only declarations (compiled away, zero runtime
coupling), so when the backend first needed date arithmetic (Phase 6.3's weekend bridge) it
grew its own rather than being given a shared one. `server/bridge.ts`'s own comment says
this outright: "UTC date helpers, deliberately separate from web/js/core/dates.ts (the
server is decoupled from the frontend) but named the same way for a reader moving between
them." That's a real, considered decision, correctly documented — but it produced literal
duplicate logic, and `server/server.ts` then duplicated `formatDateAsIsoString` a *third*
time independently of `server/bridge.ts`'s own copy, which isn't a decision anyone made on
purpose. See F2/F3 below for what to do about it.

**Applying the same check to non-date business rules surfaced the audit's most important
finding.** `core/machines.ts`'s `isBlockedOnDate` (client) correctly treats a machine as
blocked from either its structured `maint` slot array *or* its legacy single `status` field
(preferring `maint` when present). `server/model.ts`'s `isBlocked` — the function
`server/mutate.ts` actually calls to decide whether to accept a booking write — checks
**only** the legacy `status` field. It never looks at `maint` at all, and the server also
never enforces the `days` weekday-availability mask on writes (confirmed: `dayAvailable` is
never imported into `server/`). Concretely: a machine blocked *only* via a `maint` array
entry (the newer, UI-supported form — `MaintenanceSlotEditor.tsx`) will correctly show as
blocked in the grid, but the server's own write-path validation will **accept** a booking
for that machine on that date anyway, because its `status` column is still `'ok'`. This is
the same duplication pattern as the date functions (one business rule, implemented twice,
independently, across the client/server boundary) but here the two copies aren't
equivalent — the server's copy is missing cases the client's has had for longer. See F1
below; it is the one item in this document that is a correctness bug rather than a
structural improvement, and it is prioritized accordingly.

---

## 10. Prioritized, actionable refactoring plan

**Status (2026-09-02): F1, F2, F3, F4, F5, F6, F7 (minimal), F8, and F9 are done**, each as
its own verified commit (full gate green + a rebuilt-image browser smoke after F5 and after
F2's later extension). F9 landed in three slices — the bounded first slice (11 plain `.ts`
files), then two component batches (18 React components, 63 sites) — each its own commit,
each gate-verified. F8 shipped *not* as originally framed: investigating its actual call
sites (rather than trusting the "4 roots need to talk" framing) showed the real coupling was
ordinary ES-module cycles and dead leftovers, unrelated to root count — see its write-up
below for the reclassification and what shipped instead of a tree merge. See the individual
write-ups below for what actually shipped in each case; they're kept in the original
(pre-implementation) tense as the record of what was proposed, with the outcome noted inline
where it's worth flagging (F2 went beyond its original minimal proposal to the full
cross-boundary merge; F7 shipped only its minimal option; F8 shipped a different, smaller fix
than its own original proposal; F9 shipped in slices but ultimately covers every `window.S`
site in the app's own modules).

Every item below was verified against real call sites in this pass (grep for every actual
`window.<name>`/import/usage site, not filenames or assumptions), per the request. Each is
classified **SAFE** / **MODERATE** / **HIGH RISK** independently of its priority bucket —
priority is about how much it matters; risk is about how carefully it needs to be done.

### F1 — Server write-path enforces an incomplete blocking rule (correctness bug)

1. **Current problem:** `server/mutate.ts`'s cell-write path (`writeCell`) calls
   `isBlocked(machine, day)` from `server/model.ts`, which checks only the legacy
   `status`/`statusFrom`/`statusUntil` fields. It never consults `machine.maint` (the
   structured maintenance-slot array) and the server never checks the `days` weekday mask
   at all.
2. **Why it is a problem:** the client's own business rule for "is this cell bookable"
   (`core/machines.ts`'s `cellBookable = !isBlockedOnDate(...) && dayAvailable(...)`)
   is strictly wider than what the server enforces. A machine blocked only via a `maint`
   slot (settable today through `MachineFormModal.tsx` → `MaintenanceSlotEditor.tsx`), or
   a day disabled only via the `days` mask, is correctly refused by the UI but would be
   **accepted** by a direct `/api/mutate` call — a stale client, a client bug, or a
   deliberate bypass would silently create an invalid booking the server considers valid.
   This is exactly the class of bug CLAUDE.md's "one authoritative server write path;
   never trust the client" rule exists to prevent, and it is currently not fully honored.
3. **Current files/modules involved:** `server/model.ts` (`isBlocked`), `server/mutate.ts`
   (`writeCell`, the only caller), `core/machines.ts` (the correct client-side reference
   behavior: `isBlockedOnDate`, `dayAvailable`, `cellBookable`).
4. **Proposed change:** give `server/model.ts`'s blocking check the same two cases the
   client has: parse `machine.maint` (already stored as JSON on the row — `machineOut`
   already does this parsing for the read path, so the pattern exists) and OR it with the
   legacy-status check; add a `days`-mask check to `writeCell` (or a new server-side
   `dayAvailable`) alongside the existing `isBlocked` call. Do **not** just import
   `core/machines.ts` from the server — it's frontend code (imports `shared/types.ts` with
   `.ts` extensions the backend's `NodeNext` build doesn't resolve, per `tsconfig.server.json`);
   port the two missing cases into `server/model.ts` against `MachineRow`'s shape instead,
   the same way `isBlocked` already is.
5. **Expected benefit:** closes a real gap between what the UI prevents and what the
   server actually accepts — the server becomes authoritative in fact, not just in
   intent, matching the project's own stated rule.
6. **Risk level: HIGH RISK.** This changes what the server accepts. Any production data
   with a `maint`-blocked or `days`-restricted machine that has (for whatever reason) a
   booking already sitting on a now-newly-enforced day would not be affected retroactively
   (existing rows aren't touched), but the *next* write attempt on such a day, from any
   client, old or new, would now correctly be refused where it previously wasn't. Needs a
   careful look at current data before shipping (a read-only query: does any existing
   booking already sit on a day that would now be rejected?) so a fix doesn't surprise
   someone mid-use.
7. **Dependencies/call sites affected:** `server/mutate.ts` (`writeCell`'s single call
   site), and by extension every `/api/mutate` cell-write request — i.e., every booking
   and deletion in the app. No frontend file changes needed (the client already treats
   these days as unbookable; this only makes the server agree).
8. **Tests:** yes, required, not optional. New `server/model.test.ts` cases: `isBlocked`
   with a `maint`-only block and `status: 'ok'`; a mixed case where `status` is 'ok' but
   `maint` covers the date. New `server/mutate.test.ts` case: a cell-delta write against a
   `maint`-blocked machine is rejected as a conflict, and (if the days-mask check is added
   in the same pass) a write on a `days`-disabled weekday is rejected too. These are the
   tests that are conspicuously absent today — `mutate.test.ts` tests that `maint` is
   *stored* correctly, never that it's *enforced*.

### F2 — The backend duplicates its own date one-liners internally

1. **Current problem:** `server/bridge.ts` defines private `parseIsoDateString`,
   `formatDateAsIsoString`, `addDays`. `server/server.ts` independently defines its own
   private `formatDateAsIsoString` — a second copy, on the backend side alone, of a
   function `bridge.ts` already has.
2. **Why it is a problem:** two definitions of the same one-line function within the same
   package, with no relationship to each other, is duplication with no offsetting reason
   (unlike the frontend/backend split, this isn't crossing a build boundary — both files
   compile together under `tsconfig.server.json`).
3. **Current files/modules involved:** `server/bridge.ts`, `server/server.ts`.
4. **Proposed change:** add a small `server/dates.ts` (or fold into `server/model.ts` if a
   whole new file feels like too much for 3 one-liners) with `parseIsoDateString`/
   `formatDateAsIsoString`/`addDays`; have both `bridge.ts` and `server.ts` import it.
5. **Expected benefit:** one definition instead of two on the same side of the boundary;
   removes the only *accidental* (as opposed to documented-deliberate) date duplication
   found in this audit.
6. **Risk level: SAFE.** Three pure one-line functions, behaviorally verified identical
   (`date.toISOString().slice(0, 10)` in both places; the `addDays`/`parseIsoDateString`
   pair in `bridge.ts` is the only other copy and isn't touched in meaning, only location).
7. **Dependencies/call sites affected:** `server/bridge.ts` (its 3 internal call sites),
   `server/server.ts` (1 call site, the backup filename).
8. **Tests:** no new tests needed — existing `bridge.test.ts`/`server` coverage already
   exercises these through `missingBridges`/the backup path; a pure import-source change
   with identical behavior doesn't need new assertions, just `verify` staying green.

**Update (2026-09-02): went further than proposed — the full cross-boundary merge.**
Prompted by a direct follow-up question ("why does the server have its own date functions
at all when the frontend has core/dates.ts?"), and by a fresh, concrete example of the cost
of not merging: implementing F1 required adding the same "Mo..So mask index from an ISO
date" formula to `server/model.ts` that `core/machines.ts` already had, because the server
still had no way to reach the frontend's copy. Since `core/dates.ts` imports nothing (the
one file with none of the usual cross-boundary blockers), it was physically moved to
`shared/dates.ts`; every frontend importer (21 files) repointed; `server/dates.ts` deleted
entirely in favor of importing `../shared/dates.js`; the fresh mask-index duplication
folded into one new shared export, `mondayFirstWeekdayIndex`. The real work was
`tsconfig.server.json` (`rootDir` widened from `"server"` to the repo root, `include` grew
to `["server", "shared"]`, since a file under `shared/` is now part of the backend's
compiled program) and the `Dockerfile` (added `COPY shared ./shared` to the build stage —
turns out it had never copied `shared/` at all, silently fine only because every existing
`shared/types.ts` import was `import type`, erased before Vite ever needed the file on
disk; and split the runtime stage's single `COPY dist/server ./server` into two, matching
the now-nested `dist/server/{server,shared}` build output). Verified with the same
rebuild-and-smoke approach as F5: `npm run build:server` emits the expected
`dist/server/server/*.js` + `dist/server/shared/*.js` split with correctly resolving
`../shared/dates.js` imports, a full `docker compose up -d --build` succeeds, `/api/health`
and `/api/state` both round-trip correctly against the existing data (`rev` unchanged, 245
machines). Risk was **MODERATE** (build-config + Dockerfile, not just source) rather than
SAFE, for exactly the reason this was originally left as a P2 "needs its own decision."

### F3 — `nextWorkday`/`nextWeekday` implemented four times

1. **Current problem:** the same "step to the next/previous workday, Friday and the
   following Monday are adjacent" logic is independently implemented in
   `core/assistant.ts` (`nextWeekday`), `core/booking-queries.ts` (private
   `adjacentWorkday`), `ui/views/all-bookings.ts` (a local closure), and
   `ui/views/my-bookings.ts` (a local closure).
2. **Why it is a problem:** four maintainers-worth of the same 4-line loop; already
   flagged twice independently (the original Phase 7 plan, and a later `/ultrareview`
   pass, commit `cb29a36`) and correctly deferred both times as real-but-small.
3. **Current files/modules involved:** the four files named above; the natural target,
   `core/dates.ts`, already owns `addDays`/`isWeekend`, which every one of the four copies
   is built from.
4. **Proposed change:** add `nextWorkday(isoDate)`/`prevWorkday(isoDate)` (or reuse the
   `nextWeekday` name already established in `core/assistant.ts`, to avoid a rename on top
   of a move) to `core/dates.ts`; delete the other three, importing the one in `core/dates.ts`.
5. **Expected benefit:** one implementation instead of four; the change every future
   calendar-edge-case fix (a holiday calendar, say) would otherwise have to be applied
   four times becomes a one-file change.
6. **Risk level: SAFE.** All four implementations were read line-by-line this pass and do
   the same thing on the same inputs (do-while skip-weekend loop, same direction
   semantics) — this is exactly the "confirm identical behavior before merging" case the
   project's own conservation rule asks for, and it checks out.
7. **Dependencies/call sites affected:** `core/assistant.ts` (2 internal call sites),
   `core/booking-queries.ts` (2 internal call sites), `ui/views/all-bookings.ts` (1),
   `ui/views/my-bookings.ts` (1) — all internal, no external caller of any of the four
   local names needs to change.
8. **Tests:** existing tests for all four call sites (`assistant.test.ts`,
   `booking-queries.test.ts`, `all-bookings.test.ts`, `my-bookings.test.ts`) already cover
   the *behavior*; add one direct test for the new `core/dates.ts` export (Fri→Mon,
   Sat→Sun, an ordinary weekday) since it's now a public, independently-reusable function.

### F4 — Dead legacy aliases in `core/dates.ts`

1. **Current problem:** 7 short-name aliases (`ymd`, `parseYmd`, `mondayOf`, `fmtLong`,
   `todayStr`, `weekdayRange`, `allDaysRange`) exist solely for `legacy.js`'s old call-site
   style. `legacy.js` is deleted (Phase 7, B10g).
2. **Why it is a problem:** dead exports the file's own comment already says are dead
   ("Delete this entire block in that slice, at which point every caller will be gone") —
   the slice landed, the deletion didn't.
3. **Current files/modules involved:** `core/dates.ts` only.
4. **Proposed change:** delete the aliases and the comment block describing them.
5. **Expected benefit:** one less thing in the file's public surface to wonder about;
   closes out a cleanup the code itself already flagged as due.
6. **Risk level: SAFE.** Confirmed zero importers of any of the 7 alias names anywhere in
   the non-test codebase.
7. **Dependencies/call sites affected:** none.
8. **Tests:** none needed; if any exist testing the aliases directly (unlikely — they're
   trivial re-exports), delete them alongside.

### F5 — `app.ts`'s window-bridge: 26 of 43 targets are dead, plus one phantom declaration

1. **Current problem:** `app.ts` imports 43 modules and `Object.assign(window, mod)`s
   every one, plus declares ~35 of their functions on a global `Window` interface. Of
   those 43 bridge targets, 26 have zero real `window.<name>` callers anywhere in
   production code (verified per-module, per-export, this pass) — every real caller uses
   a direct ES import instead. One declared member, `window.Sel`, has no assignment
   producing it *and* no reader anywhere — a fully phantom type declaration.
2. **Why it is a problem:** inflates `app.ts`'s apparent dependency surface to "the whole
   app" when ~60% of that surface is inert; several of the `Window` interface's own
   explanatory comments are now factually wrong about who calls what (e.g.
   `openBookingForm`'s comment claims `ContextMenu.tsx` calls it via the bridge; that file
   in fact imports it directly) — actively misleading to a future reader trying to decide
   what's safe to remove.
3. **Current files/modules involved:** `app.ts` (the `Object.assign` calls and the
   `declare global` block only — no other file changes).
4. **Proposed change:** delete the 26 dead `Object.assign(window, mod)` lines (keeping the
   real `import * as mod` only where something else in `app.ts` also needs it directly,
   e.g. `gridComponent`/`contextMenu` for `createRoot(...)`), delete their now-unused
   `Window` interface entries where those exist, and delete the phantom `Sel` entry.
5. **Expected benefit:** `app.ts`'s real dependency surface becomes visible — the ~17
   bridge targets that remain are exactly the ones with a genuine cross-root or
   scattered-call-site reason to exist (§4.4/§5 of this audit already names them), instead
   of being buried in 26 false positives.
6. **Risk level: SAFE**, verified two ways: (a) per-export grep confirms zero
   `window.<name>` callers for any of the 26; (b) `app.ts` is excluded from unit-test
   coverage by design (`vitest.config.ts`, "exercised by browser smoke, not unit tests")
   and has no dedicated test file, and the one component test that does stub bridge
   globals (`Grid.test.tsx`) only stubs names from the confirmed-live set
   (`nextFreePtr`, `prevFreeBefore`, `syncJumpControls`, `ensureOverflow`, `notify`) — none
   of the 26 dead names appear in any test. The Playwright smoke script
   (`scripts/ui-smoke.mjs`) doesn't reference `window.*` at all.
7. **Dependencies/call sites affected:** none outside `app.ts` — this removes a bridge,
   not the underlying module or its real (directly-imported) exports.
8. **Tests:** none needed to change; run the full gate + a browser smoke after, since
   `app.ts` itself is smoke-verified rather than unit-tested (E5). Do this one in a couple
   of batches rather than one 26-module diff, re-running `verify` + a smoke between
   batches, simply because it's the largest line-count change in this plan even though
   each individual deletion is low-risk.

### F6 — `getBooking` lives in a rendering module it doesn't belong to

1. **Current problem:** `ui/grid.ts`'s `getBooking(bookings, mid, date)` — a plain
   `bookings[mid]?.[date]` lookup, no DOM, no rendering — is imported by 9 files, several
   of which (`AssistantModal.tsx`, `StatsModal.tsx`, `ContextMenu.tsx`) have nothing to do
   with grid rendering.
2. **Why it is a problem:** those components import a rendering module (`ui/grid.ts`, home
   of `classifyCell`/`cellClass`/`buildGridRows`) solely to reach one unrelated data
   accessor — a function-ownership mismatch that also inflates `ui/grid.ts`'s fan-in
   beyond what its actual responsibility (rendering) would produce.
3. **Current files/modules involved:** `ui/grid.ts` (current home); `core/booking-queries.ts`
   (proposed home — already owns "read-only queries over bookings",
   `findSameNameWorkdayRun`/`findBookingGroup`, and is DOM-free, matching `getBooking`).
4. **Proposed change:** move `getBooking` to `core/booking-queries.ts`; update all 9
   import sites to the new path (function body unchanged).
5. **Expected benefit:** `ui/grid.ts` stops being imported for a reason unrelated to
   rendering; `core/booking-queries.ts` becomes the honest single answer to "where do I
   look for booking read-queries," matching the "six months from now" test this audit's
   brief asked every domain concept to pass.
6. **Risk level: MODERATE.** The function itself doesn't change at all — this is a pure
   relocation — but 9 files' import lines need updating, and `core/booking-queries.ts`
   currently has no dependency on `ui/`, so this is also a legitimate move *down* a layer
   (ui/ → core/), which needs the eslint layering check to stay green (it will — core/
   gains no new DOM/ui/net import, since `getBooking` has none).
7. **Dependencies/call sites affected:** `ui/cell-patch.ts`, `ui/favorite-jump.ts`,
   `AssistantModal.tsx`, `ContextMenu.tsx`, `MyBookingsModal.tsx`, `StatsModal.tsx`,
   `MachineFilterDropdown.tsx`(if it imports it — re-verify at implementation time),
   `AllBookingsModal.tsx`, and `ui/grid.ts` itself (its own internal use in
   `buildGridRows`, which would become an import from `core/booking-queries.ts`).
8. **Tests:** existing `grid.test.ts` tests for `getBooking` move to
   `booking-queries.test.ts` (same assertions, new file); every consumer's own tests are
   unaffected since the function's behavior doesn't change, only its import path.

### F7 — `shared/types.ts` isn't actually shared with the backend

1. **Current problem:** `shared/types.ts` (`Machine`, `Booking`, `ServerData`, …) is
   described everywhere (`ARCHITECTURE.md`, this audit's own §1) as the contract both
   sides use. Grep confirms the backend never imports it — `server/types.ts` independently
   declares `MachineOut`/`BookingOut`/`StateOut`, which are meant to *be* the same wire
   shapes but are hand-maintained separately, and have already drifted at the type level:
   `Machine.group: string` vs `MachineOut.group: string | null`; `status`/`statusNote`/
   `info` optional in `Machine` vs required in `MachineOut`; `Machine.maint?: MaintSlot[]`
   vs `MachineOut.maint?: unknown[]` (weaker typing at the boundary).
2. **Why it is a problem:** there is no compiler-enforced link between what the server
   actually emits and what the frontend's types claim it emits. A future field
   added/renamed on one side and forgotten on the other would compile cleanly on both
   sides and fail only at runtime (or silently produce `undefined`s), because nothing
   checks the two against each other.
3. **Current files/modules involved:** `shared/types.ts` (frontend-consumed contract),
   `server/types.ts` (backend's independent mirror), `server/model.ts` (produces the
   `MachineOut`/`BookingOut`/`StateOut` values).
4. **Proposed change (the safe, minimal version — recommended for now):** add a
   compile-time structural check (e.g. a `satisfies`-based assertion, or a small
   `server/types.test.ts` type-only test) that fails if `MachineOut` stops being
   assignable to/from `Machine`, etc. — catches future drift without touching the
   runtime backend build. A **larger, non-recommended-yet** version — actually importing
   `shared/types.ts` into the backend build — is possible but requires adding `shared/` to
   `tsconfig.server.json`'s `include` and to the Dockerfile's backend build-stage `COPY`
   list, and deciding what to do about the fields that already differ (are they
   deliberate — `group` genuinely nullable at the DB layer before `machineOut` defaults
   it? — or bugs?); that investigation is real work, not a mechanical move, so it's filed
   as the P2 option below rather than proposed now.
5. **Expected benefit (minimal version):** a compiler-enforced tripwire against silent
   contract drift, at near-zero cost and zero runtime change.
6. **Risk level: SAFE** for the minimal (type-assertion-test) version; **HIGH RISK** for
   the full-merge version (touches the backend's build pipeline and requires resolving
   already-existing shape differences without knowing yet whether each one is intentional).
7. **Dependencies/call sites affected (minimal version):** none — a new test file only.
8. **Tests:** the minimal version *is* a test — a type-level assertion added specifically
   to catch this. No existing tests change.

### F8 — Four independently-mounted React roots talk to each other via `window`

1. **Current problem:** `Grid`, `ContextMenu`, `MachineFilterDropdown`, and
   `GroupFilterDropdown` are each mounted with their own `createRoot(...).render(...)` in
   `app.ts`, rather than as children of one component tree. With no shared parent, they
   (and the various modals opened imperatively from plain DOM handlers) reach each other
   through the `window` bridge — this is the real reason 17 of the 43 bridge targets are
   still genuinely load-bearing (§4.4/§5).
2. **Why it is a problem:** it's the one place `window` is doing real, ongoing
   architectural work rather than leftover work from the legacy migration — meaning it
   can't be pruned away like F5's dead 26, only replaced by giving these trees a shared
   parent (context/props) or an explicit, typed call-registry module.
3. **Current files/modules involved:** `app.ts` (the 4 `createRoot` calls), `Grid.tsx`,
   `ContextMenu.tsx`, `MachineFilterDropdown.tsx`, `GroupFilterDropdown.tsx`, and every
   modal component reached via the live bridge entries.
4. **Proposed change:** not proposed for the incremental follow-up. Two directions exist
   (a single root tree with context; or a small explicit `web/js/app-actions.ts` module
   the 4 roots import instead of touching `window`) but choosing between them is a real
   design decision with UI-behavior risk, not a mechanical cleanup — it needs its own
   scoped discussion, separate from this plan.
5. **Expected benefit:** (if done) the remaining ~17 bridge entries would also go away,
   and `app.ts`'s `Window` interface could be deleted entirely.
6. **Risk level: HIGH RISK.** Touches how every screen in the app is wired together.
7. **Dependencies/call sites affected:** effectively the whole `ui/components/` tree.
8. **Tests:** would need a full pass across every affected component's tests; not scoped
   here.

**Update (2026-09-02): DONE — but not as proposed above.** The user asked for a deeper dive
before deciding, which surfaced a different picture than the original framing: grepping
*every* live `Window`-interface entry's real call sites (not trusting the doc comments)
showed the "4 roots need to talk to each other" story doesn't actually hold up. Four buckets
emerged:

1. **Dead leftovers, never pruned.** `window.paintSel` and `window.patchCells` had **zero**
   real callers left — both had already been superseded by direct imports elsewhere in
   earlier slices, and nobody noticed. Deleted outright, along with the corresponding dead
   test-fixture lines. `window.notify` is in the same boat as an actual call target (nothing
   calls it since F9 finished) but many test files still rely on it as a working safety net
   for the store-aliasing pattern — left in place, its doc comment updated to say so, rather
   than force a much larger unrelated test-file cleanup.
2. **Leaf utilities with zero cycle risk — the large majority (~20 entries).**
   `saveFilters`/`updateMachBtn`/`fillGroupSel`/`openStats`/`openCellAction`/`toggleFav`/
   `gotoPrevFree`/`gotoNextFree`/`machById`/`updateUserChip`/`dbg`/`applyDebug`/`dbgOn`/
   `handleError`/`presenceTick`/`connectSSE`/`refreshNow`/`stampRef`/`readFile`/
   `applyTheme`/`centerToday`/`syncJumpControls`/`ensureOverflow`/`prependWeek`/
   `nextFreePtr`/`prevFreeBefore`. Each source module's own imports were checked for a path
   back to its caller; none exist. Converted to plain direct ES imports — mechanical, the
   same risk profile as the F9 batches, not a redesign.
3. **A genuine imperative-code-into-React need — but root count doesn't cause it.**
   `window.render` was still called by `grid-scroll.ts`/`grid-interaction.ts`, which are
   deliberately **not** React components (event-delegation/DOM-measurement code, by the
   modules' own header comments) — merging the 4 roots into one tree would not have removed
   this call, since non-React imperative code still needs *some* way to poke a mounted
   component regardless of tree shape. Solved with a new `ui/grid-render-bridge.ts`
   (`registerGridRenderTrigger`/`triggerGridRender`) — the same module-scope-ref pattern
   `Grid.tsx` already used internally, factored out so the two plain modules can import it
   directly without an import cycle (both already have an edge *from* `Grid.tsx` the other
   way — `daysPerWeek`, `paintSelection`).
4. **Two real import-graph cycles — also unrelated to root count.** `AdminModal.tsx` ↔
   `MachineFormModal.tsx` ↔ `LogModal.tsx` now import `openAdmin`/`openMachineForm` directly
   from each other, a genuine 3-way cycle — safe because every use is inside an event
   handler, never at module top level (by the time a click can fire, every module involved
   has finished evaluating; deferred ESM cycles of this shape are well-supported). `showCtx`/
   `hideCtx`/`toggleFav`/`gotoPrevFree`/`gotoNextFree`/`openCellAction`/`prependWeek` instead
   take an injected `GridInteractionHandlers` struct (`initGridInteraction(handlers)`) inside
   `grid-interaction.ts`, since it's a dependency-graph "hub" several of those modules import
   *from* (`selection`/`paintSelection`/`clearSelection`) — a direct import back would cycle.
   `app.ts` (already importing every module, no cycle risk of its own) wires the real
   implementations in once at boot, mirroring the render-bridge pattern above.

**Conclusion: the original Option A (merge the 4 roots into one tree) was rejected outright**
— nothing on the bridge actually needed tree machinery (React context, refs across siblings).
Every component already reads the same module-singleton `store` regardless of where it's
mounted, so there was never a prop-drilling problem a shared parent would solve. `app.ts`'s
`Window` interface shrank from ~30 entries to 3: `S` (F9's own remaining shrink-as-you-go
bridge), `notify` (documented dead-but-harmless safety net), and `mutate`/`askConfirm` (kept
deliberately, per the file's own header comment, for their genuinely wide fan-out across
already-gated components — a separate tradeoff this investigation didn't implicate, not
something F8 caused or fixes).

Test files were converted the same way as F9's cross-file fixes: `vi.mock()` the
now-directly-imported module where a test needs to observe/control a call (the mock cleared,
not reassigned, each test); left real implementations running unmocked where they're
provably harmless (a pure function reading store data the test already set up, or a
DOM/localStorage side effect with nothing present to break). Two component tests
(`AssistantModal.test.tsx`, `ContextMenu.test.tsx`) needed a one-time `initGridInteraction()`
call with a throwaway `#grid` element, since their rendered trees indirectly call
`clearSelection()` → `handlers.hideCtx()`, and `grid-interaction.ts`'s `handlers` stays
`null` until initialized.

Verified: full gate green (789 tests, 62 files, stable — the many test-fixture conversions
net out to the same count), 100% coverage on the new `grid-render-bridge.ts`.

### F9 — `window.S` is the de facto state API; `Store.set`/`Store.get` are dead

1. **Current problem:** (already documented in §7 of this audit in full, with counts —
   172 `window.S.<field>` accesses across 29 files, 0 calls to `store.set`/`store.get`
   anywhere). Repeating only the verdict here for the priority ranking.
2. **Why it is a problem:** direct field mutation bypasses the store's auto-notify safety
   net; callers must remember to call `window.notify()` themselves, which is optional by
   construction, not enforced.
3. **Current files/modules involved:** effectively every `ui/*` module and component that
   touches state — see §7 for the specific heaviest consumers.
4. **Proposed change:** not proposed now. Per this dimension's own instruction ("do not
   redesign the state system unless genuinely required; prefer the smallest useful
   improvement") and `PROGRESS.md`'s pre-existing note (already flagged, not urgent, no
   bug traced to it), this stays a distinct, separately-scoped decision.
5. **Expected benefit:** (if done) removes an entire class of "forgot to call notify"
   bugs; makes `state.ts`'s `Store` type earn its place instead of being 80% dead code.
6. **Risk level: HIGH RISK.** Touches the read/write pattern of the single most
   widely-used piece of state in the app.
7. **Dependencies/call sites affected:** effectively the whole frontend.
8. **Tests:** would need updating across most `ui/*.test.ts`/`*.test.tsx` files that
   currently seed `window.S` directly; not scoped here.

**Update (2026-09-02): DONE, shipped in three slices.** Asked directly whether to tackle
this, the user first picked "bounded first slice" over "everything now" or "just stop the
bleeding" — then, once that slice landed clean, asked to continue with the rest of the
components in two further batches, deliberately choosing the plain `store.get()`/`set()`/
`notify()` API over a `useSyncExternalStore` reactive hook (confirmed via grep that no
component currently subscribes reactively to the store — only `app.ts`'s single
`store.subscribe()` exists, driving the Grid's `render()` — so a hook would add machinery
nothing yet needs).

**Slice 1** — the 11 plain `.ts` orchestration files (99 of the ~162 `window.S` sites).
What shipped: `web/js/store-instance.ts` (new) — the store singleton + hydration, moved
out of `app.ts` so any plain `.ts` module can `import { store }` directly. All 11 files
(`app.ts`, `grid-interaction.ts`, `grid-scroll.ts`, `mutate.ts`, `category-fold.ts`,
`favorite-jump.ts`, `live-connection.ts`, `cell-patch.ts`, `machine-lookup.ts`,
`user-chip.ts`, `debug-panel.ts`) now read via `store.get()` and write via `store.set()`
— **except** where the current code deliberately mutates a field silently and defers a
single explicit notify to later (several real cases: `ensureOverflow`'s bypass-the-store
direct-render pattern; `resetView`, which every caller notifies after; `jumpToMonth`/the
`btnToday` handler, which write `startMonday` then call `resetView()` then notify once).
Those sites use `store.state.field = value` (direct mutation, no auto-notify) specifically
to avoid double-notifying — collapsing them into `store.set()` would have rendered twice
per action, or once with the grid still hidden. Getting this right required reading each
call site's actual notify timing, not a mechanical find-replace.

**Slices 2 and 3** — the 18 React components (63 sites), in two batches (Grid/GridBody/
MyBookingsModal/the two filter dropdowns first; the remaining 13 modal/menu components
second). Same per-site notify-timing analysis as slice 1: `AllBookingsModal`'s `goto`,
`AssistantResults`' `gotoRun`, and `MyBookingsModal`'s own `gotoRun` all write two fields
silently (`machSel`, `startMonday`) because `saveFilters()`/`updateMachBtn()`/`resetView()`
run before the one eventual notify; `AskUserNameModal`'s save is the same shape for one
field; `Grid.tsx`'s `computeGridViewModel` writes `visD`/`visM` silently for a second
reason beyond timing — they're a side effect of render other code reads later, and must
not risk re-triggering a render via the store subscription while already mid-render.
Every other site across both batches was a pure read (the large majority) or a
write-immediately-followed-by-notify that collapses cleanly into one `store.set()` call
(e.g. `SettingsModal`'s weekends toggle).

A real cross-file trap surfaced during verification (first in slice 1, then recurred for
every newly-migrated component in slices 2–3): a component test calling into now-migrated
functions but stubbing `window.S` as a plain object disconnected from the real `store`
singleton — in production `app.ts`'s `window.S = store.state` keeps them the same object
always, but a test that builds its own `window.S = {...}` never goes through that bridge.
Fixed by aliasing `window.S = store.state` in each affected test's setup (matching
production exactly) and, where a test counted `window.notify` calls, wiring
`window.notify = () => store.notify()` too (also matching production) with a
`vi.spyOn(store, 'notify')` as the single source of truth for "was a repaint triggered" —
since migrated code now calls `store.notify()` directly, a disconnected `window.notify`
mock silently missed those calls. By the end of slice 3 this pattern had touched every
component test file that seeds `window.S`.

Verified: full gate green after every slice (789 tests, 62 files, stable across all three);
slice 1 additionally verified with a `docker compose up -d --build` + `/api/health`/
`/api/state` round-trip against existing data (`rev` unchanged, 245 machines). A
real-browser smoke could not be completed this pass (Playwright's browser download was
network-blocked in this environment) — relied instead on the gate's notify-call-count
assertions, which verify the exact behavior-preservation concern (timing/count of
repaints) more precisely than a screenshot would.

`window.S` itself is not deleted — it stays as the read bridge other still-legacy globals
(`window.machById`, `window.mutate`, `window.saveFilters`, etc., none of which are part of
this app's own module graph) rely on. What's done is that every `.ts`/`.tsx` module *this
app owns* now goes through `store.get()`/`store.set()`/`store.notify()` instead of reaching
through the bridge directly.

### F10 — `orderedMachines`/`displayGroup` in `ui/grid.ts` (optional)

1. **Current problem:** these two functions (favorites-aware machine ordering/grouping
   for display) are DOM-free, like `getBooking` (F6), but conceptually closer to "how the
   grid presents machines" than to a generic domain accessor.
2. **Why it is a problem:** borderline at most — not a clear ownership mismatch the way
   `getBooking` is (single dominant consumer, `ui/grid.ts` itself, plus a couple of
   filter/modal components that are already grid-adjacent).
3. **Current files/modules involved:** `ui/grid.ts`.
4. **Proposed change:** none recommended. Named here only for completeness, since the
   request asked to double-check everything — this one was checked and found not worth
   moving.
5. **Expected benefit:** n/a.
6. **Risk level:** n/a (no change proposed).
7. **Dependencies/call sites affected:** n/a.
8. **Tests:** n/a.

---

## 11. Priority ranking

**Read this before the table:** F1 is a correctness bug, not a refactor, and matters more
than every P0 item combined despite being HIGH RISK — "P0" here means "obvious/safe
cleanup to do first," not "most important."

| Priority | Items | Status |
|---|---|---|
| **Fix first (bug, not ranked with the refactors)** | **F1** | **DONE** — `server/model.ts` gained `blockReason`/`isDayAvailable`; `server/mutate.ts`'s `writeCell` now checks both. New tests in `model.test.ts`/`mutate.test.ts` cover the maint-slot and days-mask cases end to end. |
| **P0 — obvious, safe improvements** | F2, F3, F4, F5 | **DONE**, four separate commits. F5 (the `app.ts` bridge prune) was additionally verified with a rebuilt production image + browser smoke (grid renders, zero console errors), since `app.ts` is coverage-excluded by design. |
| **P1 — important architectural improvements** | F6, F7 (minimal) | **DONE.** F6: `getBooking` moved to `core/booking-queries.ts`, 6 call sites repointed. F7-minimal: `server/types-contract.test.ts` added — a compile-time field-name check between `shared/types.ts` and `server/types.ts`, verified to actually fail (not vacuous) by a throwaway sanity break before committing. |
| **P2 — worthwhile but larger refactors** | F8, F9 | **DONE.** F9: three commits (bounded first slice, then two component batches). F8: investigated first — the "4 roots" framing didn't hold up against actual call sites — then shipped a different, smaller fix (direct imports + 2 typed bridge modules), not a tree merge. See each write-up above. |
| **P2 — worthwhile but larger refactors** | F7 (full merge version) | **Open, by design.** Needs a real decision (how much to merge) that shouldn't be made as a side effect of cleanup. |
| **P3 — optional / aesthetic** | F10 | Checked, not worth doing. |

A `formatTimestamp` consolidation (a triplicated `new Date(x).toLocaleString('de-DE')`
found during the file-by-file review of `core/dates.ts`, not originally in the F-numbered
list) landed alongside F3/F4 as the same kind of small, safe merge.
