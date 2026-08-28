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

## 5. Project-specific rules

The general coding standard is **`PRINCIPLES.md`** (P0–P6). These are the rules specific to
*this* codebase — the concrete shape those principles take here:

1. **Pure `core/` has no DOM.** Everything in `core/` is pure functions of data → data.
   No `document`, no globals. Trivially testable; where our tests concentrate. (Lint-enforced.)
2. **One server-side write path stays authoritative.** The client is never trusted (there is
   no login). All validation and compare-and-set concurrency stay on the server.
3. **State changes go through the store**, not ad-hoc global mutation. `state.ts` owns the
   app state and notifies subscribers; UI re-renders from state.
4. **Conserve behavior.** When in doubt, the old code's behavior is the spec. Tests encode it;
   the git baseline `789bfec` is the reference.
5. **Types are the contract.** Domain shapes live once in `shared/types.ts`, used by both sides.
6. **Zero runtime dependencies stay zero.** Dev tooling is fine; the shipped image is lean.

(Workflow rules — small reversible commits, one module per commit — are in `CLAUDE.md`.)

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

Canonical steps: `CLAUDE.md` → "How we work: the per-module loop". It is `PRINCIPLES.md`'s
implementation loop applied to a single module extraction. Its Definition of Done and the
autonomy / stop-conditions are in §11.

## 8. Dev workflow (dockerized — no host Node)

Node lives only in the `dev` container (`docker-compose.dev.yml`). The common commands
(`verify`, `test`, `check`, `dev`) are in `CLAUDE.md`. Additionally:

```bash
docker compose -f docker-compose.dev.yml run --rm dev npm install         # install/update deps
docker compose -f docker-compose.dev.yml run --rm dev npm run test:watch   # watch mode
```

Production is unchanged for now: `docker compose up -d --build` (see START.md), until
Phase 1 switches the image to serve the Vite build.

## 9. Known follow-ups

- Dev dependencies report npm-audit vulnerabilities (dev-only, transitive via Vite/Vitest).
  They do not affect the zero-dependency runtime. Revisit before finalizing.
- `node:sqlite` is still experimental in Node 22; the server runs with
  `--disable-warning=ExperimentalWarning`. Confirm the flag/loader story when the backend
  moves to TypeScript in Phase 6.

---

## 10. Quality gates — the `verify` oracle

Principles are only real if they're **enforced deterministically**. `npm run verify` runs
every gate in sequence; its exit code is the single source of truth:

> **Exit 0 ⇒ principles hold ⇒ proceed. Non-zero ⇒ stop and fix. Nothing is "done" until
> `verify` is green (in the dev container) and committed.**

| Gate | Tool | Pass condition | Principle enforced |
|---|---|---|---|
| Format | `prettier --check` | 0 diffs | consistent style |
| Types | `tsc --noEmit` (strict) | 0 errors | types are the contract |
| Lint — no `any` | `@typescript-eslint/no-explicit-any` | 0 | real types, no escape hatches |
| Lint — boundaries | eslint import rules | 0 | **core/ has no DOM**; ui/ ⊄ server/; layered deps |
| Lint — complexity | `complexity` | ≤ **12** / fn | small units |
| Lint — fn length | `max-lines-per-function` | ≤ **60** | small units |
| Lint — file length | `max-lines` | ≤ **400** | no new monoliths |
| Tests | `vitest run` | 100% pass | behavior specified |
| Coverage — core/ | vitest v8 | lines ≥ **90%**, branches ≥ **85%** | pure logic pinned |
| Coverage — global | vitest v8 | lines ≥ **70%** | honest floor |
| Dead code | `knip` | 0 unused | no rot |

### Calibrated thresholds (locked)
- **Coverage — core/**: lines ≥ **90%**, branches ≥ **85%**. Enforced from Phase 2, when the
  first `core/` module exists (before that there is nothing to cover).
- **Enforcement**: **hard** — a git `pre-commit` hook runs the dockerized `verify` and blocks
  any commit that fails (see §12).
- **Complexity 12 / fn-length 60 / file-length 400 / global-coverage 70%**: sensible defaults,
  not separately calibrated; adjust with reasoning if they prove wrong in practice.

All tools are dev-only — the shipped runtime stays zero-dependency. Changing any threshold is a
one-line config edit, made deliberately (never bypassed).

### The legacy quarantine (reconciling a hard gate with "carve, don't rewrite")
A hard gate would reject the 3,200-line monolith the instant it entered as TypeScript. So:
- New code (`core/`, `state`, `net/`, `ui/`, `server/`) faces the **full gate from day one**.
- The not-yet-extracted monolith lives in **`web/public/legacy.js`**, a **classic** (non-module)
  script loaded via `<script src="/legacy.js">`. It stays classic on purpose: the app has 125
  inline `onclick=` handlers that rely on its ~130 functions being **global** — an ES module would
  hide them and break every button. Classic scope preserves behavior with zero code change.
- It is explicitly **gate-excluded** (ESLint/Prettier/tsc) — a shrinking quarantine, not an
  exception to the standard. Every extraction moves code *out* of `legacy.js` into a gated ES
  module; the module's public functions are bridged onto `window` so the remaining legacy handlers
  keep resolving during the transition.
- `legacy.js` must reach zero by Phase 5; its line count is a tracked burn-down (2712 at 1.2).

### What the gate does NOT catch (honest limits)
- **UI behavior preservation** — not machine-checkable. Backstop: `FEATURES.md` manual smoke
  after risky phases + diff against baseline `789bfec`.
- **Naming / readability** — brief self-review per module; not automated.

The current `verify` is a minimal seed (`check` + `test`); the remaining gates are wired once
their thresholds are calibrated.

## 11. The iteration loop

The repeatable unit is **one module extraction** (§7). The loop repeats it over a backlog.

**Definition of Done (per iteration — all machine-checkable):**
1. New module + its test file exist.
2. `npm run verify` is green.
3. The old copies in the monolith are deleted and call sites rewired.
4. Exactly one commit captures the step.

**Loop:** `while backlog not empty: take next item → per-module loop → verify → commit`.

**Token discipline** (deliberate — keep cost bounded):
- One module per iteration bounds the context each step needs.
- `verify`'s exit code is the oracle — read pass/fail, not the whole tree, to know we're done.
- State lives in **git + the backlog**, so context can compact mid-run and any fresh session
  resumes from the backlog with no re-discovery.

**Hard stop conditions** (prevent runaway spend — the loop MUST halt and surface to the user):
- Backlog is empty (phase complete).
- The same item fails `verify` twice in a row → escalate, don't thrash.
- A per-run budget is reached (iterations or tokens), whichever the run sets.

**Check-in cadence (calibrated):** **per-phase.** Within a phase, run the backlog
autonomously — extract, `verify`, and commit each module without pausing. At a phase boundary
(or any hard stop condition), pause with a summary for review before starting the next phase.
For a large, cohesive body of work spanning closely related phases, batching them before a
check-in is acceptable; when in doubt, stop at the phase boundary.

## 12. Persistence across sessions

So the setup "just works" every time, including after a context clear:
- **`PROGRESS.md`** — the living state + backlog + how-to-resume. **Read first** on any resume.
- **`CLAUDE.md`** (repo root, auto-loaded) — the durable operating manual; points to PROGRESS.md.
- **`PRINCIPLES.md`** — the coding standard (P0–P6).
- **git `pre-commit` hook** (`.githooks/`, calls the dockerized `verify`) — makes committing
  red impossible. Enable once per clone: `git config core.hooksPath .githooks`.

## 13. Backlog

The live task queue and done-log are in **`PROGRESS.md`** (single canonical copy, updated as
items land). The phase overview is §6 above.
