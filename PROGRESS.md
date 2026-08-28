# PROGRESS — living project state

**Read this first when resuming, and after any context clear.** It is the single source of
truth for *where we are* and *what's next*. Update it whenever an item lands or the plan
changes. (The stable design lives in `ARCHITECTURE.md`; the volatile state lives here.)

_Last updated: 2026-08-28 — Phase 2: 2.0–2.3 landed (dates, machines, weekend); `migrating` bug fixed._

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
- Verified in a fresh browser tab (Vite :5173 → backend :3000): grid renders, all helpers bridged,
  **console entirely clean** (no `migrating`, no `/api/mutate`), backend rev unchanged (no write).
- **Next: 2.4 `core/assistant.ts`** — the last core module.

## Next step
> **Step 2.4 `core/assistant.ts`** — test-first. Extract the device/group tree + N-of-M solver
> from `legacy.js` (the `AS_*` / assistant helpers — read `legacy.js` for the exact pure set;
> tree-walk + selection logic is pure, the `renderWork()`/DOM parts stay behind). Write tests
> capturing behavior, implement the gated module, add to the `app.ts` bridge, delete originals from
> `legacy.js`, `verify` (90/85 holds), browser-smoke, commit. Completes Phase 2.

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
- [ ] 2.4 `core/assistant.ts` (+ tests)

**Phase 3 — State + net**
- [ ] 3.1 `state.ts` (store + subscribe/notify)
- [ ] 3.2 `net/api.ts`
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
