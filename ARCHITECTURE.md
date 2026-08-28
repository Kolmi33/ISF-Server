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

The general coding standard is **`PRINCIPLES.md`** (P0–P6, plus the in-depth **E1–E8** operating
principles that govern how we extract). These are the rules specific to *this* codebase — the
concrete shape those principles take here:

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
| 1 | Skeleton: Vite web root, monolith → classic `legacy.js`, CSS → `app.css`, production serves the build | **done** |
| 2 | Core logic (TDD): `dates` → `machines` → `weekend` → `assistant` | **done** (4 modules, 78 tests, 100% cov; `migrating` bug fixed) |
| 3 | State store + `net/` (api, sse) | next |
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

`verify` now runs the full sequence — `format:check → check → lint → test:cov` — with the
`core/**` coverage threshold (90/85) enforced from Phase 2 onward. `knip` (dead code) and a
global coverage floor are the remaining gates, promoted in Phase 5 when there is enough
extracted surface for them to be meaningful.

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

## 14. Phase 3 design — the state store  _(DECIDED 2026-08-28; 3.1 IMPLEMENTED — `web/js/state.ts`, gate + smoke green)_

### The problem
`S` is a `const` object (`legacy.js:8`) with **~16 fields** and **158 direct `S.x` access sites**.
Reactivity today is **manual**: code mutates `S` (often deeply, e.g. `S.data.bookings[m][d]=…`),
then calls `render()` (and `saveFilters()` for persisted filters). There is no subscribe/notify.
ARCHITECTURE §5 rule 3 wants: *state changes go through a store that notifies subscribers; UI
re-renders from state.*

### Approach — E3 ownership substitution (no call-site churn in 3.1)
`state.ts` becomes the **owner** of the state object; `app.ts` bridges it as `window.S`; `legacy.js`
**drops its `const S = {…}`** and its bare `S.x` references resolve to the bridged global. Result:
**zero of the 158 sites change in 3.1** — the store simply owns the same object legacy already uses.
Type safety accrues to new TS code now, and to legacy sites as they migrate to TS in Phase 4.

### Store API (sketch)
```ts
// web/js/state.ts
export interface Store {
  state: AppState;                                   // the live object (bridged as window.S)
  get<K extends keyof AppState>(k: K): AppState[K];
  set(patch: Partial<AppState>): void;               // shallow-merge + notify()
  subscribe(fn: (s: AppState) => void): () => void;  // returns an unsubscribe
  notify(): void;
}
export function createStore(initial: AppState): Store;   // PURE — initial injected (E4), unit-tested
```
`AppState` and `ServerData` (= `BookingData` + `groups`/`log`/`revision`) go in `shared/types.ts`.

### Decisions (for evaluation)
| # | Decision | Chosen | Trade-off / why |
|---|---|---|---|
| D1 | Ownership vs. migrate 158 sites | **Own the object; legacy keeps using `window.S`** | Zero churn/regression risk in 3.1 (E3). Legacy stays untyped JS (already un-gated); types accrue to new code. Big-bang rewrite rejected. |

### Migration rule — naming (decided, Q1)
**`store` is the canonical abstraction from 3.1 onward.** `web/js/state.ts` exports `store`; all new
TypeScript code uses `store` / `store.state` and its typed accessors. **`window.S` exists only as a
legacy compatibility bridge** (it *is* `store.state`, same reference) so the 158 un-migrated legacy
sites keep working. **No new code may introduce additional `S` accesses.** As legacy consumers move to
TS (Phase 4), they switch to `store`; `window.S` is deleted once the last consumer is migrated. This
keeps the naming from drifting: `S` only ever shrinks.
| D2 | Reactive now vs. manual render | **Keep manual `render()` in 3.1**; build+test subscribe/notify but don't rewire `render` yet | Behavior-identical (E1/E2). notify is *used* in 3.3 (SSE→`set`→notify) and Phase 4 — not YAGNI, just not wired in 3.1. Auto-reactive-now would change render timing → regressions. |
| D3 | Store purity | **`createStore(initial)` pure + fully unit-tested**; localStorage hydration separate, storage-reader injected (E4) | Testable in node (no `localStorage`). app.ts wires the real localStorage + `mondayOf(new Date())`. |
| D4 | State shape fidelity | **Keep the shape byte-identical** (incl. now-dead `lastRaw`) | E1 faithful port. `writeFile`/`S.handle`/`S.dir`/`lastRaw` are FS-era dead code → **Phase 5 removal** (E8), not snuck into 3.1. |
| D5 | `machById` cache (`S._mbi`) | **Stays in legacy for 3.1** | It's a state-derived selector; migrating it is a later 3.x step. Works as a dynamic prop on `window.S`. |
| D6 | Coverage policy for new layer | **Extend the 90/85 threshold to `web/js/state.ts`** (pure store = core-grade). `net/` (fetch/SSE) is smoke-tested (E5); extract pure bits (URL build, SSE parse) to unit-test | Deliberate gate-config change; recorded so it's intentional. |

### 3.1 scope (does / defers)
- **Does:** create `state.ts` (`createStore` + get/set/subscribe/notify, unit-tested); add `AppState`/
  `ServerData` to `shared/types.ts`; `app.ts` hydrates from localStorage + bridges `window.S`; remove
  `const S` from `legacy.js`. Verify + browser-smoke (app boots, filters persist, grid renders — behavior
  identical). Wire D6 coverage.
- **Defers:** rewiring `render()` to `notify()` (3.3/Phase 4); migrating the 158 sites to typed accessors
  (Phase 4); moving `machById`/`saveFilters` into the store (later 3.x); dead-code removal (Phase 5).

### Open questions
- **Q1 name — RESOLVED:** `store` is canonical; `window.S` is a legacy-only compat bridge that shrinks
  to zero. See "Migration rule — naming" above.
- **Q3 coverage — RESOLVED (yes):** the hard 90/85 threshold extends to `web/js/state.ts` (D6).
- **Q2 view layer — RESOLVED (custom minimal store; defer view layer to Phase 4).** Brief evaluation
  below. **Q2b reactivity — RESOLVED (yes, defer render-on-notify):** keep manual `render()` in 3.1;
  build + test `subscribe/notify` but don't subscribe `render` yet; first consumer is SSE in 3.3;
  revisit UI reactivity when the view layer is evaluated/migrated in Phase 4 (per D2).

### View-layer evaluation (brief, evidence-based — Q2)
Measured coupling in `legacy.js` (2569 lines, 143 functions): **23** `innerHTML` render points,
**~150** event bindings (73 inline `onclick=` + 79 `.onXxx=` assignments), **~400** direct DOM
accesses (228 `document.`, 181 `getElementById`, 67 `querySelector`). Any component/template library
(React, `lit`, Svelte, …) would require rewriting essentially **all** of this now — a broad UI rewrite
that contradicts *refactor-not-reimagine* (§1) and the **zero-runtime-dep** invariant (§5.6). Expected
growth is low: a mature internal tool with a fixed set of screens (grid + ~10 modals), being
restructured, not expanded — so framework ROI is weak. **Decision:** proceed with the custom minimal
store (~30 lines, typed, tested). **Defer** any view-layer choice to **Phase 4**, decided on evidence
once the UI is extracted into TS view modules; if anything is adopted then, prefer zero-runtime-dep
options (native templates + a tiny signals helper, or a compile-away approach like Svelte), weighed
explicitly against §5.6.
