# PROGRESS — living project state

**Read this first when resuming, and after any context clear.** It is the single source of
truth for *where we are* and *what's next*. Update it whenever an item lands or the plan
changes. (The stable design lives in `ARCHITECTURE.md`; the volatile state lives here.)

_Last updated: 2026-08-29 — **Phase 5 COMPLETE** (5.1 write-path reducers → `core/booking.ts`, 5.2 FS-era burn-down, 5.3 knip-in-verify + coverage floor). Next: Phase 6 (backend → TS)._

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
> **Phase 6 — Backend → TypeScript.** Phase 5 is complete (5.1 write-path reducers → `core/booking.ts`,
> 5.2 FS-era burn-down, 5.3 knip-in-`verify` + repo-wide coverage floor). The frontend logic core is fully
> gated (213 tests, 100%); `legacy.js` is a DOM adapter over bridged pure logic (2362 lines, from 2712).
> **The backend (`src/*.mjs`) has been sealed/gate-excluded until here — Phase 6 opens it.**
>   1. **6.1** convert `src/server.mjs` + `src/import.mjs` to TS under `server/`; add tests for the mutate
>      concurrency/validation (the 1000-cell batch cap, compare-and-set, revision bump). Re-add the
>      `server/*.ts` knip entries removed in 5.3.
>   2. **6.2** remove `src/` from the gate exclusions (tsconfig/eslint/vitest/knip); the full gate covers backend.
>   3. **6.3** server-authoritative weekend auto-bridging (feature; scope = *maintain + backfill*, decided
>      2026-08-28 — see "Deferred features"). Reuse the pure bridge computation (recover `missingWeekendBridges`
>      from git); mind the 1000-cell cap (1794 missing bridges → must be internal SQL, not an API batch).
>
> **Carry into Phase 6 (deferred from Phase 5, with rationale in §16):** the trivial modal-markup fold and the
> `AS_TREE`-adapter / `window.S` shrink (a real store migration, not a burn-down), plus the **wknd-on-patch**
> known bug. **Action-layer question (§16) still open:** thin `actions.ts` vs. the legacy `mutate` orchestrator
> (which still owns persistence + the optimistic patch) — resolve when the store migration lands.
>
> **View-layer decision (resolved, §15):** no framework — custom string render + the store
> subscription (now live). Revisit only if the UI grows materially.
>
> **View-layer decision (resolved, §15):** no framework — keep the custom string render + a tiny
> store subscription (zero-dep). Revisit only if the UI grows materially.
>
> **Canonical-naming rule (do not drift):** `store` is canonical for all new TS; `window.S` is a
> legacy-only bridge that only shrinks. No new code introduces `S` accesses. (ARCHITECTURE §14.)

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
- [ ] 6.1 `server/` conversion + tests for mutate concurrency/validation
- [ ] 6.2 remove `src/` from the gate exclusions; full gate covers backend
- [ ] 6.3 **Server-authoritative weekend auto-bridging** (feature; scope decided 2026-08-28 =
  *maintain + backfill*). See "Deferred features" below for the full design + grounded facts.

## Deferred features (decided, scheduled — not yet built)

### Server-authoritative weekend auto-bridging  → Phase 6.3
**Decision (2026-08-28):** scope = **maintain + backfill** (full). Build it in Phase 6 with the
backend TS conversion — do NOT crack open the baseline backend earlier (sticks to the plan +
"backend sealed until Phase 6" principle).

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

## Done log (newest first)
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
- **`wknd` class lost on cell patch.** `render()` adds a `wknd` class to weekend cells; the targeted
  patch path (`refreshCell`) does not — so on a booking update a weekend column loses its `wknd`
  styling until the next full `render()`. Only visible when weekends are shown (`mb_weekends==='on'`,
  `dpw()===7`; default is Mon–Fri, no weekend columns). Pre-existing; **preserved verbatim** in the
  Phase-4.1a cell-model extraction (E1/E2 — an extraction must not silently change behavior). Fix =
  pass `weekend` to `cellClass` from `refreshCell` too, in a flagged Phase-4/5 step. Grounded facts:
  `render()` `web/public/legacy.js:~792`, `refreshCell()` `~868`; helper `cellClass` in `web/js/ui/grid.ts`.

### Fixed
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
