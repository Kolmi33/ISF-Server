# PROGRESS — living project state

**Read this first when resuming, and after any context clear.** It is the single source of
truth for *where we are* and *what's next*. Update it whenever an item lands or the plan
changes. (The stable design lives in `ARCHITECTURE.md`; the volatile state lives here.)

_Last updated: 2026-08-28 — after Phase 1, step 1.3._

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
- **Phase 0 / 0.5** — done. **Phase 1 in progress** (1.1, 1.2, 1.3 done).
- **Step 1.3 done:** the `<style>` block is now `web/css/app.css` (305 lines), linked via
  `<link rel="stylesheet" href="/css/app.css">`; `web/index.html` is a 195-line shell. Verified
  at :5173: stylesheet loads and applies (body bg `#f4f5f7`, CSS vars resolve), grid renders
  (3675 cells), only the known pre-existing console error. `app.css` is prettier-quarantined
  (byte-identical for now; tidy in Phase 5.2).
- Production still serves the original `public/index.html` — untouched until step 1.4.
- Cadence: checking in after each Phase-1 sub-step (per user request).

## Next step
> **Step 1.4** — make the Vite build the thing production serves. Multi-stage Dockerfile
> (`vite build` → static bundle in `dist/public`), and point the server at the built output
> instead of `public/`. Then retire the old top-level `public/`. Goal: `docker compose up -d
> --build` serves the reworked frontend, still behaving identically. This is the Phase-1
> cutover — verify the production container (not just the dev server) end-to-end before
> deleting `public/`.

## Backlog (task queue — the single canonical copy)
Checked off as each item lands (one commit per item unless noted).

**Phase 1 — Skeleton (app runs identically, structure ready for extraction)**
- [x] 1.1 Vite `web/` root serving the current `index.html` unchanged; app loads identically
- [x] 1.2 Monolith inline `<script>` → `web/public/legacy.js` (classic, global-scope,
  gate-excluded); app boots byte-for-byte
- [x] 1.3 Lift the `<style>` block into `web/css/app.css`; app looks identical
- [ ] 1.4 Multi-stage Dockerfile + server serve the Vite build; `docker compose up` works

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
