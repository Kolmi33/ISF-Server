# PROGRESS — living project state

**Read this first when resuming, and after any context clear.** It is the single source of
truth for *where we are* and *what's next*. Update it whenever an item lands or the plan
changes. (The stable design lives in `ARCHITECTURE.md`; the volatile state lives here.)

_Last updated: 2026-09-02 — **The architecture audit (`docs/ARCHITECTURE_AUDIT.md`) is now
fully resolved except F7's full-merge option (open by design) and F10 (checked, not worth
doing).** F1–F7(minimal) landed earlier same-day; **F9** (the `window.S` → `store` migration)
and **F8** (the "4 React roots" window cross-talk) both landed since, in F8's case after a
re-investigation showed the original "merge the roots" framing didn't hold up against actual
call sites — see the audit's own F8 write-up for what shipped instead. A follow-up code
review then surfaced and fixed two real bugs (undo's CAS check silently skipped after
undoing a booking creation; `machById`'s cache going stale after a machine create/delete)
plus a defensive consistency fix (three modals guarded against opening before data loads) —
see Known Bugs → Fixed. `npm run verify` is green at 797 tests / 62 files.
Also done earlier same-day: Phase 6's two operational items — the deploy
(`docker compose up -d --build`, user-authorized) and the one-time weekend backfill
(`node server/backfill.js`, 1,484 rows inserted, re-run confirmed idempotent at 0) both
ran successfully; production is on the current gated codebase with the weekend maintain
hook live. Every "awaits authorization"/"not run" note below about these two items is
now historical. Also done: the wknd-on-patch bug fix (see Known Bugs → Fixed)._

_Previously: 2026-08-31 — **Phase 7 COMPLETE** — the frontend's React migration (Backlog B,
tracked slice-by-slice in `PHASE7-PLAN.md`) has landed in full: `web/public/legacy.js` (the
non-module monolith this file's "Current state"/"Done log" below describe extracting FROM,
Phase 1.2 onward) is deleted outright, and the frontend is 100% gated TypeScript + React. The
"view-layer decision: no framework" note under "Next step" below is superseded by that — see
`PHASE7-PLAN.md`/`ARCHITECTURE.md §18` for the React adoption rationale._

_Previously: 2026-08-29 — **Phase 6 COMPLETE (code)** — backend → gated TS under `server/` + weekend auto-bridging (maintain hook + backfill CLI). Whole roadmap (0–6) implemented & gated._

---

## How to resume (after a context clear or a new session)
1. Read this file — the "Current state" and "Next step" below.
2. Read `CLAUDE.md` (operating manual) and `PRINCIPLES.md` (coding standard). Skim
   `ARCHITECTURE.md` (design/decisions) and `FEATURES.md` (acceptance checklist) as needed.
3. `git log --oneline` — confirm the last landed step matches "Done log" below.
4. Run the gate — it must be green before you continue:
   `docker compose -f docker-compose.dev.yml run --rm dev npm run verify`
5. Continue from "Next step". Work the backlog top-down: one item → per-module loop →
   verify → commit. Update this file as items land.

## Current state
- **Phase 0 / 0.5 — done. Phase 1 — COMPLETE** (1.1–1.4b).
- **Phase 2 — in progress.** 2.0 + 2.1 landed:
  - `web/js/app.ts` — the ESM entry/bridge. Loaded as `<script type="module">` BEFORE
    `legacy.js` (which is now `defer`); both run post-parse in document order, so the bridged
    globals exist before legacy's `init()`. It does `Object.assign(window, dates)`.
  - `web/js/core/dates.ts` (+ `dates.test.ts`, 22 tests, **100% cov**) — the 12 pure date
    helpers extracted from `legacy.js` and deleted there; legacy calls them via the window bridge.
  - Coverage is now **enforced by `verify`** (`test:cov`, threshold 90/85 on `core/**`); TZ pinned
    to UTC in `test/setup.ts` for deterministic date tests; `tsconfig` allows `.ts` import specifiers.
  - `shared/types.ts` seeded (the domain contract): `Machine`, `MaintSlot`, `MachineCategory`.
    It grows as extraction surfaces more fields.
  - `web/js/core/machines.ts` (+ `machines.test.ts`, 18 tests, 100% cov) — the pure resource
    category + maintenance/availability predicates (`catOf`, `maintSlots`, `slotCovers`, `maintAt`,
    `isBlockedM`, `anyMaint`, `dayAvailable`, `cellBookable`), extracted and deleted from `legacy.js`.
    The German status-text helpers (`maintText`, `statusRangeText`, `daysMaskText`, `blockText`,
    `maintKind`) stayed in `legacy.js` (presentation; move with the views in Phase 4).
  - `web/js/core/weekend.ts` (+ `weekend.test.ts`, 6 tests, 100% cov) — the live `sweepWeekends`
    (removes orphaned Sat/Sun days on booking writes), extracted + bridged.
  - **`migrating` bug FIXED** (see Known bugs → Fixed): removed the two obsolete file-era
    Bestands-Migrationen (`migrateWeekends`/`migrateMesstechnik`) and their `startUI()` calls.
    They never ran (threw on undeclared `migrating`/`migratingMess`) and the server *rejects* the
    weekend-bridge write (HTTP 400), so removal preserves behavior (no migration ran before/after)
    while clearing the console error. `missingWeekendBridges` was only used by the removed migration,
    so it was deleted too (not extracted).
  - **2.4a** `web/js/core/assistant.ts` (+ `assistant.test.ts`, 16 tests, 100% cov) — the pure
    Assistant **tree ops** (`treeFind`, `treeFindParent`, `treeIsAncestor`, `treeDetach`, `treeDevs`,
    `treeDevUid`, `treeCleanup`). The Assistant is heavily UI-coupled (AS_TREE global + DnD + DOM),
    so legacy keeps **thin one-line adapters** (`asFind`, …) that bind `AS_TREE` and delegate to
    core — call sites unchanged; adapters retire in Phase 4 when AS_TREE becomes a store.
    Browser-verified: core + adapters + the real `asAdd`→`asDevs` mutation path all work; console clean.
  - **2.4b** the Assistant **N-of-M solver** — `nodeNeed`, `nodeFree`, `dayOk`, `anyRedund`,
    `nextWeekday`, `freeDays`, `groupRuns`, `extendOpenRuns`, `winFree`, `pickNode`, `pickFor`
    extracted into `core/assistant.ts`, **parameterized by an injected `isFree(id,day)` predicate**
    so the scheduler is a pure function of (tree, days, availability). `runAssistant` refactored to
    call them (keeps its DOM/result rendering + the S-coupled `isFreeDev`). +15 tests, 100% cov.
    Browser-verified by **running the Assistant end-to-end**: correct result card
    ("… durchgehend frei (offen – 542 Tage wählbar)"), core cross-check matches, console clean.
- **Phase 2 is COMPLETE.** All four core modules extracted, tested (78 tests, 100% cov on `core/**`),
  and behavior-verified.
- **4.1c-2 (reactive wiring, rest) DONE 2026-08-29** — migrated all 27 remaining direct `render()`
  calls to `notify()` (bulk, then reverted the two internal render/overflow-loop sites back to direct
  `render()`: `ensureOverflow` and the keyboard grow-right — they must not re-enter via the store).
  `render()` now appears only as its definition, those two loops, and the store subscription; every
  user repaint routes through `store.notify()`. Smoke via instrumented render-count on real clicks:
  btnNext/btnPrev = exactly 1 render each (KW 34/35/36 ↔ 35/36/37); btnToday = 2 (notify + prependWeek,
  pre-existing, not a new double); category-filter toggle = exactly 1 render, grid 163 ↔ 263 rows;
  console clean; `rev` 23. **Phase 4.1 complete — grid logic extracted + store-reactive.**
- **4.1c-1 (reactive wiring, core) DONE 2026-08-28** — `app.ts` subscribes the legacy `render` to the
  store (`store.subscribe`, guarded so the grid never renders before the first data load) and bridges
  `window.notify = () => store.notify()` (Window augmented with `render`/`notify`). The two runtime
  data-change paths — `refreshNow` (`S.data=d; notify(); stampRef()`) and the SSE `structural` handler
  (`… fillGroupSel(); notify()`) — now trigger the repaint **through the store**, delivering the
  deferred 3.3 goal (SSE/refresh → store → notify → render). The SSE `update` handler keeps its
  `patchCells` fast path; the ~34 UI-trigger `render()` calls stay direct for now (mixed mode is safe
  — both call the same render). Smoke: `notify()` after a `S.startMonday` mutation repainted the header
  (KW 34/35/36 → 35/36/37) and restored; migrated `refreshNow` ran store-driven (3675 cells, no error);
  console clean; `rev` 23. **First real store.notify consumer is live.**
- **4.1b (ui/grid header + dot) DONE 2026-08-28** — `web/js/ui/grid.ts`: `weekHeaderCells` (KW +
  weekday/date header columns; pure over core/dates — the gap-`<th>` asymmetry between the two header
  rows preserved) and `classifyDot` (5-state today-dot: defekt/maint/busy/unavail/free), which dedups
  the dot decision across `render()` and `refreshDot()`. +5 tests, 100% cov. Smoke: header shows KW
  34/35/36, 15 day columns, exactly 1 today column, "Mo17.08." format; 245 dots (232 free / 13 busy);
  `refreshDot` idempotent ("heute belegt: Hensler"); console clean; `rev` 23. Remaining row-header
  string assembly stays in legacy for now (see backlog 4.1b note).
- **4.1a (ui/grid cell model) DONE 2026-08-28** — `web/js/ui/grid.ts`: pure `classifyCell` (4-state
  priority), `isMine` (case-insensitive owner check), `cellClass` (class stem). +9 tests, 100% cov.
  `render()` and `refreshCell()` both refactored to the shared helpers — removes the per-cell decision
  duplication that had already drifted (title/aria richness) between them. New `ui/` gate layer
  (coverage 90/85). Smoke: grid renders (216 booked / 40 mine / 245 today / 3459 free), `refreshCell`
  idempotent vs. the full render for booked+free cells, console clean, `rev` 23. Pre-existing
  `wknd`-on-patch asymmetry preserved (Known bugs → Open). **Phase 4 started.**
- **3.3 (net/sse) DONE 2026-08-28** — `web/js/net/sse.ts`: pure event logic `applyUpdate`
  (mutates bookings, returns rev + repaint patch), `presenceInfo` (badge count/label), `isForeign`
  (remote-change gate). +8 tests, 100% cov. Legacy `connectSSE`/`applyPresence` refactored to the
  bridged helpers (thin DOM/EventSource adapter remains). **Plan adjusted:** the SSE orchestrator
  move + `store.notify()` wiring are **deferred to Phase 4** (notify has no subscriber until `render`
  subscribes — E3/E5/E8; see ARCHITECTURE §14 "3.3 SSE"). Gate + smoke green (live `presence` event
  drove the badge through the new adapter; `applyUpdate`/`isForeign` bridged and correct; `rev` 23).
  **Phase 3 complete.** **Next: Phase 4.1.**
- **3.2 (net/api) DONE 2026-08-28** — `web/js/net/api.ts`: `API`, `apiGet`/`apiPost` (fetch
  injected, E4), `validateData` + `normalizeState` (faithful ports of legacy `validateData`/
  `readFile` normalization). +14 tests, 100% cov; new `net/` gate layer wired (eslint boundary
  `net/ ↛ ui/`; coverage floor 90/85). legacy `API`/`apiGet`/`apiPost`/`validateData` removed,
  `readFile` thinned to `normalizeState(await apiGet('/api/state'))`. Gate + smoke green
  (boot + a live `/api/state` round-trip both 200; `rev` unchanged). **Next: 3.3 `net/sse.ts`.**
- **3.1 (state store) DONE 2026-08-28** — see Done log.
  - `web/js/state.ts`: `createStore(initial): Store` — pure, mutates its state object in place so
    the bridged `window.S` reference stays valid; `get`/`set`(shallow-merge+notify)/`subscribe`
    (returns unsubscribe)/`notify`. +6 tests, 100% cov; gate floor extended to `state.ts` (D6).
  - `shared/types.ts`: added `LogEntry`, `ServerData` (= `BookingData` + `groups`/`rev?`/`revision`/
    `log`), `AppState` (the 16-field legacy `S`, byte-identical incl. dead `lastRaw`, D4).
  - `app.ts`: `hydrateState()` (localStorage + `mondayOf(new Date())`, the impurity `createStore`
    avoids — D3/E4) → `createStore` → `window.S = store.state`; `Window.S` augmented.
  - `legacy.js`: `const S = {…}` removed (its 158 `S.x` sites now resolve to the bridge; zero
    call-site changes). Manual `render()` kept — `subscribe`/`notify` built+tested but NOT wired
    (D2/Q2b; first consumer is SSE in 3.3).
  - Gate green (85 tests, 100% cov). Browser smoke: `window.S` = 16 fields in order, Sets intact,
    data loaded (245 machines, rev 23), 265 rows rendered, stored filters (`machSel`/`person`/
    `personOnly`) hydrate faithfully across reload, console clean, server `rev` unchanged (23).

## Next step
> **Phase 6's operational items are done** (2026-09-01/02): `docker compose up -d --build` deployed
> the reworked stack (user-authorized), and the one-time weekend backfill (`node server/backfill.js`)
> inserted 1,484 rows, re-run confirmed idempotent (0 the second time). The weekend maintain hook is
> live in production. Both steps below are kept here only as a historical record of what they were.
>   1. ~~Deploy the reworked stack~~ — done.
>   2. ~~Run the one-time weekend backfill~~ — done.
>
> **Carry forward, updated 2026-09-02 post-architecture-audit:** the modal-markup fold and the
> `AS_TREE`-adapter are both moot now (`ui/modal.tsx` and the Assistant's `useAssistantTree` hook
> superseded them in Phase 7 B7/B10d); the action-layer question resolved itself the same way —
> `ui/mutate.ts` ported legacy's own `mutate` as the orchestrator, faithfully, no new `actions.ts`
> layer. The **wknd-on-patch** known bug is fixed (see Known Bugs). The full architecture audit
> (`docs/ARCHITECTURE_AUDIT.md`) is now resolved except F7's full-merge option (deliberately open)
> and F10 (checked, not worth doing) — see that file's §10/§11 for the final status of every item,
> including F8/F9, both done as of this update (see the "Last updated" note above).
>
> **What's actually still open:** F7's full `shared/types.ts`⟷`server/types.ts` merge (the
> minimal compile-time contract test shipped instead; a full merge remains a real, larger
> decision, not scheduled). Nothing else from the audit is outstanding.
>
> **View-layer decision (resolved, §15):** no framework — keep the custom string render + a tiny
> store subscription (zero-dep). Revisit only if the UI grows materially.
>
> **Canonical-naming rule (superseded by F9, done):** `store` was the canonical abstraction for
> all new TS while `window.S` was migrating; that migration is now complete for every module this
> app owns (F9). `window.S` still exists as the read bridge a handful of deliberately-still-window
> -bridged utilities rely on (`mutate`/`askConfirm`, kept for their wide fan-out — see F8's
> write-up) — no new code should reach for it directly.

## Backlog (task queue — the single canonical copy)
Checked off as each item lands (one commit per item unless noted).

**Phase 1 — Skeleton (app runs identically, structure ready for extraction)**
- [x] 1.1 Vite `web/` root serving the current `index.html` unchanged; app loads identically
- [x] 1.2 Monolith inline `<script>` → `web/public/legacy.js` (classic, global-scope,
  gate-excluded); app boots byte-for-byte
- [x] 1.3 Lift the `<style>` block into `web/css/app.css`; app looks identical
- [x] 1.4a Multi-stage Dockerfile builds the frontend; production container serves the built
  output from `/app/public` (verified end-to-end at :3000)
- [x] 1.4b Retire the old top-level `public/`; confirm production still serves the app

**Phase 2 — Core logic (TDD; coverage 90/85 arms here)**
- [x] 2.0 clean ESM entry `web/js/app.ts` (module, runs before `defer` legacy.js); bridges
  extracted modules onto `window` so legacy's inline handlers keep resolving. Coverage armed
  into `verify` (`test:cov`, 90/85 on `core/**`).
- [x] 2.1 `core/dates.ts` (+ 22 tests, 100% cov); 12 helpers deleted from `legacy.js`
- [x] 2.2 `core/machines.ts` (+ 18 tests, 100% cov) + `shared/types.ts` seeded; 8 predicates
  deleted from `legacy.js`
- [x] 2.3 `core/weekend.ts` (`sweepWeekends`, + 6 tests, 100% cov); `migrating` bug fixed by
  removing the two obsolete migrations (see Done log + Known bugs → Fixed)
- [x] 2.4a `core/assistant.ts` — pure tree ops (7 fns, + 16 tests, 100% cov); legacy keeps thin
  `AS_TREE`-binding adapters (retire in Phase 4)
- [x] 2.4b `core/assistant.ts` — the N-of-M solver (11 fns, predicate-injected; +15 tests, 100% cov);
  `runAssistant` refactored to call it. **Phase 2 complete.**

**Phase 3 — State + net**
- [x] 3.1 `state.ts` (store + subscribe/notify) — pure `createStore`, +6 tests 100% cov; `AppState`/
  `ServerData`/`LogEntry` typed; `app.ts` hydrates + bridges `window.S`; `const S` removed from
  `legacy.js`. Gate + smoke green; `render()` still manual (D2). **DONE 2026-08-28.**
- [x] 3.2 `net/api.ts` — `apiGet`/`apiPost` (fetch injected) + `validateData`/`normalizeState`
  faithful ports; +14 tests 100% cov; `net/` gate layer wired (eslint `net/↛ui/`, coverage 90/85).
  legacy HTTP client removed/bridged. Gate + smoke green. **DONE 2026-08-28.**
- [x] 3.3 `net/sse.ts` — pure `applyUpdate`/`presenceInfo`/`isForeign` (+8 tests 100% cov); legacy
  `connectSSE`/`applyPresence` refactored to the bridged helpers (adapter stays). SSE orchestrator
  move + `store.notify` wiring **deferred to Phase 4** (see §14). Gate + smoke green. **DONE 2026-08-28.**

**Phase 4 — UI**  _(design: ARCHITECTURE §15)_
- [x] 4.1a `ui/grid.ts` — pure per-cell model (`classifyCell`, `isMine`, `cellClass`); +9 tests
  100% cov; `render()` + `refreshCell()` refactored to share it (removes the duplicated cell
  decision). New `ui/` gate layer (coverage 90/85). Gate + smoke green. **DONE 2026-08-28.**
- [x] 4.1b `ui/grid.ts` — `weekHeaderCells` (KW + weekday/date header columns, core/dates-only) and
  `classifyDot` (today-dot state, dedups render() vs refreshDot()). +5 tests 100% cov; `render()`
  header loop + dot and `refreshDot()` refactored to them. **Remaining row-header markup (cat/group
  header rows, star/status-tag/next-free buttons) left in the legacy adapter** — trivial interpolation
  over still-legacy presentation helpers (`esc`/`ic`/`catLabel`/`statusRangeText`/`daysMaskText`);
  extract once those helpers move (low logic value now, P3/E8). Gate + smoke green. **DONE 2026-08-28.**
- [x] 4.1c-1 reactive wiring (core) — `render` subscribed to the store in `app.ts` (guarded: no
  render before first data); `notify()` bridged; the data-change paths (`refreshNow`, SSE
  `structural`) route through the store instead of calling `render()` directly. Delivers the
  deferred 3.3 goal (SSE/refresh → store → notify → render). Gate + smoke green. **DONE 2026-08-28.**
- [x] 4.1c-2 reactive wiring (rest) — migrated all remaining direct `render()` calls to `notify()`
  (27 sites). `render()` now appears only as its definition + the two internal overflow/grow loops
  (`ensureOverflow`, keyboard grow-right, kept direct by design) + the store subscription. Every
  user-facing repaint flows through the store. Gate + smoke green. **DONE 2026-08-29.**
- [x] 4.2a `ui/selection.ts` — pure rectangle geometry (`computeSelCells` injected with `visM`/`visD`)
  + `clampIndex` (the arrow-key move/extend clamp, used for row and column). 8 tests, 100% cov;
  bridged; browser smoke drove a real drag (`.sel`=4, `.kfocus`=1 via `paintSel`), ArrowRight moved one
  column, ArrowUp clamped at the top row; console clean; `rev` unchanged (23). **DONE 2026-08-29.**
- [x] 4.2b `ui/navigation.ts` — pure next-free scan geometry (`nextFreeDay`/`prevFreeDay`, machine
  bookability injected as a predicate — E4). 11 tests, 100% cov; legacy `nextFreeAfter`/`prevFreeBefore`
  now thin wrappers over the bridged fns; browser smoke drove real ⏭/⏮ jumps (08-31→09-01→08-31, prev
  never before today), wrapper≡pure cross-checked live, `rev` unchanged (23). Week-nav/growth DOM
  (`prependWeek`/`ensureOverflow`/scroll) stays in the legacy adapter (E8). **DONE 2026-08-29.**
- [x] 4.3 `ui/views/*` — view-model kernels extracted (one per commit): my-bookings (`computeMyRuns`),
  stats (`computeStats`), all-bookings (`computeAllRuns`+`filterAllRuns`), admin (`filterAdminMachines`),
  machine-text (`maintText`/`statusRangeText`/`daysMaskText`). All 100% cov + smoked, `rev` never moved.
  Trivial modal markup (Log/Help/Settings/booking-detail) + the write-path reducers (`submitBooking`,
  machine-form save, reorder) intentionally deferred to Phase 5 (§15 scope; write-paths → `core/booking`).
  **DONE 2026-08-29.**

**Phase 5 — Polish + write-path reducers**
- [x] 5.1 `core/booking.ts` — extracted **all eight** write-path reducers (not just the three planned):
  `bookCells` (submitBooking conflict/apply, ts+gid injected), the four distinct delete reducers
  (`deleteCells` exact / `deleteOwnCells` ci / `deleteSelectedCells` cell-list / `deleteGroup` by-gid — so
  **every** `sweepWeekends` caller now lives in core), and machine CRUD (`saveMachine`/`deleteMachine`/
  `moveMachine`). 43 tests, 100% cov. Gate-only + clone-smoke (no production write); `rev` 23. **DONE 2026-08-29.**
- [x] 5.2 deleted dead FS-era code (`writeFile`/`S.handle`/`lastRaw`/`lastMtime` + empty stubs
  `setupFileObserver`/`startRefreshTimer` and the stub call in `startUI`); `lastRaw` dropped from
  `AppState`/`hydrateState`/tests. legacy.js 2712→2362. knip clean on gated layers; boot identical, `rev` 23.
  Modal-markup folding + `AS_TREE` retirement **deferred with rationale** (§16: low-value / real migration).
  **DONE 2026-08-29.**
- [x] 5.3 `knip` promoted into `verify` (`… && lint && deadcode && test:cov`); knip.json tidied to zero
  findings (dropped stale `legacy.ts` ignore + Phase-6 `server/*.ts` entries, `ignoreExportsUsedInFile`,
  auto-entry via Vite plugin). Repo-wide coverage floor (90/85) added under the layer globs. CSS/HTML tidy
  deferred (E8 — no dead-CSS need, restyle risks visual drift). **DONE 2026-08-29.** **Phase 5 COMPLETE.**

**Phase 6 — Backend → TypeScript**
- [x] 6.1 `server/` conversion — `db.ts`/`model.ts`/`mutate.ts` (pure, unit-tested against in-memory
  SQLite; 31 tests incl. concurrency/compare-and-set/validation/rollback) + the impure entry shells
  `server.ts`/`import.ts`. `node:sqlite` loaded via `createRequire`. **DONE 2026-08-29.**
- [x] 6.2 `src/` deleted; gate exclusions removed (eslint/knip/tsconfig); `tsconfig.server.json` + Dockerfile
  compile `server/*.ts` → `dist/server`; runtime runs `node server/server.js`. Full gate covers the backend
  (99.4% lines / 90.9% branch). Validated on a throwaway image (isolated port+volume); prod untouched. **DONE 2026-08-29.**
- [x] 6.3 **Server-authoritative weekend auto-bridging** (feature; scope = *maintain + backfill*).
  `server/bridge.ts`: pure `missingBridges` (recovered baseline logic) + `maintainBridges` (in-transaction,
  ON CONFLICT DO NOTHING) + `backfillBridges`. Maintain wired into `applyCells` (bridges the affected
  machines after a write, appended to the broadcast `changes`; `applied` stays the client count), behind
  `WEEKEND_BRIDGE` env (on unless `off`). Backfill = `server/backfill.ts` CLI (`npm run backfill`).
  10 tests. Validated on the compiled image: a Fri+Mon booking auto-bridged Sat/Sun with the Friday's name;
  backfill inserted 1782 legacy bridges — all on a **temp** DB. **Live backfill NOT run — awaits authorization.**
  **DONE 2026-08-29.**

## Deferred features (decided, scheduled — not yet built)

### Server-authoritative weekend auto-bridging  → Phase 6.3 — **BUILT 2026-08-29** (`server/bridge.ts`)
**Decision (2026-08-28):** scope = **maintain + backfill** (full). **Status:** implemented, gated, and
validated on a throwaway image (§17). The maintain hook goes live on the next deploy (toggle `WEEKEND_BRIDGE`);
the one-time backfill (`npm run backfill`, ~1.8k bridges) is a production write and **awaits authorization**.
The facts below are kept for reference.

**What it is.** A weekend day (Sat/Sun) should be booked as part of any continuous Fri→Mon
series (see `core/weekend.ts` `sweepWeekends`, which already REMOVES orphaned weekend days on
every client write). "Auto-bridging" is the ADD direction: when a Fri→Mon span exists, the Sat/Sun
between them should be filled (carrying the Friday booking's name). Today the ADD direction does
not happen at all.

**Design (server owns the invariant):**
1. **Maintain (going forward):** in the `/api/mutate` cell path, within the same transaction,
   when a write completes a Fri→Mon span, insert the two weekend days (same name). Symmetric
   triggers: booking a Friday whose Monday is already booked, or a Monday whose Friday is already
   booked, fills that weekend. (Optionally also move the orphan-sweep server-side for full
   authority; the client sweep can then be retired.)
2. **Backfill (one-time):** a server-side pass computing all missing bridges and inserting them in
   a single DB transaction — internal SQL, so NOT subject to the API's 1000-cell/batch cap.

**Grounded facts (from live data @ rev 23):**
- **1,794** missing bridges across **245** machines; **0** have empty names.
- The old client migration (`migrateWeekends`, removed in 2.3) tried to POST all 1,794 in one
  `/api/mutate` call and got **HTTP 400** — cause: the server caps a batch at **1,000 cells**
  (`src/server.mjs` ~line 133, `Zu viele Zellen (max. 1000)`). 1794 > 1000. (NOT a name/availability
  problem — the server only turns blocked days into *conflicts*, never 400s.)

**Principled build:** put the pure bridge computation (the old `missingWeekendBridges` logic,
removed in 2.3 — recover from git if useful) in a **tested** module the TS backend uses; keep the
removed client-side migrations gone. Safety: daily VACUUM backup exists; backfill is reversible via
restore, and the sweep removes bridges automatically if a series later breaks.

**Phase 8 — Naming & structure clarity (`PRINCIPLES.md` E9/E10)**
User-driven code-review pass (2026-09-02): the codebase has real anti-patterns — machine CRUD
reducers hiding inside `booking.ts` with no `machines.ts` mutation-side counterpart (breaking the
`booking.ts`/`booking-queries.ts` pairing E10 now names), and `mid`/`gid`/`n`/`dir`-style
unexplained abbreviations spread across ~46 files. Two principles now govern the fix (E9, E10);
this is their systematic application, file by file, one commit per safe-to-isolate module.

**Scope boundary — decided once, applied everywhere (do not re-litigate per file):**
Renaming is a plain identifier change UNLESS it touches something already fixed elsewhere,
which turns it into a data-shape change:
- **Stays exactly as-is:** SQL DDL/DML text (`server/db.ts`'s `CREATE TABLE`/column names,
  every `db.prepare(...)` string) — a real column rename needs a migration, out of scope here.
- **Stays exactly as-is:** `server/types.ts`'s `MachineRow`/`BookingRow` (typed 1:1 against a raw
  `SELECT *`) — same precedent the file already sets itself (`grp` stays raw there; `group` is
  the cleaned-up name one layer out, in `MachineOut`).
- **Stays exactly as-is:** `shared/types.ts`'s `Machine`/`Booking`/`MaintSlot` fields (`gid`,
  `gtitle`, `redu`, `cat`, `maint`, `days`) — these are the literal at-rest shape of the bundled
  seed `buchungen.json` and round-trip through `/api/state` unchanged; renaming needs an
  import/export transform, not a naming pass. Each gets/keeps a doc-comment carrying the clarity
  its name can't (most already do).
- **Renamed, in lockstep client+server, same commit:** every *live, non-persisted* wire shape —
  `/api/mutate` request cells (`CellDelta.mid`), its conflict/change response arrays
  (`MutateConflict`/`MutateChange`), the SSE change/presence payloads, and the `data-mid` DOM
  attribute the grid renders and every interaction/patch module queries by. None of these are
  ever written to disk verbatim; both ends of each always deploy together, so there's no
  compatibility window to break.
- **Renamed freely, no coordination needed:** every local variable, function parameter, and
  purely in-memory/computed type (`CellUndo`, `CellRef`, `BookingGroup`, `Bridge` — the last
  feeds `db.prepare(...).run(...)` **positionally**, so its field names carry no SQL meaning) —
  the vast majority of the ~46 files.

**Backlog:**
- [x] 8.1 Split `core/machines.ts`: the pure predicates it already holds move to
  `core/machines-queries.ts` (naming mirrors `booking-queries.ts` exactly); the machine-CRUD
  reducers currently mislabeled inside `booking.ts` (`saveMachine`, `deleteMachine`,
  `moveMachine`, `MachineForm`, and their private helpers) move into a new `core/machines.ts`.
  `booking.ts`'s header comment is trimmed to what it actually still owns. `moveMachine` also
  gets a doc-comment/readability pass in the move (the concrete example that started this phase).
  **Superseded by 8.1r below — see that entry.**
- [x] 8.1r **Revision**: merged the query/mutation split back into one file per domain
  (`PRINCIPLES.md` E10 rewritten). `core/machines.ts` + `core/machines-queries.ts` →
  `core/machines.ts`; `core/booking.ts` + `core/booking-queries.ts` → `core/bookings.ts` (new
  plural name, matching `shared/types.ts`/`shared/dates.ts`/`web/js/state.ts`'s convention),
  each sectioned internally (types / queries / mutations). Reason for reverting 8.1's own split:
  its stated justification — staying under the `max-lines` ESLint budget (400) — doesn't hold in
  practice (both merge back to well under 300 effective lines); what the split cost was the "one
  place to look for this domain" property. Every real importer (39 import sites across
  `web/js/ui/`, `web/js/ui/components/`, `server/model.ts`) repointed; all four old files and
  their tests deleted, contents merged into `machines.test.ts`/new `bookings.test.ts`.
- [x] 8.2 Rename `mid`→`machineId`, `gid`→`groupId` across every file the scope boundary above
  clears — one large mechanical commit (a partial rename doesn't type-check, so it can't be
  split further without breaking `HEAD` green). Includes the `data-mid` DOM attribute and the
  wire-shape structs named above, updated in lockstep. Excludes everything the boundary keeps.
- [x] 8.3 Rename `findConflicts` → `findBookingConflicts` (core/booking.ts) — states *what* it
  finds conflicts in, not just that it finds them.
- [x] 8.4a Bare `n`/`dir`/`id` — the two-domain sweep, done: `bookings.ts`'s four delete
  reducers' `{ n, undo }` result → `{ deletedCount, undo }` (also fixed in `ui/mutate.ts`'s
  `MutateResult` mirror type, and every consumer: `BookingDetailModal.tsx`, `ContextMenu.tsx`,
  `MyBookingsModal.tsx` + their tests). `AdminModal.tsx`'s `onMove: (id, dir)` →
  `(machineId, direction)`, matching `core/machines.ts`'s `moveMachine` signature it calls.
  `server/server.ts`'s presence broadcast `{ n: clients.size }` → `{ clientCount }` (confirmed
  dead-on-the-wire first — `live-connection.ts`'s presence handler only ever reads `.users`, so
  this was a safe rename, not a coordinated client+server one).
- [x] 8.4b `web/js/ui/views/stats.ts`'s `StatsMachineRow`/`StatsMaintRow`: `m`→`machine`,
  `n`→`bookedWorkdayCount` (already the local var name), `inst`→`slotCount`, `pct`→`percent`.
  Updated every consumer: `StatsDrilldown.tsx`, `StatsModal.tsx`, `StatsOverviews.tsx`,
  `stats.test.ts`. Separately, `web/js/ui/views/all-bookings.ts`'s `AllRun` and
  `my-bookings.ts`'s `BookingRun` (two distinct types, same bare `.m` field) both →
  `machine`, across `AllBookingsModal.tsx`, `MyBookingsModal.tsx`,
  `all-bookings.test.ts`/`my-bookings.test.ts`. `npm run verify` green, 797/797 tests.
- [x] 8.4c Rescanned for anything else in the same vein; found little — `el` (DOM element) and
  `req`/`res` (Node's request/response) are the standard idiom for this domain and were
  deliberately left alone, not renamed. Fixed the two real small findings: `selection.ts`'s
  `clampIndex(idx, len)` → `(index, length)`; `debug-panel.ts`'s `handleError(ctx, err)` → `(source,
  err)` (`ctx` wasn't a React/JS context object, just a short origin tag like `'sse/presence'`).
  Noted but deliberately NOT done here — a separate, bigger candidate: the `/api/mutate` wire
  types (`CellDelta.val`, `MutateChange.val`, `CellUndo.prev`) still use bare `val`/`prev`, same
  category as the Phase 8.2 `mid`/`gid` rename (a live, non-persisted wire shape, renamable in
  lockstep client+server) — scope it properly if it's ever picked up. **Phase 8 (naming &
  structure clarity) is now complete.**

**Phase 9 — REST API (user-requested design, full plan discussed 2026-09-02/03) — COMPLETE**
A genuine `/api/v1/*` REST surface alongside the existing `/api/state`/`/api/mutate`/`/api/stream`
trio, NOT replacing it — that trio is the live grid's own sync protocol (batch CAS writes, full-
state reads, SSE push) and stays exactly as-is; REST is for external tooling/scripts/admin use
that wants single-resource semantics instead. Full reasoning (resource list, endpoint map, status
codes, auth stance, versioning, testing strategy) was worked out in conversation and isn't
re-derived here — this backlog is the executable summary.

- [x] 9a Routing plumbing, zero endpoints yet — `server/api-router.ts` (`matchRoute`/`findRoute`,
  a `:param`-segment matcher over a plain route-array, no router dependency) and
  `server/api-response.ts` (`apiSuccess`/`apiError`, the `{data}` / `{error,code,details?}`
  envelope, `ApiErrorCode` = VALIDATION/NOT_FOUND/CONFLICT/PRECONDITION_FAILED/INTERNAL). Not
  wired into `server.ts` at all yet — that starts in 9b. `npm run verify` green, 818/818 tests,
  100% coverage on both new modules (21 new tests).
- [x] 9b `GET /api/v1/machines` (filters: `?category=`, `?group=`, `?status=`, combinable;
  `?sort=name`, German collation; otherwise DB order) and `GET /api/v1/machines/:id` (404
  `NOT_FOUND` naming the id) — `server/api-machines.ts`, reusing `model.ts`'s existing
  `machineOut` wire mapper (a REST machine is the exact `/api/state` shape, not a parallel
  contract). Wired into `server.ts`'s dispatch via `findRoute`/`apiV1Routes`, extracted into a
  `tryApiV1` helper to stay under the complexity budget once the branch count grew.
  **Real gap found and fixed**: the new files used `.ts` import extensions (correct for
  vitest, which `npm run check`'s tsconfig also tolerates) instead of the `.js` extensions
  `tsconfig.server.json`'s stricter Node-ESM resolution requires (matching every existing
  `server/*.ts` file's own imports) — `npm run verify` doesn't run `build:server`, so this
  passed the gate clean and only surfaced when the production Docker image was actually built
  for the smoke test. Fixed; confirmed live afterward against a throwaway container with real
  seed data: `GET /api/v1/machines` → 245 machines, `GET /api/v1/machines/:id` → 200 for a real
  id / 404 `{code: "NOT_FOUND"}` for a bogus one, `?category=messtechnik` → 150, and the legacy
  `/api/state` still 200s unchanged. **Worth remembering**: `npm run verify` alone doesn't prove
  a server change actually builds for production — run `docker compose build` (or the full
  smoke pattern above) before considering a server-side slice done, not just `npm run check`.
  `npm run verify` green: 827/827 tests (9 new), 100% coverage on `api-machines.ts`.
- [x] 9c `server/api-bookings.ts`. `GET /api/v1/machines/:id/bookings` — `?from=&to=` both
  required (400 `VALIDATION` otherwise, or if `from > to`), 404 if the machine doesn't exist,
  empty array (not an error) for a range with nothing booked. `GET
  /api/v1/machines/:id/bookings/:date` — 404 for an unknown machine, 400 for a malformed date,
  404 for a free cell (no booking resource at that address yet). `GET
  /api/v1/bookings?groupId=` — 400 without `groupId`, direct SQL on the existing `gid` index
  rather than routing through the client's pure `core/bookings.ts` query logic (which expects
  an in-memory `Bookings` map the server never builds). Wired into `server.ts`'s route table;
  `DAY_RE` exported from `mutate.ts` rather than redefined, one source of truth for "valid ISO
  day". `npm run build:server` checked directly before the docker build this time (the 9b
  lesson) — clean on the first try. Verified live against a throwaway container: booked two
  real cells sharing a `gid` via `/api/mutate`, then all three endpoints returned exactly the
  expected data/errors (400s, 404s, the range list, the single cell, the cross-machine group
  list). `npm run verify` green: 839/839 tests (12 new), 100% coverage on `api-bookings.ts`.
- [x] 9d `GET /api/v1/activity` — `server/api-activity.ts`. The `log` table is the one genuinely
  unbounded, append-only collection in the app (unlike `machines`, a few hundred rows, or one
  machine's bookings, naturally bounded by a date range), so cursor pagination on its own
  autoincrement `id` is the fit, not offset/limit: `?cursor=` is the previous page's last-seen
  `id` (strictly older, since ordering is `id DESC`), `?limit=` (default 50, max 200, clamped
  not rejected), `?user=` and `?since=` (ISO-string `ts >=`) filters, combinable. Fetches
  `limit + 1` rows to detect "more pages" without a second COUNT query; `meta.nextCursor` is
  present only when there actually is a next page (omitted entirely otherwise, not `null`) —
  needed extending `apiSuccess(data, status, meta?)` with that third optional parameter in
  `api-response.ts`, same omit-when-absent convention as `apiError`'s `details`. New `LogRow`
  type in `server/types.ts` alongside `MachineRow`/`BookingRow`. `npm run build:server` checked
  directly before the docker build (still following the 9b lesson) — clean on the first try.
  Verified live against a throwaway container: the fresh container's own first-run import log
  entry, then 5 more generated via real `/api/mutate` bookings — default listing came back
  newest-first (6 entries, import last); `?user=smoketester` filtered to the 5; `?limit=2` paged
  correctly across two calls following `nextCursor` (entries 6,5 then 4,3, no overlap); `?since=`
  returned exactly the entries at/after the given timestamp; non-numeric `?limit=`/`?cursor=`
  both 400 `VALIDATION`; the 9b/9c endpoints re-checked unaffected. `npm run verify` green:
  850/850 tests (11 new — 9 for `listActivity`, 2 for `apiSuccess`'s `meta`), 100%
  statement/function/line coverage on `api-activity.ts` (branch coverage 88.88%: the
  `activityOut` mapper's `row.ts/user/action || ''` null-fallbacks are unreachable in practice —
  every writer already supplies real values — left as defensive rather than chased for 100%,
  since the schema technically allows null and `verify`'s aggregate 90/85 floor was already met).
- [x] 9e+9f Write endpoints — `server/api-machines-write.ts`, `server/api-bookings-write.ts`,
  `server/api-write-helpers.ts` (landed together: both re-derived the exact same "read current
  state, apply one in-memory change, hand it to `applyMutate`" shape, so building them side by
  side kept that shape honest instead of guessing at it twice).
  - **9e** `POST/PUT/DELETE /api/v1/machines`, `POST /api/v1/machines/:id/move`. Not a second
    write engine: each handler reads the full current machine list (`machineOut`-mapped, same
    wire shape `/api/v1/machines` already returns), applies one change to it in memory — reducers
    ported field-for-field from `core/machines.ts`'s `saveMachine`/`deleteMachine`/`moveMachine`
    (slugify, group-insertion index, the legacy-status-clearing `applyFormFieldsToMachine`) the
    same way `model.ts`'s `blockReason` ports rather than imports client logic (server code never
    imports `web/js/*`) — then hands the whole list to `applyMutate`'s existing structural path.
    That one call is doing all the real work: validation/clamping (`insertMachine`/`cleanMaint`),
    the transaction, the revision bump, the SSE broadcast, and the activity log, so these REST
    handlers add only the REST-specific shell (id-lookup 404s, a 409 `CONFLICT` for a move that
    would run off the list or cross a group boundary, mapping `applyMutate`'s error string to 400
    `VALIDATION`). A REST write without an explicit `log` auto-generates one tagged `(REST)` (e.g.
    `Maschine angelegt: X (REST)`) in the same German phrasing the UI's own save/delete/move
    already log, so `GET /api/v1/activity` reads the same regardless of origin.
  - **9f** `PUT`/`DELETE /api/v1/machines/:id/bookings/:date`, `POST /api/v1/bookings/batch`,
    `POST /api/v1/bookings/batch-delete`. Every write is one `applyMutate` cell-delta call — the
    exact path the grid's own booking clicks use — so blocked-day checks, "never overwrite a
    foreign booking" by name, weekend bridging, the broadcast, and the log all come for free.
    Added an `ETag`/`If-Match` CAS layer on top (new: `bookingEtag(row)` in `api-bookings.ts`,
    `"empty"` for a free cell else derived from the booking's own name+ts; `GET
    .../bookings/:date` now returns it as a response header) — given, a stale `If-Match` is
    refused with 412 before the write is even attempted; omitted, the write is unconditional
    (falling back to `applyMutate`'s own same-name-only-overwrite rule, which still applies
    either way). Batch book reports `{applied, conflicts}` and is 207 Multi-Status when some
    cells conflicted, 200 when all applied cleanly; batch-delete is unconditional (no per-cell
    `If-Match`; the single-cell DELETE is for that) and reports only `applied`.
  - Extended `ApiRoute`/`ApiResponse` (`api-router.ts`) with `body`/`headers` on the request side
    and an optional `headers` on the response side — additive, so every existing GET-only route
    handler (fewer params than the type) kept compiling unchanged. Generalized `server.ts`'s
    `readBody` to `Promise<unknown | null>` (was hard-typed to `MutateBody`) so `/api/v1/*` writes
    reuse the same body-reading/overflow/malformed-JSON handling `/api/mutate` already had,
    without a second copy of it.
  - `npm run build:server` checked directly before the docker build (still the 9b lesson) — clean
    on the first try. Verified live against a throwaway container with real seed data: created,
    updated, moved (409 on an invalid direction), and deleted a machine via REST, confirming each
    step in `GET /api/v1/activity`; booked a cell unconditionally, round-tripped its `ETag` via
    GET, confirmed a stale `If-Match` 412s and the correct one 200s, confirmed the existing
    same-name-conflict rule still 409s a REST write; batch-booked 2 cells clean (200), batch-
    booked 2 more with one conflicting (207, `applied:1`), batch-deleted 3 cells (`applied:3`).
    `npm run verify` green: 893/893 tests (57 new across the two write modules + the shared
    helpers), 100% statement/function/line coverage on every new file (`api-machines-write.ts`
    100/100/100/100; `api-bookings-write.ts` 100/89.55/100/100 branch — the handful of remaining
    branches are header-array edge cases and defensive fallbacks, not untested request paths;
    aggregate floor comfortably met either way).
- [x] 9g Auth decision: **not implementing it now** — a deliberate decision, not a skipped step.
  `/api/v1/*` runs on the same trusted network as the existing `/api/state`/`/api/mutate`/
  `/api/stream` trio, which has had zero auth since before this REST work started; nothing
  outside that network calls any of it today, so a bearer-token check right now would be
  speculative infrastructure with no concrete caller to protect against — exactly the kind of
  guardrail PRINCIPLES.md's simplicity ordering (Correctness/Security → Maintainability →
  **Simplicity** → …) argues against adding ahead of an actual need. It's also worth being
  precise about what it could even be: this app has no user table or login, so "auth" here can
  only ever be one shared secret gating all-or-nothing access to `/api/v1/*` — authentication,
  never per-user authorization (the `user`/`log` fields REST writes accept are, like `/api/mutate`
  today, an unauthenticated free-form display name, not an identity).
  **If a real external caller shows up later**, the concrete shape to add (sketched now so it
  isn't re-derived from scratch): an `API_BEARER_TOKEN` env var; `tryApiV1` in `server.ts` checks
  the request's `Authorization: Bearer <token>` header against it *before* calling `findRoute` —
  applied only to `/api/v1/*`, never to `/api/state`/`/api/mutate`/`/api/stream`, which keep
  serving the live grid unauthenticated exactly as now; a missing/wrong token is a new
  `ApiErrorCode` (`UNAUTHORIZED`) → 401, added to `api-response.ts`'s closed set at that time, not
  preemptively. When `API_BEARER_TOKEN` is unset (every deployment today), the check is skipped
  entirely — so adding it later is opt-in infrastructure, not a breaking change forced onto the
  current deployment.
- [x] 9h Hand-written `openapi.yaml` (repo root, alongside `ARCHITECTURE.md`/`PROGRESS.md`) —
  documentation only, no new runtime or dev dependency (`js-yaml`/`@apidevtools/swagger-cli` were
  used ad hoc via `npx` just to validate the file while writing it, never added to `package.json`).
  Covers all 9 `/api/v1/*` paths (14 operations: the 6 reads from 9a–9d plus the 8 writes from
  9e/9f) with request/response schemas, the shared `{data}`/`{error,code,details?}` envelope, the
  `If-Match`/`ETag` CAS headers, and the 9g auth decision noted in the doc's own description.
  Validated two ways: `js-yaml` parses it (catches YAML syntax mistakes — an unquoted flow-style
  description containing a comma broke the parse and was fixed), and `@apidevtools/swagger-cli
  validate` confirms it's schema-valid OpenAPI 3.0, not just parseable YAML.

**Phase 10 — Repo-wide comment/readability sweep (user-requested 2026-09-03)**
Rewrite every source file's comments (file header + per-function docs) to match the style
established when `web/js/core/machines.ts` was hand-rewritten: a banner file header, a "Key
Principles" summary, and per-function JSDoc with a one-line summary plus a numbered "How it
works"/"Logic:" walkthrough of the behavior and edge cases — a deliberate, user-directed
departure from this project's previous terser comment convention. No behavior changes; each
item is comments-only, verified green and committed before moving to the next. Grouped by
directory into one commit per group (not literally one commit per file — matches how this
project's own "one module, one commit" convention has always been applied to a batch of related
files, e.g. Phase 9's slices).
- [x] 10a `shared/` — `dates.ts`, `types.ts` rewritten to the verbose style; also fixed a
  stale `catOf` reference in `MachineCategory`'s doc comment (renamed twice since: to
  `categoryOf` in Phase 7, then `getMachineCategory`). `dates.test.ts` left as-is — already
  description-driven, no function-level prose to expand; `types.ts` has no test file.
- [x] 10b `web/js/core/` — `assistant.ts`, `bookings.ts`, `weekend.ts` rewritten to the verbose
  style. Also fixed stale legacy.js attributions (deleted whole in Phase 7) in `bookings.ts`'s
  header and several docstrings, and in `assistant.ts`'s header/per-function comments — same
  category of fix as `machines.ts`'s. Test files (`*.test.ts`) left as-is: already
  description-driven, no stale references found.
- [x] 10c `web/js/` root + `web/js/net/` — `app.ts`, `state.ts`, `store-instance.ts`, `api.ts`,
  `sse.ts` rewritten to the verbose style; also dropped `app.ts`'s stale "Faithful port of
  legacy `X`" tails (4 functions) and `state.ts`'s outdated "not yet wired to render()" note
  (subscribe/notify has been wired since Phase 7). Tests left as-is; `app.ts` has no test
  file (boot orchestration, covered by the smoke test).
- [x] 10d `web/js/ui/` top-level, part 1 (18 files: `assistant-checklist.ts` through
  `machine-lookup.ts`) — landed as 3 commits (10 smaller files, then grid/lookup/filter/form,
  then grid-scroll.ts + grid-interaction.ts). Removed one genuinely stale block comment in
  grid-interaction.ts claiming `refreshCell`/`refreshDot`/`patchCells` weren't ported yet and
  `mutate()` was "still entirely legacy" — both had been true for a while by the time this
  sweep reached it. `live-connection.test.ts` got the first "What/How" test-comment pass
  (see 10e's note).
- [x] 10e `web/js/ui/` top-level, part 2 (8 files: `machine-text.ts` through `mutate.ts`) —
  also fixed stale claims in `user-chip.ts` ("click/dblclick wiring stays in legacy.js" —
  it's `app.ts`'s `wireUserChip` now) and `theme.ts` ("boot init stays in legacy.js for
  now" — absorbed into `app.ts` since Phase 7). Test files for 10a–10e still need the
  "What/How" retrofit `live-connection.test.ts` established — tracked as a follow-up, not
  blocking the source-file sweep's progress.
- [ ] 10f `web/js/ui/components/` part 1 — `ActiveUsersModal.tsx` through `GroupOptions.tsx`
  (+ tests)
- [ ] 10g `web/js/ui/components/` part 2 — `HelpModal.tsx` through `StatsOverviews.tsx`
  (+ tests)
- [ ] 10h `web/js/ui/views/` — `admin.ts`, `all-bookings.ts`, `my-bookings.ts`, `stats.ts`
  (+ tests)
- [ ] 10i `server/` part 1 — `api-*.ts` (routing/response/read/write endpoint modules, + tests)
- [ ] 10j `server/` part 2 — `backfill.ts`, `bridge.ts`, `db.ts`, `import.ts`, `model.ts`,
  `mutate.ts`, `server.ts`, `types.ts` (+ tests)

## Done log (newest first)
- **2026-09-02 — Code-review fixes**: undo's CAS-check bug and `machById`'s stale-cache bug
  (both found by an external review, verified with a failing regression test before fixing —
  see Known Bugs → Fixed for the full write-up), plus a defensive consistency fix (Admin/
  AllBookings/Stats now guard against opening before `store.get('data')` has loaded, matching
  `Grid.tsx`'s existing pattern — not a known crash, since the toolbar buttons that open them
  stay hidden until load succeeds, but a real inconsistency worth closing cheaply). Three
  separate commits, each its own regression test, `npm run verify` green throughout
  (789 → 797 tests).
- **2026-09-02 — F8** (`docs/ARCHITECTURE_AUDIT.md`): investigated before implementing —
  grepped every live `window.*` bridge entry's actual call sites rather than trusting the
  audit's original "4 independently-mounted React roots need to talk to each other" framing.
  That framing didn't hold up: the real causes were dead leftovers never pruned, ~20 leaf
  utilities with zero cycle risk, one genuine imperative-code-into-React need unrelated to
  root count, and two real ES-module import cycles — none of it actually caused by having 4
  separate mount points. Shipped direct ES imports for the majority, a new
  `ui/grid-render-bridge.ts` for the render-trigger case, and an injected
  `GridInteractionHandlers` struct for `grid-interaction.ts`'s dependency-hub shape. The
  original "merge the 4 roots into one tree" proposal was rejected outright — nothing on the
  bridge needed actual tree machinery (context, cross-sibling refs). `app.ts`'s `Window`
  interface shrank from ~30 entries to 3.
- **2026-09-02 — F9** (`docs/ARCHITECTURE_AUDIT.md`): the `window.S` → `store` migration,
  completed in three slices — the bounded first slice (11 plain `.ts` orchestration files, 99
  of ~162 sites), then two component batches (the remaining 18 React components, 63 sites).
  Every app-owned module now reads/writes state via `store.get()`/`store.set()`/
  `store.notify()`; `window.S` stays as the intentional, shrinking compat bridge F8's write-up
  describes. Same notify-timing case-by-case analysis throughout (collapse a write+notify into
  one `store.set()`, or keep a silent `store.state.x =` write where more logic runs before a
  single eventual notify) as every other slice in this backlog.
- Phase 6.3 weekend auto-bridging — `server/bridge.ts` (the ADD direction, mirror of core/weekend's sweep):
  pure `missingBridges(bookings)` (faithful recovery of the baseline `missingWeekendBridges` — for each booked
  Friday whose Monday is booked, fill the empty Sat/Sun with the Friday's name), `maintainBridges(db,mids,ts)`
  (in an open transaction, INSERT … ON CONFLICT DO NOTHING) and `backfillBridges(db)` (whole-DB one-time pass,
  internal SQL, not the 1000-cell API cap). Maintain hook wired into `applyCells`: after the client writes, it
  bridges the affected machines and appends the bridges to the broadcast `changes` (so every client patches
  them), while `applied` stays the client-requested count; gated by the `WEEKEND_BRIDGE` env (on unless `off`,
  threaded as `applyMutate(…, bridge)`). Backfill exposed as `server/backfill.ts` (`npm run backfill`,
  coverage-excluded entry). 10 tests (pure computation, in-DB maintain incl. never-overwrite, whole-DB backfill
  incl. idempotence). Validated on the compiled image: booking Fri 2027-01-08 + Mon 2027-01-11 auto-bridged
  09/10 with the Friday's name; the backfill CLI inserted 1782 legacy bridges — all on a throwaway temp DB, prod
  untouched. **The live backfill is a production write and was NOT run — it awaits explicit authorization.**
  ARCHITECTURE §17 updated. **Phase 6 COMPLETE (code).** **DONE 2026-08-29.**
- Phase 6.1/6.2 backend → TypeScript — ported `src/*.mjs` (~350 lines) to gated `server/*.ts`, decomposed so
  domain logic is pure/tested and I/O stays in a thin shell: `db.ts` (schema/meta/import; `node:sqlite` via
  `createRequire` — Vite/bundler can't resolve the new builtin from a static import), `model.ts` (read model),
  `mutate.ts` (single write path, structural+cell reducers, SSE `broadcast` injected — E4). Entry shells
  `server.ts`/`import.ts` coverage-excluded (run-verified, E5). 31 backend tests vs. `:memory:` SQLite (both
  mutate paths, foreign/blocked conflicts, compare-and-set delete, 1000-cell cap, validation, orphan cleanup,
  rollback via a broken DB). Backend cov 99.4%/90.9% (only defensive rollback-inner-catches uncovered).
  `tsconfig.server.json` (NodeNext, `.js` specifiers) compiles → `dist/server`; Dockerfile build stage runs
  `build:server`, runtime ships it at `/app/server` and runs `node server/server.js` (zero runtime deps kept).
  `src/` deleted; eslint/knip/tsconfig un-sealed → backend faces the full gate. Validated end-to-end on a
  throwaway image `maschinenplan:phase6-test` (isolated port 3998 + fresh volume): health, real seeded state,
  static frontend 200, a real booking through POST /api/mutate (rev 0→1, read back), then torn down — the
  production container + `data` volume never touched. ARCHITECTURE §17 added. **DONE 2026-08-29.**
- Phase 5.3 tooling — `knip` promoted into `verify` (now `format:check && check && lint && deadcode &&
  test:cov`; knip after lint = cheap fail-fast). knip.json tidied to **zero findings**: removed the stale
  `web/js/legacy.ts` ignore and the not-yet-existing `server/*.ts` entries (Phase 6 re-adds), scoped project
  to `{web,shared}/**/*.ts`, set `ignoreExportsUsedInFile`; app.ts entry auto-detected via knip's Vite plugin.
  Added a repo-wide coverage floor (top-level `lines:90, branches:85`) beneath the per-layer globs in
  `vitest.config.ts`. CSS/HTML tidy deferred (E8). Gate green (213 tests, 100%). **Phase 5 COMPLETE.** **DONE 2026-08-29.**
- Phase 5.2 FS-era burn-down — removed the file-backed-variant dead code, each confirmed zero-caller first:
  `writeFile()` (+ `S.handle`/`S.lastRaw`/`lastMtime`), the empty stubs `setupFileObserver`/`startRefreshTimer`
  and the `setupFileObserver()` call in `startUI`; the dead `lastRaw` field dropped from `AppState`
  (`shared/types.ts`), `hydrateState` (`app.ts`) and the `state.test.ts` fixture (written, never read).
  legacy.js 2712→**2362**. `knip` shows no dead code in the gated layers (legacy.js isn't analysed by knip →
  manual burn-down). Gate green; browser reload booted identically (245 machines / 266 rows), console clean,
  `rev` 23. Modal-markup folding + `AS_TREE` retirement deferred with rationale (ARCHITECTURE §16). **DONE 2026-08-29.**
- Phase 5.1 write-path reducers — `core/booking.ts`: the eight `mutate(fresh=>…)` callback bodies extracted
  as pure/mutating reducers with the legacy return shapes. `bookCells` (conflict-check + apply, ts + gid
  factory injected — E4; split into findConflicts/applyBooking/writeMachineCells for the complexity cap);
  four delete reducers kept distinct by predicate (E1): `deleteCells` exact-name run, `deleteOwnCells`
  case-insensitive user, `deleteSelectedCells` explicit cell list, `deleteGroup` by-gid across all machines
  — all sweep via core/weekend, so no legacy site calls `sweepWeekends` directly any more; machine CRUD
  `saveMachine` (edit/create + slug/transliteration + same-group insert index), `deleteMachine`,
  `moveMachine`. `shared/types.ts` grew `Booking.note/gid/gtitle` + `Machine.redu`. Legacy call sites are
  now one-liners over the window bridge. 43 tests → **100% cov** (213 total). E5 note: these POST, so they
  are gate-only — verified additionally by running every bridged reducer against a `structuredClone` of the
  **live** S.data in the browser (245 machines): `deleteGroup` hit exactly the 10 cells of a real gid, create
  slugged `ueber-smoke` after its group, `moveMachine` swapped a real pair, cross-group/unknown-id aborted;
  `window.S.data` untouched, app rendered identically (266 rows / 216 booked), server `rev` unmoved (23).
  ARCHITECTURE §16 added. **DONE 2026-08-29.**
- Phase 4.3 machine-text — `ui/machine-text.ts`: pure German status/availability formatters
  `maintText(slot)`, `statusRangeText(m, today=todayStr())` (today injected w/ default), `daysMaskText(m)`.
  Legacy defs deleted; `blockText` now calls the bridged `maintText`; legacy `WD_SHORT` kept only for the
  Verwalten checkboxes. 11 tests, 100% cov. Smoke: bridged formatters produce correct text on synthetic
  slots/masks (live data has no maint/day-restricted machines), default-today path matches, `rev` 23.
  **DONE 2026-08-29.**
- Phase 4.3 admin — `ui/views/admin.ts`: `filterAdminMachines(machines, sort, query)` — order
  (manual/name/group→name, German collation) + case-insensitive "name group" search of the machine
  list for the Verwalten modal. Legacy `renderList` sort/filter block replaced by the bridged call
  (`manual` flag kept for the ↑/↓ markup). 6 tests, 100% cov (empty-group collation + name tiebreak).
  Smoke: 245→7 rows on live search, name-sort ascending, input not mutated, `rev` 23. **DONE 2026-08-29.**
- Phase 4.3 all-bookings — `ui/views/all-bookings.ts`: `computeAllRuns(machines, bookings, today)`
  (per-person consecutive-workday runs w/ earliest ts) + `filterAllRuns(runs, criteria)` (case-insensitive
  person/machine, group, [from,to] overlap window, 5 sort keys w/ termin fallback, cap 300). Legacy
  `computeAllRuns()` deleted + the `sorters` map/filter chain in `renderList` replaced by the bridged calls.
  9 tests, 100% cov (incl. comparator tie-breakers + empty-field fallbacks). Smoke: 66 runs / 564 run-days
  == manual future-weekday count, sort dropdown works, `rev` 23. **DONE 2026-08-29.**
- Phase 4.3 stats — `ui/views/stats.ts`: `computeStats(machines, bookings, from, to)` extracted — the
  full stats aggregation (per-machine counts/percent/person-breakdown, cross-machine person index,
  maintenance+downtime tally), pure over core/dates+core/machines. Legacy `compute()` keeps only the
  range DOM-read + validation. 7 tests, 100% cov; browser smoke cross-checked 9462 booked cells over 245
  machines vs. a manual count (person-day totals reconcile), all 3 modes render, `rev` 23. **DONE 2026-08-29.**
- Phase 4.3 my-bookings — `ui/views/my-bookings.ts`: `computeMyRuns(machines, bookings, user, today)`
  extracted (consecutive-workday run-grouping of the user's future bookings, date-sorted; Fri→Mon = one
  run). Legacy `computeMyRuns()` deleted, call site injects `orderedMachines()/bookings/user/today`. The
  modal shell + expand/goto/delete wiring stay in legacy. 5 tests, 100% cov; browser smoke: bridge live,
  cross-checked run-days vs. a manual reduction, real modal opened for a live booker, `rev` unchanged (23).
  **Scope note (§15): 4.3 extracts pure view *kernels*, not markup shells.** **DONE 2026-08-29.**
- Phase 4.2b — `ui/navigation.ts`: pure next-free scan geometry extracted from the ⏭/⏮ jump code.
  `nextFreeDay(fromIso, today, isFree, horizon=730)` and `prevFreeDay(fromIso, today, isFree)` walk the
  calendar (skipping weekends via `core/dates`) for the first day a machine is bookable; the impurity —
  whether a day is bookable for *that* machine (`!getBooking && !isBlockedM && dayAvailable`) — is
  injected as a predicate (E4). 11 tests, 100% cov; bridged; legacy `nextFreeAfter`/`prevFreeBefore`
  reduced to one-line wrappers so all callers (`gotoNextFree`, `gotoPrevFree`, the `hasBack` flag) are
  unchanged. Everything with a side effect (`jumpToSlot`: scroll/window-rebuild/`paintSel`/`toast`, the
  `nextFreePtr` bookkeeping, `prependWeek`/`ensureOverflow`) stayed in the legacy adapter (E3/E8).
  Browser smoke: bridged fns live and wrapper≡pure cross-checked on a live machine; real ⏭ advanced
  08-31→09-01, ⏮ walked back to 08-31 and never before today; SSE-reconnect console noise only; `rev`
  unchanged (23). **DONE 2026-08-29.**
- Phase 4.2a — `ui/selection.ts`: pure selection geometry extracted from the `Sel`/interaction block.
  `computeSelCells(anchor, focus, visM, visD)` (the anchor↔focus rectangle over the visible grid,
  injected — E4) and `clampIndex(idx, len)` (the arrow-key move/extend clamp, used for both row and
  column). 8 tests, 100% cov; bridged in `app.ts`; legacy's `paintSel` now calls the injected form and
  the keyboard handler uses `clampIndex`. Browser smoke: bridged fns live, a real drag painted 4 `.sel`
  cells + 1 `.kfocus` via `paintSel`, ArrowRight advanced one column, ArrowUp clamped at the top row;
  console clean; `rev` unchanged (23). The DOM side (paint/listeners/autoscroll/week-growth) stays in
  the legacy adapter (E3/E8). **DONE 2026-08-29.**
- Phase 2.4b — Assistant N-of-M solver (11 fns, predicate-injected) extracted to `core/assistant.ts`
  (15 tests, 100% cov); `runAssistant` refactored to call it. Ran the Assistant end-to-end in the
  browser: correct open-run result, core cross-check matches, console clean. **Phase 2 COMPLETE.**
- Phase 2.4a — `core/assistant.ts` pure tree ops (7 fns, 16 tests, 100% cov) extracted + bridged;
  legacy keeps thin `AS_TREE`-binding adapters. Browser-verified incl. real `asAdd`→`asDevs` path.
- Phase 2.3 — `core/weekend.ts` (`sweepWeekends`, 6 tests, 100% cov) extracted + bridged;
  **fixed the `migrating` bug** by deleting the two obsolete file-era migrations and their calls
  (they never ran; server rejects the weekend write with 400). Fresh-tab console now fully clean;
  backend rev unchanged (no write). `missingWeekendBridges` deleted with its only caller.
- Phase 2.2 — `core/machines.ts` + `machines.test.ts` (18 tests, 100% cov) + `shared/types.ts`
  contract seeded; 8 pure predicates removed from `legacy.js`; grid renders from the bridge
  (browser-verified); core coverage still 100%
- Phase 2.1 — `core/dates.ts` + `dates.test.ts` (22 tests, 100% cov); 12 date helpers removed
  from `legacy.js`; coverage 90/85 armed into `verify`; app boots identically (browser-verified)
- Phase 2.0 — `web/js/app.ts` ESM entry + window bridge; `legacy.js` now `defer`, module runs first
- Phase 1.4b — deleted old top-level `public/`; production rebuilt + still serves (Phase 1 done)
- Phase 1.4a — multi-stage Dockerfile; production container serves built frontend (verified :3000)
- Phase 1.3 — `<style>` → `web/css/app.css`; app looks identical (stylesheet loads + applies)
- Phase 1.2 — monolith → classic `web/public/legacy.js`; app byte-identical (all handlers global)
- Phase 1.1 — Vite `web/` root; app loads identically under Vite (`/api` proxied to backend)
- `2582e27` Phase 0.5 — full gate + hard pre-commit enforcement (proven to block red)
- `f99b18e` Phase 0 — locked calibrated bar (90/85), per-phase cadence, legacy quarantine
- `6966723` Phase 0 — quality-gate system, iteration loop, CLAUDE.md
- `ee4c104` Phase 0 — ARCHITECTURE.md + FEATURES.md
- `cc2ab9d` Phase 0 — dockerized TS + Vite + Vitest toolchain
- `789bfec` Baseline — working app as inherited (rollback point)

## Open decisions / notes
- Dev-only npm-audit vulnerabilities (transitive via Vite/Vitest) — no runtime impact;
  revisit at Phase 5 polish.
- `node:sqlite` experimental in Node 22 — confirm the flag/loader story at Phase 6.

## Known bugs

### Open (deferred — preserve for now, fix in a flagged step)
(none currently)

### Fixed
- **Undo's CAS check silently skipped after undoing a booking creation** — FIXED 2026-09-02,
  found by an external code review and verified before fixing (a regression test proved the
  bug first). `offerUndo` (`ui/toast.ts`) forwarded the *original* action's `CellUndo.prev`
  (the state before that action) as the CAS check for the undo-click's own server request.
  Undoing a deletion happened to still be safe (the "book" branch's own independent
  conflict check doesn't consult `prev`), but undoing a *creation* has `prev: null` — which
  the server (`server/mutate.ts`'s `writeCell`) treats as "no CAS check requested", so the
  delete proceeded unconditionally against whatever was actually on the cell, including a
  booking someone else made there since. Fix: `offerUndo` now captures the cell's actual
  current value right before applying the undo, and sends *that* as the CAS check — matching
  how every other write in the app already computes it. Two regression tests in
  `toast.test.ts` (one per undo direction).
- **`machById` cache stale after a machine create/delete** — FIXED 2026-09-02, same review.
  `saveMachine`/`deleteMachine`/`moveMachine` (`core/booking.ts`) mutate `data.machines` IN
  PLACE (`.splice()`/swap) rather than replacing the array, so `machById`'s
  reference-equality cache never rebuilt for them. Traced per-operation: edits and reorders
  were already safe (same object references); only create/delete left a window where
  `machById` returned `undefined`/a stale object until the next full data reload. Fix: a new
  `invalidateMachineLookupCache()` (`ui/machine-lookup.ts`), called from `ui/mutate.ts` on
  the same "no `undo` array" signal that already distinguishes a structural change from a
  booking-cell one — kept out of `core/booking.ts` to preserve its DOM-free purity rule.
- **`wknd` class lost on cell patch** — FIXED post-Phase-7 (2026-09-01), as its own small
  flagged step (not part of the migration itself — the whole point of every Phase 7 slice was
  faithful conservation, so this waited until the migration was done and the code was safe to
  deliberately change). `render()`/`GridBody.tsx` added a `wknd` class to weekend cells; the
  targeted patch path (`refreshCell`, now `ui/cell-patch.ts`) didn't — so a booking write/delete
  on a weekend column silently lost its `wknd` styling until the next full render. Only visible
  when weekends are shown (`mb_weekends==='on'`). Fix: `refreshCell` now computes
  `isWeekend(parseIsoDateString(date))` itself and passes it to `cellClass` on every branch
  (blocked/booked/unavail/free), matching what `GridBody.tsx` already does for the full render.
  5 new regression tests (`cell-patch.test.ts`) covering every branch independently (the bug
  could resurface in any one without the others). Browser-verified: booked, then deleted, a
  weekend cell with weekends shown — `wknd` survived both patches.
- **`migrating` / `migratingMess` undeclared implicit globals** — FIXED in Phase 2.3.
  Root cause: two obsolete one-time client-side Bestands-Migrationen (`migrateWeekends`,
  `migrateMesstechnik`) from the old File-System-Access variant referenced undeclared globals, so
  under `'use strict'` they threw `ReferenceError` at init (uncaught async → non-fatal) and never
  actually ran. Investigation showed merely *declaring* the vars was the wrong fix: it resurrects
  `migrateWeekends`, which then fires a weekend-bridge write the **server rejects with HTTP 400** on
  every load — i.e. it does NOT conserve behavior. The correct, behavior-preserving fix was to
  **remove the two obsolete migrations and their `startUI()` calls** (server data is authoritative
  and already consistent; `migrateMesstechnik` needed a local folder that no longer exists). Result:
  console clean, no write attempted (rev unchanged). Acceptance was integration-level (fresh-tab
  console clean + zero `/api/mutate` + rev stable), since the defect lived in impure obsolete init
  code with no meaningful unit-test surface.
