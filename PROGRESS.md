# PROGRESS — living project state

**Read this first when resuming, and after any context clear.** It is the single source of
truth for *where we are* and *what's next*. Update it whenever an item lands or the plan
changes. (The stable design lives in `ARCHITECTURE.md`; the volatile state lives here.)

_Last updated: 2026-08-28 — after Phase 1, step 1.1._

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
- **Phase 0 / 0.5** — done. **Phase 1 in progress.**
- **Step 1.1 done:** the app now also runs under Vite from `web/` (copy of `index.html`),
  with `/api` (incl. SSE) proxied to the backend. Verified: page + `/api/state` load at
  :5173 and the grid renders identically to the original. `web/index.html` is prettier-
  quarantined (unformatted legacy), consistent with `src/`.
- Production still serves the original `public/index.html` — untouched until step 1.4.
- Cadence: checking in after each Phase-1 sub-step (per user request).

## Next step
> **Step 1.2** — move the monolith's inline `<script>` out of `web/index.html` into
> `web/js/legacy.ts` (the gate-excluded quarantine), and point the HTML at it via
> `<script type="module" src="/js/legacy.ts">`. Goal: app boots byte-for-byte identically,
> now with the JS in its own file ready to carve from. Verify at :5173 + browser smoke.
> Dev server: `docker compose -f docker-compose.dev.yml run --rm --service-ports dev npm run dev`
> (backend must be up: `docker compose up -d`).

## Backlog (task queue — the single canonical copy)
Checked off as each item lands (one commit per item unless noted).

**Phase 1 — Skeleton (app runs identically, structure ready for extraction)**
- [x] 1.1 Vite `web/` root serving the current `index.html` unchanged; app loads identically
- [ ] 1.2 Move the monolith's inline `<script>` into `web/js/legacy.ts` (gate-excluded
  quarantine) + a thin `web/js/app.ts` that imports it; app boots byte-for-byte
- [ ] 1.3 Lift the `<style>` block into `web/css/app.css`; app looks identical
- [ ] 1.4 Multi-stage Dockerfile + server serve the Vite build; `docker compose up` works

**Phase 2 — Core logic (TDD; coverage 90/85 arms here)**
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
- [ ] 5.1 delete dead code; `legacy.ts` reaches zero; promote knip into `verify`
- [ ] 5.2 tidy CSS/HTML

**Phase 6 — Backend → TypeScript**
- [ ] 6.1 `server/` conversion + tests for mutate concurrency/validation
- [ ] 6.2 remove `src/` from the gate exclusions; full gate covers backend

## Done log (newest first)
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
