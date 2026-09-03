# SPEC — Feature Map (what exists, and exactly where to find it)

A debugging-oriented map from **user-visible feature** → **the exact files/functions that
implement it**, including the data flow between them. Where `FEATURES.md` is a checklist
("does X still work?") and `ARCHITECTURE.md` is the rework's design rationale ("why is it
built this way?"), this document answers a third question: **"X is broken — which file do I
open first?"**

Every file reference is `path:line`-style where a specific spot matters, or just `path` when
the whole file is the relevant unit. Paths are relative to the repo root. This file describes
the **current** codebase (post-Phase 11) — it is not a history of how it got here; see
`PROGRESS.md`/`PHASE7-PLAN.md` for that.

## How to use this doc

1. Find the feature area below that matches what's broken (grid rendering, a specific modal,
   booking conflicts, live updates, …).
2. Read that section's **Where it lives** table top to bottom — it's ordered the way a request
   actually flows (UI event → pure logic → server, or server → SSE → UI).
3. Check **Debugging tips** for the fastest way to see what's actually happening (a
   `localStorage` flag, a `console` line, a `curl` command).
4. If the bug is in *pure logic* (a `core/` file), its test file is the fastest way to
   reproduce it in isolation — no browser, no server, just `npm test -- <file>`.

## Contents

- [Big picture](#big-picture)
- [Grid: rendering & navigation](#grid-rendering--navigation)
- [Selection: click, drag, keyboard](#selection-click-drag-keyboard)
- [Booking: create, edit, delete, undo](#booking-create-edit-delete-undo)
- [Weekend bridging](#weekend-bridging)
- [Machines & Messtechnik: categories, groups, favorites](#machines--messtechnik-categories-groups-favorites)
- [Maintenance & availability blocking](#maintenance--availability-blocking)
- [Assistant: automatic multi-day booking search](#assistant-automatic-multi-day-booking-search)
- [Reports: All Bookings, My Bookings, Stats, Activity Log](#reports-all-bookings-my-bookings-stats-activity-log)
- [Admin: machine CRUD & reordering](#admin-machine-crud--reordering)
- [Presence & live updates (SSE)](#presence--live-updates-sse)
- [Identity & settings](#identity--settings)
- [The REST API (`/api/v1/*`)](#the-rest-api-apiv1)
- [Data layer: schema, seed, backups](#data-layer-schema-seed-backups)
- [State management: the store](#state-management-the-store)
- [Modal system](#modal-system)
- [Quick reference](#quick-reference)

---

## Big picture

One page (`web/index.html`) shell + a React frontend, talking to a zero-dependency Node
backend over both a legacy `/api/state`+`/api/mutate`+SSE trio **and** a newer, parallel
`/api/v1/*` REST API — both funnel through the *same* single server-side write path
(`server/mutate.ts`'s `applyMutate`), so there is only ever one place a booking can actually
be written. The frontend is a pure-core / thin-net / DOM-touching-ui split:

```
shared/         types + date math BOTH sides import (the wire contract)
server/         Node + SQLite, zero runtime deps, the one write path
web/js/core/    pure domain logic — no DOM, the highest-value tests
web/js/net/     fetch/SSE plumbing, still no DOM
web/js/ui/      React components + DOM-touching modules, built on core/net
```

Read `ARCHITECTURE.md §4` for the full annotated directory tree if you need the *design*
reasoning; this document only tells you where behavior lives.

**Boot sequence** (`web/js/app.ts`, run once as the page's `<script type="module">`):
1. Mounts the four always-present React roots: `Grid` → `#grid`, `ContextMenu` → `#ctxMenu`,
   `MachineFilterDropdown` → `#machDrop`, `GroupFilterDropdown` → `#groupDrop`.
2. Wires grid interaction (`ui/grid-interaction.ts`), infinite scroll (`ui/grid-scroll.ts`),
   the collision banner, debug panel, column-resize, theme, and every toolbar button.
3. Calls `net/api.ts`'s `readFile()` to load `/api/state`. On success → `startUI()` (reveals
   the toolbar/grid, prompts for a name on first run, starts SSE). On failure → shows the
   "Verbindung zum Server fehlgeschlagen" screen and stops — **this is the first place to
   look if the app never gets past a blank/loading screen**.

**Toolbar buttons** (`app.ts`'s `wireToolbarButtons()`) — the fastest lookup for "which modal
does this button open":

| DOM id | Opens |
|---|---|
| `#btnAssist` | `AssistantModal.tsx`'s `openAssistant` |
| `#btnMine` | `MyBookingsModal.tsx`'s `openMyBookings` |
| `#btnAll` | `AllBookingsModal.tsx`'s `openAllBookings` |
| `#btnSettings` | `SettingsModal.tsx`'s `openSettings` |
| `#btnHelp` | `HelpModal.tsx`'s `openHelp` |
| `#btnStats` | `StatsModal.tsx`'s `openStats()` |
| `#btnAdmin` | `AdminModal.tsx`'s `openAdmin` |
| `#btnRefresh` | `ui/mutate.ts`'s `refreshNow(false)` |
| `#userChip` click / dblclick | `AskUserNameModal.tsx`'s `askUserName(false)` / `ActiveUsersModal.tsx`'s `openActiveUsers` |

---

## Grid: rendering & navigation

The week grid: machines as rows (grouped by category → group), dates as columns, infinite
horizontal scroll, sticky machine column.

| Concern | File | What's there |
|---|---|---|
| Row/cell classification (pure) | `web/js/ui/grid.ts` | `classifyCell` (free/booked/blocked/unavail), `cellClass`, `classifyDot` (today-indicator state), `buildGridRows` (the flat category→group→machine row list, folding/filter-aware), `orderedMachines`, `visibleWeeks`, `nameColor` |
| The React component | `web/js/ui/components/Grid.tsx` | header (KW numbers, weekday/date columns, today marker), category/group toggle buttons; mounted once at boot onto `#grid` |
| Row bodies | `web/js/ui/components/GridBody.tsx` | split out of `Grid.tsx` for file-size budget only — same component conceptually; renders the today-dot, favorite star, next-free jump buttons, and every data cell |
| Manual re-render trigger | `web/js/ui/grid-render-bridge.ts` | `registerGridRenderTrigger`/`triggerGridRender` — the one hook non-React code uses to force `Grid` to re-render (e.g. after a direct `window.S` mutation) |
| Imperative single-cell patch | `web/js/ui/cell-patch.ts` | `refreshCell`/`refreshDot`/`patchCells` — used by the SSE `update` handler to patch just the changed cells instead of a full grid re-render (perf) |
| Scroll / infinite growth | `web/js/ui/grid-scroll.ts` | `initGridScroll`, `prependWeek`, `ensureOverflow`, `centerToday`/`centerColumn`/`gotoDate`, the month/year jump controls, the ◀/▶/Heute toolbar buttons |
| Column width drag-resize | `web/js/ui/column-resize.ts` | `initColumnResize` — drags `#colResize`, persists to `mb_machw` |
| Machine id → object cache | `web/js/ui/machine-lookup.ts` | `machById` — a reference-equality cache over `S.data.machines`; `invalidateMachineLookupCache()` must be called after any structural (machine-list) write, or a create/delete won't be seen. **`ui/mutate.ts`'s `mutate()` calls this automatically** — if you bypass `mutate()`, you'll hit stale-cache bugs here. |

**Debugging tip:** the grid never renders before the first data load (`store.subscribe` guard
in `app.ts`). If cells look stale after a write, check whether the write went through
`ui/mutate.ts`'s `mutate()` (which decides patch-vs-full-repaint) rather than mutating
`S.data` directly.

## Selection: click, drag, keyboard

Rectangle cell selection — the source of the context menu, the booking form's date range, and
keyboard navigation.

| Concern | File | What's there |
|---|---|---|
| Geometry (pure) | `web/js/ui/selection.ts` | `computeSelCells` (anchor↔focus rectangle), `clampIndex` |
| DOM wiring | `web/js/ui/grid-interaction.ts` | `initGridInteraction` (mousedown/mouseover/mouseup drag-select, click/dblclick, all keyboard nav, drag-auto-scroll at grid edges), `paintSelection`/`clearSelection`, the exported `selection` state object |
| Context menu | `web/js/ui/components/ContextMenu.tsx` | `showCtx`/`hideCtx`, the delete-selection confirm+mutate flow |

`initGridInteraction` takes its higher-level actions (open booking form, toggle favorite,
jump to next free day, …) as an **injected** `GridInteractionHandlers` struct, wired once in
`app.ts` — if a click handler isn't firing, check that wiring first, not the DOM listener
itself.

## Booking: create, edit, delete, undo

| Concern | File | What's there |
|---|---|---|
| Pure reducers | `web/js/core/bookings.ts` | `bookCells` (conflict-check + apply), `deleteCells`/`deleteOwnCells`/`deleteSelectedCells`/`deleteGroup` (four distinct delete shapes), `findSameNameWorkdayRun`, `findBookingGroup`, `getBooking`, and `sweepWeekends` (see next section) |
| Booking form | `web/js/ui/components/BookingForm.tsx` | name/date-range/note inputs, client-side validation (empty name, inverted range, too-many-cells), conflict list + "book only the free ones" fallback |
| Booking detail (view/delete existing) | `web/js/ui/components/BookingDetailModal.tsx` | shows who/when/note, detects a same-name run or a booking-group and offers whole-run/whole-group delete, `openCellAction` (routes a cell click to either this or `BookingForm` depending on whether it's occupied) |
| The one write path | `web/js/ui/mutate.ts` | `mutate(fn, logAction)` — applies `fn` to `S.data` **synchronously** (optimistic), logs, repaints (patches ≤500 changed cells, else full notify), then persists to the server in the background; `refreshNow`/`stampRef` |
| Toasts + undo | `web/js/ui/toast.ts` | `toast`, `offerUndo` — replays each undo entry's `prev` value, but sends the **cell's current value** as the CAS check, not the stale pre-action value (a real bug fix, see the file's own comment) |
| Server validation + write | `server/mutate.ts` | `applyMutate`'s cell-delta path (`applyCells`): blocked-day check, weekday-availability check, "never overwrite a foreign booking" rule, weekend auto-bridge maintain hook |

**Data flow for a click-to-book:** `GridBody.tsx` cell click → `grid-interaction.ts`
delegated handler → `BookingDetailModal.tsx`'s `openCellAction` → `BookingForm.tsx` (if free)
→ on submit, `window.mutate(fn, log)` → `core/bookings.ts`'s `bookCells` runs against the
in-memory `S.data` copy → UI repaints immediately → `ui/mutate.ts` POSTs to `/api/mutate` in
the background → `server/mutate.ts`'s `applyMutate` re-validates and writes → SSE broadcasts
`update` to every other connected client.

**Debugging tip:** a "conflict" the UI shows but you don't expect almost always traces to
`server/mutate.ts`'s `blockReason`/`isDayAvailable` (via `server/model.ts`) disagreeing with
what the client's own `core/machines.ts` predicates think — the server is the one that
matters (client-side checks are UX-only, never trusted).

## Weekend bridging

A weekend day (Sat/Sun) only belongs in the plan as part of a continuous Fri→Mon series.

| Concern | File | What's there |
|---|---|---|
| Client-side REMOVE (sweep) | `web/js/core/bookings.ts` | `sweepWeekends` — called by every delete reducer in this same file; removes an orphaned weekend day once its bridging Friday or Monday is no longer booked |
| Server-side ADD (bridge) | `server/bridge.ts` | `missingBridges` (pure), `maintainBridges` (runs inside every cell-delta write's transaction, `server/mutate.ts`'s `applyCells`), `backfillBridges` (one-time whole-DB pass) |
| Backfill CLI | `server/backfill.ts` | `node dist/server/backfill.js` — a **production data write**, run deliberately, not automatically |

`sweepWeekends` used to be its own file (`web/js/core/weekend.ts`); it was merged into
`bookings.ts` in Phase 11 because it had exactly one consumer (that file's own delete
reducers) — if you're looking at old docs/commits mentioning `core/weekend.ts`, that file no
longer exists.

## Machines & Messtechnik: categories, groups, favorites

| Concern | File | What's there |
|---|---|---|
| Pure domain logic | `web/js/core/machines.ts` | `getMachineCategory`, `groupsByCategory`, `saveMachine`/`deleteMachine`/`moveMachine` (the write-path reducers), `generateMachineIdFromName` (the slug/hash id generator), `applyFormFieldsToMachine` |
| Favorites | `web/js/ui/favorite-jump.ts` | `toggleFav`, plus the "next/previous free day" jump feature (`gotoNextFree`/`gotoPrevFree`, `nextFreeAfter`/`prevFreeBefore`) — favorites float to their own "★ Favoriten" pseudo-group in the grid, the machine filter dropdown, and the Assistant checklist (each has its own row-builder; see `grid.ts`'s `buildGridRows`, `ui/machine-filter.ts`'s `buildMachineFilterRows`, `ui/assistant-checklist.ts`'s `buildChecklistRows` — all three share the same category→group→favorites-float shape but are three separate functions, not one shared one) |
| Machine filter dropdown | `web/js/ui/components/MachineFilterDropdown.tsx` + `ui/machine-filter.ts` | the "Filtern ▾" toolbar dropdown; persists to `mb_machsel` |
| Group filter dropdown | `web/js/ui/components/GroupFilterDropdown.tsx` | the "Alle Bereiche ▾" toolbar dropdown; persists to `mb_groupssel`; `fillGroupSel()` must be called after any structural change (new group) |
| Machine edit form | `web/js/ui/machine-form.ts` (state/validation) + `web/js/ui/components/MachineFormModal.tsx` (chrome) + `MachineFormFields.tsx` (static fields) + `MaintenanceSlotEditor.tsx` (the dynamic slot list) | `initialMachineFormState`, `validateMachineForm`, `draftMaintSlots` |

**Note on `MachineForm`'s field names**: `MachineForm` (in `core/machines.ts`) uses the wire
field names (`cat`, `redu`, `daysMask`, `maint`) directly — an earlier version had a parallel
set of "nicer" alias fields (`category`, `redundancyGroup`, …) that were **dead code**
(nothing ever constructed them) and were removed in Phase 11. If you see those names in an
old commit/doc, they no longer exist.

## Maintenance & availability blocking

Whether a specific machine × date cell is bookable at all.

| Concern | File | What's there |
|---|---|---|
| Client predicates | `web/js/core/machines.ts` | `getMaintenanceSlots` (merges the modern `maint` array with the legacy single-status fields), `isSlotCoveringDate`, `getMaintenanceSlotAtDate`, `isMachineBlockedOnDate`, `isMachineAvailableOnWeekday` (the `days` Mo..So mask), `isCellBookable` (both checks combined) |
| Server predicates (the ones that actually matter) | `server/model.ts` | `blockReason`/`isBlocked` (mirrors `getMaintenanceSlotAtDate`), `isDayAvailable` (mirrors the days-mask check) — these run inside `server/mutate.ts`'s `writeCell` on every single booking write; **this, not the client, is authoritative** |
| Status text rendering | `web/js/ui/machine-text.ts` | `maintText`, `statusRangeText`, `daysMaskText`, `maintenanceKind` |

A machine has **two ways** to be "blocked" that must agree: the newer `maint` JSON array
(list of `{type, from, until, note}` slots) and the legacy single `status`/`statusFrom`/
`statusUntil` fields. Every save clears the legacy fields (`applyFormFieldsToMachine`), so in
practice only `maint` is ever written going forward — but `getMaintenanceSlots`/`blockReason`
both still fall back to the legacy fields for old data. If a machine shows as blocked/unblocked
unexpectedly, check `maint` first, then the legacy `status*` columns in the DB directly.

## Assistant: automatic multi-day booking search

Builds a tree of devices (optionally grouped into "need N of M" redundancy groups), then
searches a date range for runs where the whole tree is satisfiable.

| Concern | File | What's there |
|---|---|---|
| Tree operations (pure) | `web/js/core/assistant.ts` | `treeFind`/`treeFindParent`/`treeDetach`/`treeCleanup` (auto-dissolve single-child groups), `groupNodeOnto`/`joinNode`/`moveNodeToRoot`/`dissolveGroup`, `changeGroupNeed`/`setGroupNeed`, `addDeviceToTree`, `removeNode` |
| The N-of-M solver (pure) | `web/js/core/assistant.ts` | `effectiveNeed`, `isNodeSatisfiable`/`isTreeSatisfiableOnDay`, `hasAnyRedundancy`, `freeDays`, `groupRuns` (splits into Fri→Mon-joined contiguous runs), `extendOpenRuns`, `isSatisfiableAcrossWindow`, `chooseDevicesForNode`/`chooseDevicesForTree` (prefers a continuously-free device over a partially-free one) |
| Checklist (device picker) | `web/js/ui/assistant-checklist.ts` + `web/js/ui/components/AssistantChecklist.tsx` | `buildChecklistRows` — same category/group/favorites shape as the grid/machine-filter row-builders, kept as its own function |
| Work-area tree UI | `web/js/ui/components/AssistantTree.tsx` | drag-and-drop wiring around the pure tree ops above; `.dragover`/`.dragging` classes are imperative DOM, not React state (perf, since `dragover` fires continuously) |
| Search results | `web/js/ui/assistant-results.ts` + `web/js/ui/components/AssistantResults.tsx` | `buildAssistantResults` — pairs each run with an open-ended flag and a clamped default day count |
| The modal / orchestration | `web/js/ui/components/AssistantModal.tsx` | wires checklist → tree → search; the redundancy-confirm dialog (asks "are all equivalent devices here?" before searching, when the tree has a real redundant group) |

**Debugging tip:** a group auto-dissolves the moment it's down to 1 child (`treeCleanup`,
called after every tree mutation) — if a group you just formed "disappeared", that's usually
why, not a bug.

## Reports: All Bookings, My Bookings, Stats, Activity Log

Each of these four is a **pure view-model kernel** (`web/js/ui/views/*.ts`, fully unit-tested,
zero DOM) plus a **React modal** that renders it and owns the filter/sort UI state.

| View | Pure kernel | Modal component |
|---|---|---|
| All future bookings, grouped into runs | `web/js/ui/views/all-bookings.ts` — `computeAllRuns`, `filterAllRuns` | `web/js/ui/components/AllBookingsModal.tsx` |
| Current user's future bookings | `web/js/ui/views/my-bookings.ts` — `computeMyRuns` | `web/js/ui/components/MyBookingsModal.tsx` (prompts for a name first if none set) |
| Utilisation stats (three modes + two drilldowns) | `web/js/ui/views/stats.ts` — `computeStats`, `buildResourceRows`/`buildMaintRows`/`buildPersonRows` | `StatsModal.tsx` (orchestration) + `StatsControls.tsx` (date range/mode/filter inputs) + `StatsOverviews.tsx` (the three list modes) + `StatsDrilldown.tsx` (machine→people / person→machines drilldowns) |
| Activity log | *(no kernel — just slices `S.data.log`)* | `web/js/ui/components/LogModal.tsx` |

`computeStats`'s `bucketResourceRows` bucket key is `` `${category}::${group}` ``, not the bare
group name — a group name shared by a Maschinen resource and a Messtechnik one would
otherwise silently merge their rows. If a stats row looks like it's counting the wrong
machines, check that bucketing first.

The activity log itself is fed by `server/mutate.ts`'s `logAction` (best-effort — a logging
failure never blocks the actual write) and readable live at `GET /api/v1/activity` (cursor
pagination on `log.id`) as well as through `/api/state`'s in-memory client-side `log` array.

## Admin: machine CRUD & reordering

| Concern | File | What's there |
|---|---|---|
| Pure filter/sort | `web/js/ui/views/admin.ts` | `filterAdminMachines` — manual/name/group sort, name+group substring search |
| The modal | `web/js/ui/components/AdminModal.tsx` | the machine list, reorder ▲▼ buttons (manual sort only), routes "＋ Maschine hinzufügen"/"Bearbeiten" to `MachineFormModal.tsx`'s `openMachineForm` |
| Machine form (create/edit/delete) | see [Machines & Messtechnik](#machines--messtechnik-categories-groups-favorites) above | `openMachineForm(null)` = create, `openMachineForm(id)` = edit |

Reordering (`moveMachine` in `core/machines.ts`) swaps a machine with its immediate neighbor
*within the same group only* — moving would-be "across a group boundary" is refused
(`{abort: true}`), both client-side and (via `server/api-machines-write.ts`'s `moveMachine`,
409 CONFLICT) server-side for the REST path.

## Presence & live updates (SSE)

| Concern | File | What's there |
|---|---|---|
| Pure event-payload logic | `web/js/net/sse.ts` | `applyUpdate` (mutates the bookings map, returns the repaint patch), `presenceInfo`, `isForeign` (case-insensitive "was this change mine?"), `remoteMessage` (formats a log line into a toast) |
| DOM/EventSource adapter | `web/js/ui/live-connection.ts` | `connectSSE` (owns the `EventSource`, handles `hello`/`presence`/`update`/`structural` events), `queueRemoteChange` (serializes remote-change toasts one at a time, ~2.6s each, paused while an undo toast is showing), `activeUserRows` (presence entries seen within the last 180s) |
| Presence popup | `web/js/ui/components/ActiveUsersModal.tsx` | `openActiveUsers` |
| Collision banner | `web/js/ui/collision-banner.ts` | shown when the local revision falls behind (a write conflict the client's own pre-check couldn't catch); dismiss re-syncs from `/api/state` |
| Server SSE endpoint | `server/server.ts` | `openStream` — `GET /api/stream[?user=]`; broadcasts `hello` (current rev) on connect, `presence` on connect/disconnect, `update`/`structural` from `mutate.ts`'s injected `Broadcast` callback |

**Debugging tip:** `mb_presence=off` in `localStorage` connects SSE with no `user` query param
(so that browser is invisible in others' presence lists) — if a user "isn't showing up" as
active, check that setting before assuming SSE itself is broken.

## Identity & settings

All persisted to `localStorage`, applied at boot (`app.ts`) and/or from `SettingsModal.tsx`.

| Setting | Key | Applied by |
|---|---|---|
| User name | `mb_user` | `AskUserNameModal.tsx` |
| Theme (auto/light/dark) | `mb_theme` | `web/js/ui/theme.ts`'s `applyTheme` |
| Compact row height | `mb_compact` | toggled directly as a body class, no store round-trip |
| Show weekends (5 vs 7 day weeks) | `mb_weekends` | `ui/grid-scroll.ts`'s `daysPerWeek` |
| Share presence | `mb_presence` | `ui/live-connection.ts`'s `connectSSE` |
| Debug panel | `mb_debug` | `web/js/ui/debug-panel.ts` — `dbgOn`, `dbg(kind, message)`, `handleError` (swallows `AbortError`, logs everything else to both console and the panel), `initDebugPanel` |
| Machine/group filters, favorites, category visibility, folded groups, admin/all-bookings sort | `mb_machsel`, `mb_groupssel`, `mb_favs`, `mb_cats`, `mb_collapsed`, `mb_admsort`, `mb_absort` | their respective modules |
| Grid machine-column width | `mb_machw` | `ui/column-resize.ts` |

**Debugging tip:** set `localStorage.mb_debug = 'on'` and reload — every `dbg()` call
(scattered through `live-connection.ts`, `mutate.ts`, error handlers) then appears both in the
on-page debug panel and (via `handleError`) the browser console, with no code changes needed.

## The REST API (`/api/v1/*`)

A second, parallel entrance onto the same data — **not** a second write engine. Every write
route below still funnels into `server/mutate.ts`'s single `applyMutate`. Full request/response
schemas: `openapi.yaml` (repo root). Route table: `server/server.ts`'s `apiV1Routes`.

| Method + path | Handler | File |
|---|---|---|
| `GET /api/v1/machines` | `listMachines` | `server/api-machines.ts` |
| `GET /api/v1/machines/:id` | `getMachine` | `server/api-machines.ts` |
| `GET /api/v1/machines/:id/bookings` | `listMachineBookings` | `server/api-bookings.ts` |
| `GET /api/v1/machines/:id/bookings/:date` | `getMachineBooking` | `server/api-bookings.ts` |
| `GET /api/v1/bookings?groupId=` | `listBookingsByGroup` | `server/api-bookings.ts` |
| `GET /api/v1/activity` | `listActivity` | `server/api-activity.ts` |
| `POST /api/v1/machines` | `createMachine` | `server/api-machines-write.ts` |
| `PUT /api/v1/machines/:id` | `updateMachine` | `server/api-machines-write.ts` |
| `DELETE /api/v1/machines/:id` | `deleteMachine` | `server/api-machines-write.ts` |
| `POST /api/v1/machines/:id/move` | `moveMachine` | `server/api-machines-write.ts` |
| `PUT /api/v1/machines/:id/bookings/:date` | `putBooking` (supports `If-Match`) | `server/api-bookings-write.ts` |
| `DELETE /api/v1/machines/:id/bookings/:date` | `deleteBooking` (supports `If-Match`) | `server/api-bookings-write.ts` |
| `POST /api/v1/bookings/batch` | `batchBook` (200/207/400) | `server/api-bookings-write.ts` |
| `POST /api/v1/bookings/batch-delete` | `batchDelete` | `server/api-bookings-write.ts` |

Response envelope (`server/api-response.ts`): success = `{data, meta?}`, error =
`{error, code, details?}` with `code` one of `VALIDATION`/`NOT_FOUND`/`CONFLICT`/
`PRECONDITION_FAILED`/`INTERNAL`. `bookingEtag()` (`api-bookings.ts`) computes the CAS token
(`"empty"` for a free cell, else `"<name>:<ts>"`) that `If-Match` compares against.

The **legacy trio** the live grid itself still uses — `GET /api/state`, `POST /api/mutate`,
`GET /api/stream` — is defined directly in `server/server.ts`, not through the router table,
and keeps its own simpler `{error: string}`-only error shape. The two APIs deliberately don't
merge (see `PROGRESS.md`'s Phase 9 plan for why).

## Data layer: schema, seed, backups

| Concern | File | What's there |
|---|---|---|
| Schema + open + migrations | `server/db.ts` | `openDb` (creates schema, retro-fits `redu`/`days`/`maint` columns onto an older DB file), `getMeta`/`setMeta`/`bumpRev` |
| Tables | `server/db.ts`'s `SCHEMA` constant | `machines(id, name, grp, cat, status, statusNote, statusFrom, statusUntil, info, redu, days, maint, sort)` · `bookings(mid, day, name, note, ts, gid, gtitle)` PK `(mid, day)` · `log(id, ts, user, action)` · `meta(key, value)` |
| Row → wire mappers | `server/model.ts` | `machineOut`, `bookingOut`, `getState` (the full `/api/state` payload) |
| First-run seed | `server/db.ts`'s `importFromJson` + `server/import.ts` (CLI) | idempotent unless `--force`; `server/server.ts` runs it once at startup from the volume-mounted or image-bundled `buchungen.json` |
| Daily backup | `server/server.ts`'s `runBackup` | `VACUUM INTO`, one file/day, keeps the newest `BACKUP_KEEP` (default 30) |
| The write path (again — this is the one place all writes converge) | `server/mutate.ts` | `applyMutate` → `applyStructural` (full machine-list replace) or `applyCells` (per-cell delta) |

## State management: the store

| Concern | File | What's there |
|---|---|---|
| The store factory (pure) | `web/js/state.ts` | `createStore(initial)` — `get`/`set` (shallow-merge + notify)/`subscribe`/`notify`; mutates its state object **in place** so the bridged reference stays valid |
| The app's one instance | `web/js/store-instance.ts` | hydrates from `localStorage` + `mondayOfDate(new Date())`, exports the singleton `store` every module imports |
| The legacy `window.S` bridge | `web/js/app.ts` | `window.S = store.state` — the *same object reference*, kept only for modules that haven't migrated to importing `store` directly (mostly still-window-bridged: `mutate`, `askConfirm` — see the file's own header comment for why those two specifically stay bridged) |

Every render-triggering change should end in a `store.notify()` (or `store.set(...)`, which
notifies itself) — a UI that doesn't update after a state change usually means something
mutated `store.state`/`window.S` directly without following up with a notify.

## Modal system

Every modal (all `ui/components/*Modal.tsx` files) shares **one** `#modal`/`#overlay` DOM
pair — only one can be open at a time, by construction.

| Function | File | Behavior |
|---|---|---|
| `openReactModal(node, {sticky?})` | `web/js/ui/modal.tsx` | unmounts whatever was open, mounts `node` fresh into `#modal`, opens `#overlay` |
| `closeReactModal()` | same | unmounts, closes overlay, restores pre-open focus |
| `collapseReactModal()` / the `#modalReopen` tab | same | hides the overlay **without unmounting** — the Assistant's "pin a result" button uses this so a search stays alive behind the grid |
| Escape / backdrop click | same, delegated on `document` | closes the open modal, unless it was opened `sticky: true` (the booking form is sticky — an accidental Escape shouldn't discard an in-progress booking) |

If a modal "won't close" or "closes when it shouldn't", check whether it was opened with
`sticky: true` before assuming the Escape/backdrop handler itself is broken.

---

## Quick reference

**Run the tests for one file** (fastest way to reproduce a pure-logic bug in isolation):
```
docker compose -f docker-compose.dev.yml run --rm dev npx vitest run <path/to/file.test.ts>
```

**Hit the REST API directly** (bypasses the UI entirely):
```
curl http://localhost:3000/api/v1/machines
curl -X PUT http://localhost:3000/api/v1/machines/m1/bookings/2026-09-10 \
  -H 'Content-Type: application/json' -d '{"name":"Test"}'
```

**See the raw DB state**: `sqlite3 data/buchungen.db "SELECT * FROM bookings WHERE mid='m1'"`
(or open it with any SQLite browser — it's a plain file under `data/`).

**Turn on the in-app debug panel**: `localStorage.mb_debug = 'on'` in the browser console,
then reload.

**Find every real call site of a function** before assuming it's dead or safe to change:
`grep -rn "functionName" web server shared` — cheaper than guessing, and it's what this
document itself was built from (see `PROGRESS.md`'s Phase 11 methodology for the full
"notice → trace → decide → fix" process this codebase's own cleanup passes follow).
