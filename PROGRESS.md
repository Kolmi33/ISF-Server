# PROGRESS — living project state

**Read this first when resuming, and after any context clear.** It is the single source of
truth for *where we are* and *what's next*. Update it whenever an item lands or the plan
changes. (The stable design lives in `ARCHITECTURE.md`; the volatile state lives here.)

_Last updated: 2026-08-28 — **Phase 2 COMPLETE** (2.0–2.4b); `migrating` bug fixed; weekend-bridge feature → Phase 6.3._

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
> **Phase 3.3 `net/sse.ts`** — extract the live-connection layer from legacy (`connectSSE`,
> `applyPresence`, the `es`/`EventSource` lifecycle). It is the **first `notify` consumer**: the
> `update`/`structural` handlers should route through `store.set(...)` → `notify()` rather than
> mutating `S.data` + `patchCells` inline — but **still do NOT subscribe `render`** (D2/Q2b; UI
> reactivity is revisited in Phase 4). Split pure/testable bits out (event `data` JSON parsing,
> the `changes[]`→bookings-patch reduction, presence-list formatting) and unit-test them (E4/E7);
> the `EventSource` wiring + DOM/toast side effects are browser-smoked (E5). Reuse the bridged
> `API`/`readFile`/`normalizeState` from 3.2. Mind: `net/ ↛ ui/` boundary — the DOM/toast calls
> (`stampRef`, `patchCells`, `toast`, `fillGroupSel`, `queueRemote`) stay as legacy-provided
> callbacks injected in, not imported.
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
- [ ] 3.3 `net/sse.ts`

**Phase 4 — UI**
- [ ] 4.1 `ui/grid.ts` + reactive core
- [ ] 4.2 `ui/selection.ts`, `ui/navigation.ts`
- [ ] 4.3 `ui/views/*` (one screen per commit)

**Phase 5 — Polish**
- [ ] 5.1 delete dead code; `legacy.js` reaches zero; promote knip into `verify`
- [ ] 5.2 tidy CSS/HTML

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
