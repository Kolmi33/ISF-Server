# Architecture & Coding Principles

This document is the contract for the top-down rework of the Maschinenplan booking
tool. It captures **what we're building toward** and **how we work**, so every change
is consistent and no behavior is lost along the way.

Status: living document. Updated as each phase lands.

---

## 1. Goal

Rework the codebase from the ground up — **conserving every feature, UI detail, and
granular behavior** — while replacing an unmaintainable structure with a typed, tested,
modular one. This is a **refactor, not a reimagining**: behavior is preserved; structure
is rebuilt.

## 2. What we started from (the baseline)

- **Backend** (`src/*.mjs`, ~350 lines): zero-dependency Node + built-in `node:sqlite`.
  Genuinely good — single server-side write path, compare-and-set concurrency (nobody
  clobbers a colleague's booking), server-side validation, SSE live updates + presence,
  daily rotating backups, graceful shutdown. **We preserve its behavior**; we convert it
  to TypeScript but do not redesign it.
- **Frontend** (`public/index.html`, ~3200 lines): the entire app — HTML, CSS, and ~130
  functions on one global mutable `S` — in a single file, rendered via innerHTML strings.
  **This is the real target of the rework.**

The untouched baseline is committed as git tag-able commit `789bfec` ("Baseline: working
booking app as inherited"). We can always diff against it.

## 3. Stack decisions (settled)

| Decision | Choice | Why |
|---|---|---|
| Frontend language | **TypeScript** | Type safety over the global-state code is where the risk is |
| Build tool | **Vite** | Dev server (HMR) + static production bundle |
| Test runner | **Vitest** | Native TS, pairs with Vite, fast |
| Backend | **TypeScript**, compiled in the Docker build | One language across the repo |
| Runtime deps | **Zero** (backend) | Compiled output uses only Node built-ins; a strength we keep |
| Dev environment | **Dockerized** (`node:22` container) | The Windows host has no Node and stays clean |
| Testing method | **TDD on each new module as it is extracted** | Tests are the preserved spec for the logic |

## 4. Target layout

The app keeps working at every step. Directories move in their phase, not all at once.

```
maschinenplan-server/
├── shared/
│   └── types.ts            # single source of truth: Machine, Booking, MaintSlot, SSE events, mutate payloads
├── server/                 # backend TS (was src/*.mjs) — compiled in the Docker build
│   ├── server.ts           # HTTP API + SSE + backup
│   ├── db.ts               # SQLite schema + meta + import
│   └── import.ts           # one-off seed CLI
├── web/                    # frontend (Vite root; was public/)
│   ├── index.html          # thin shell: DOM skeleton, SVG icons, <script type=module>
│   ├── css/app.css         # lifted out of the old <style> block
│   └── js/
│       ├── app.ts          # entry: boot, wire events, orchestrate
│       ├── state.ts        # the store (replaces global S) + subscribe/notify
│       ├── core/           # PURE logic, no DOM — highest test value
│       │   ├── dates.ts        # ymd, mondayOf, isoWeek, weekdayRange, …
│       │   ├── machines.ts     # catOf, dayAvailable, maintAt, cellBookable, …
│       │   ├── weekend.ts      # sweepWeekends, missingWeekendBridges
│       │   └── assistant.ts    # device/group tree + N-of-M solver
│       ├── net/            # server communication
│       │   ├── api.ts          # apiGet/apiPost, mutate, persist, refreshNow
│       │   └── sse.ts          # connectSSE, presence, live updates
│       └── ui/             # DOM — extracted last, on top of a tested core
│           ├── grid.ts, selection.ts, navigation.ts, modal.ts
│           └── views/          # one file per screen (booking form/detail, assistant,
│                               # stats, all/my bookings, admin, machine form, log, settings, help)
├── data/                   # runtime DB + backups (gitignored, created in container)
├── Dockerfile              # multi-stage: build web (vite) + server (tsc) -> lean runtime
├── docker-compose.yml      # production
└── docker-compose.dev.yml  # dev toolchain (Node only lives here)
```

## 5. Coding principles

1. **Pure core has no DOM.** Everything in `core/` is pure functions of data → data.
   No `document`, no globals. This is what makes it trivially testable and is where our
   tests concentrate.
2. **One server-side write path stays authoritative.** The client is never trusted
   (there is no login). All validation and compare-and-set concurrency stay on the server.
3. **State changes go through the store**, not ad-hoc global mutation. `state.ts` owns
   the app state and notifies subscribers; UI re-renders from state.
4. **Conserve behavior.** When in doubt, the old code's behavior is the spec. Tests
   encode it; the git baseline is the reference.
5. **Small, reversible commits.** One module (or one cohesive step) per commit, each with
   passing tests and a quick manual smoke of the touched behavior.
6. **Types are the contract.** Domain shapes live once in `shared/types.ts` and are used
   by both sides.
7. **Zero runtime dependencies stay zero.** Dev tooling is fine; the shipped image is lean.

## 6. Extraction sequence (phases)

| Phase | What | State |
|---|---|---|
| 0 | Safety net + dockerized toolchain + these docs | **done** |
| 1 | Skeleton: Vite web root, move the monolith into a TS entry, app runs identically under Vite; wire Dockerfile/server for built output | next |
| 2 | Core logic (TDD): `dates` → `machines` → `weekend` → `assistant` | |
| 3 | State store + `net/` (api, sse) | |
| 4 | UI: grid + reactive core, then selection, navigation, then each view | |
| 5 | Polish: delete dead code, tidy CSS/HTML | |
| 6 | Backend → TypeScript (+ tests for mutate concurrency/validation) | |

## 7. The per-module loop (the repeatable unit)

Each iteration is one small commit:

1. **Read** the target functions in the monolith.
2. **Write the test** for the new module's intended behavior (red). Expected outputs are
   derived from the existing code, so the test *is* the preserved spec.
3. **Implement** the module until green.
4. **Rewire** the app to import from it; delete the old copies.
5. **Verify** — tests pass + a quick browser smoke of the touched behavior (see FEATURES.md).
6. **Commit.**

## 8. Dev workflow (dockerized — no host Node)

Node lives only in the `dev` container defined in `docker-compose.dev.yml`.

```bash
# install / update dependencies
docker compose -f docker-compose.dev.yml run --rm dev npm install

# run the test suite (the TDD loop)
docker compose -f docker-compose.dev.yml run --rm dev npm test

# watch mode
docker compose -f docker-compose.dev.yml run --rm dev npm run test:watch

# type-check the whole repo
docker compose -f docker-compose.dev.yml run --rm dev npm run check

# Vite dev server (browse at http://localhost:5173)
docker compose -f docker-compose.dev.yml run --rm --service-ports dev npm run dev
```

Production is unchanged for now: `docker compose up -d --build` (see START.md), until
Phase 1 switches the image to serve the Vite build.

## 9. Known follow-ups

- Dev dependencies report npm-audit vulnerabilities (dev-only, transitive via Vite/Vitest).
  They do not affect the zero-dependency runtime. Revisit before finalizing.
- `node:sqlite` is still experimental in Node 22; the server runs with
  `--disable-warning=ExperimentalWarning`. Confirm the flag/loader story when the backend
  moves to TypeScript in Phase 6.
