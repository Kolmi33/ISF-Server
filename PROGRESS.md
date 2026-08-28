# PROGRESS — living project state

**Read this first when resuming, and after any context clear.** It is the single source of
truth for *where we are* and *what's next*. Update it whenever an item lands or the plan
changes. (The stable design lives in `ARCHITECTURE.md`; the volatile state lives here.)

_Last updated: 2026-08-28 — Phase 1 COMPLETE (through 1.4b)._

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
- The frontend is now cleanly split under Vite: `web/index.html` (195-line shell) +
  `web/css/app.css` (styles) + `web/public/legacy.js` (the quarantined monolith, classic/global).
  Production builds it (multi-stage Docker) and serves the built output; verified end-to-end at
  :3000. The old top-level `public/` is deleted (preserved in git baseline `789bfec`).
- Behavior is byte-identical to baseline throughout (same features, same look, same pre-existing
  `migrating` bug — see Known bugs).
- **Phase 2 (core logic, TDD) — not started.** This is next. Coverage 90/85 arms here.

## Next step
> **Step 2.0** — add the clean ESM entry `web/js/app.ts` (a `<script type="module">` loaded
> alongside `legacy.js`), empty except for a place to bridge extracted modules onto `window`.
> Then **2.1 `core/dates.ts`** test-first: write `dates.test.ts` capturing the behavior of the
> date helpers in `legacy.js` (ymd, mondayOf, isoWeek, weekdayRange, addDays, …), implement the
> gated module, bridge it onto `window`, delete the originals from `legacy.js`, verify the app
> still works. Coverage threshold (90/85 on `core/**`) is wired on in this step.

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
- [ ] 2.0 clean ESM entry `web/js/app.ts` (module, loaded alongside legacy.js); bridge
  extracted modules onto `window` so legacy's inline handlers keep resolving
- [ ] 2.1 `core/dates.ts` (+ tests)
- [ ] 2.2 `core/machines.ts` (+ tests)
- [ ] 2.3 `core/weekend.ts` (+ tests)
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

## Done log (newest first)
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

## Known bugs (pre-existing in baseline — fix deliberately, test-first, do NOT patch mid-move)
- **`migrating` / `migratingMess` undeclared implicit globals.** Used but never declared, so
  under `'use strict'` the weekend + messtechnik auto-migration paths throw `ReferenceError` at
  init (uncaught in an async promise → non-fatal; app still runs). Confirmed identical on the
  baseline at :3000, so 1.2 preserved behavior exactly. Fix when extracting that logic in Phase 2
  (`core/weekend`, `migrateMesstechnik`) — with a test that reproduces it first.
