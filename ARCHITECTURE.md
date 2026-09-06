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

**This tree is the Phase 1–6 target, kept as originally written.** Phase 7 (§18) replaced the
`legacy.js`-adapter view layer with React components under `ui/components/*.tsx` and added a
few small orchestration modules (`web/js/store-instance.ts` — the store singleton + hydration,
split out of `app.ts`; `web/js/ui/grid-render-bridge.ts` and the `GridInteractionHandlers`
pattern in `ui/grid-interaction.ts` — F8, `docs/ARCHITECTURE_AUDIT.md`) that this sketch
predates. The shape below (pure `core/`, thin `net/`, DOM-touching `ui/`, one store) is still
accurate; only `ui/`'s own internals grew a `components/` subtree. `PHASE7-PLAN.md` has the
authoritative slice-by-slice file list.

```
maschinenplan-server/
├── shared/
│   ├── types.ts            # single source of truth: Machine, Booking, MaintSlot, SSE events, mutate payloads
│   └── dates.ts            # pure calendar helpers, real *runtime* code shared with the
│                            # backend (not just types) — moved here from web/js/core/ once
│                            # server/*.ts needed the same date math and had no shared
│                            # module to reach for (docs/ARCHITECTURE_AUDIT.md §9/F2)
├── server/                 # backend TS (was src/*.mjs) — compiled in the Docker build
│   ├── server.ts           # HTTP API + SSE + backup
│   ├── db.ts               # SQLite schema + meta + import
│   └── import.ts           # one-off seed CLI
├── web/                    # frontend (Vite root; was public/)
│   ├── index.html          # thin shell: DOM skeleton, SVG icons, <script type=module>
│   ├── css/app.css         # lifted out of the old <style> block
│   └── js/
│       ├── app.ts          # entry: boot, wire events, orchestrate
│       ├── state.ts        # the store factory (createStore) — pure, DOM-free
│       ├── store-instance.ts   # the app's one store instance + localStorage hydration (Phase 7)
│       ├── core/           # PURE logic, no DOM — highest test value
│       │   ├── machines.ts     # catOf, dayAvailable, maintAt, cellBookable, …
│       │   ├── weekend.ts      # sweepWeekends, missingWeekendBridges
│       │   ├── booking.ts      # the write-path reducers (book/delete/machine CRUD)
│       │   └── assistant.ts    # device/group tree + N-of-M solver
│       ├── net/            # server communication
│       │   ├── api.ts          # apiGet/apiPost, mutate, persist, refreshNow
│       │   └── sse.ts          # connectSSE, presence, live updates
│       └── ui/             # DOM — extracted last, on top of a tested core
│           ├── grid.ts, selection.ts, navigation.ts, modal.tsx, grid-render-bridge.ts, …
│           ├── components/     # React components (Phase 7) — Grid, the modals, the toolbar
│           │                   # dropdowns; each screen's view-model kernel stays in ui/views/
│           └── views/          # one file per screen's pure view-model (booking form/detail,
│                               # assistant, stats, all/my bookings, admin, machine form, log)
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
6. **Backend runtime dependencies stay zero.** Dev tooling is fine; the shipped server
   image uses only Node built-ins. The frontend's runtime now includes `react`/`react-dom`
   (Phase 7, §18 — a deliberate, reasoned exception, not a drift from this rule).

(Workflow rules — small reversible commits, one module per commit — are in `CLAUDE.md`.)

## 6. Extraction sequence (phases)

| Phase | What | State |
|---|---|---|
| 0 | Safety net + dockerized toolchain + these docs | **done** |
| 1 | Skeleton: Vite web root, monolith → classic `legacy.js`, CSS → `app.css`, production serves the build | **done** |
| 2 | Core logic (TDD): `dates` → `machines` → `weekend` → `assistant` | **done** (4 modules, 78 tests, 100% cov; `migrating` bug fixed) |
| 3 | State store + `net/` (api, sse) | **done** (store + api + sse; §14) |
| 4 | UI: grid + reactive core, then selection, navigation, then each view | **done** (grid/selection/navigation + view kernels; §15) |
| 5 | Polish: write-path reducers → `core/booking`, dead-code burn-down, knip in verify | **done** (§16) |
| 6 | Backend → TypeScript (+ tests for mutate concurrency/validation) + weekend auto-bridging | **done** (§17; deploy + backfill ran 2026-09-01/02, see `PROGRESS.md`) |
| 7 | View layer → React, `legacy.js` deleted whole | **done** (§18; slice-by-slice detail in `PHASE7-PLAN.md`) |

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
  `--disable-warning=ExperimentalWarning`. **Resolved in Phase 6.1 (§17):** no runtime flag is
  needed on Node 22.23 (it only warns); it is loaded via `createRequire` so Vite/the bundler
  never tries to resolve it, and `@types/node` supplies the (erased) types.

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

### 3.3 SSE — adjustment to the plan (decided 2026-08-28)
The original backlog framed 3.3 `net/sse.ts` as *"the first `notify` consumer."* On implementing it,
the coupling made that premature. `connectSSE` needs ~10 legacy DOM/toast functions (`patchCells`,
`stampRef`, `toast`, `fillGroupSel`, `queueRemote`, `remoteMsg`, `setPres`, `handleError`, `render`,
`readFile`) plus the `EventSource` lifecycle and the `presenceData` global. Wiring `store.notify()`
now would require **either** hauling that whole orchestrator into `net/` behind a 10-callback injection
harness **or** bridging `store` into legacy (which violates the §14 migration rule — legacy uses
`window.S`, new TS uses `store`). And `notify` has **no subscribers until `render` subscribes in
Phase 4** (D2/Q2b), so the wiring would be a no-op either way.
**Decision (E3/E5/E8):** in 3.3, extract only the **pure event logic** to `net/sse.ts` — `applyUpdate`
(mutates bookings, returns rev + repaint patch), `presenceInfo` (badge count/label), `isForeign`
(remote-change gate) — unit-tested to 100%; keep `connectSSE`/`applyPresence` as the **thin
DOM/EventSource adapter in legacy**, refactored to call the bridged helpers (mirrors the Phase-2
assistant extraction: pure logic out, DOM orchestrator stays). **Deferred to Phase 4** (recorded in
`PROGRESS.md`): move the SSE orchestrator into `net/` and wire `SSE → store.set → notify` at the same
time `render` becomes a subscriber — so the notify path lands with a real consumer, not as a symbol.

## 15. Phase 4 design — the UI layer  _(SKETCHED 2026-08-28 — awaiting go for 4.1a)_

### The problem (measured)
`render()` (`legacy.js:707`, ~110 lines) rebuilds the whole grid as one HTML string from `S` via ~40
helper calls, then `tbody.innerHTML = html`. `refreshCell()`/`refreshDot()` (868–899) do targeted DOM
surgery for performance on a booking patch. There are **36 imperative `render()` call sites**. The
per-cell decision (blocked / booked / mine / unavailable / free → className + title + text + bg + aria)
is **duplicated** between `render()`'s inner branch and `refreshCell()` — the prime bug-risk and the
highest-value extraction target.

### View-layer decision (Q2, resolved on evidence)
Now that the render reality is visible — one big string builder + hand-tuned `patchCells` DOM surgery,
23 `innerHTML` points, ~400 DOM accesses — a component/template library would mean **rewriting all of
it** and taking a runtime dependency (violates §5.6, §1). **Decision: no framework.** Keep the custom
string-building render; add the only reactive bit worth having — a **store subscription** (`render`
subscribes to the store; ~5 lines, custom, zero-dep). Revisit only if the UI grows materially.

### Decomposition (one slice per commit — E8)
- **4.1a — pure cell model (`ui/grid.ts`), first slice.** Extract the duplicated per-cell decision as
  a pure function, injected with its predicates/presentation (E4), unit-tested to 100%; refactor **both**
  `render()` and `refreshCell()` to use it (removes the duplication — a real DRY win). DOM writes stay in
  legacy. Low risk, high value, fully testable.
- **4.1b — pure header/row builders.** KW + weekday header cells, category/group header rows, the
  machine row-header (dot / star / status tag / next-free buttons) as pure string builders. Incremental.
- **4.1c — reactive wiring (the deferred notify path).** Introduce a `render` that subscribes to the
  store; migrate the 36 `render()` call sites to state mutations that notify (likely via a small action
  layer). Move the `connectSSE` orchestrator so `SSE → store.set → notify → render`. This is the large,
  risky step — do it after 4.1a/b have thinned `render`, and keep manual render working until the last
  site flips.
- **4.2** `ui/selection.ts` (the `Sel` rectangle model — `computeSelCells` is already near-pure) +
  `ui/navigation.ts`. **4.3** `ui/views/*` (one screen/modal per commit). Retire the Phase-2 assistant
  `AS_TREE` adapters and the `window.S` bridge as sites migrate to `store`.

  - **4.2a done.** `ui/selection.ts` extracts exactly the pure *geometry* of the `Sel` block:
    `computeSelCells(anchor, focus, visM, visD)` — the inclusive anchor↔focus rectangle over the visible
    grid, in row-major order, empty if a corner isn't visible — and `clampIndex(idx, len)`, the arrow-key
    move/extend clamp (`max(0, min(len-1, idx))`) that legacy applies to both the row and column index.
    Both injected (E4), 100% cov. Everything with a side effect stayed in the legacy adapter: `paintSel`
    (writes `.sel`/`.kfocus`/aria), `cellEl`, the mouse/key listeners, autoscroll, and the **week-growth**
    at the edges (`S.extraWeeks++` + `render()`/`prependWeek()`). That growth interleaves *inside* the
    arrow handler — it mutates `visD` between computing the raw target index and clamping it — so a single
    pure `moveFocus` would not port faithfully (E1); splitting out just the clamp keeps the growth path
    verbatim in legacy while still giving the index math a tested home. Deriving the selection's unique
    mids/sorted dates (used by the book/delete action) is left for the 4.3 action/view layer.

  - **4.2b done.** `ui/navigation.ts` extracts the next-free *scan* behind the ⏭/⏮ per-machine jump
    buttons: `nextFreeDay(fromIso, today, isFree, horizon)` and `prevFreeDay(fromIso, today, isFree)` walk
    the calendar (skipping weekends via `core/dates`) for the first bookable day, forward or backward.
    The one impurity — whether a given day is bookable for *this* machine — is injected as an `isFree`
    predicate (E4); legacy's `nextFreeAfter`/`prevFreeBefore` collapse to one-line wrappers that pass
    `iso => !getBooking(m.id,iso) && !isBlockedM(m,iso) && dayAvailable(m,iso)`, so every caller
    (`gotoNextFree`, `gotoPrevFree`, the `hasBack` flag on the row header) is untouched. The *jump* itself
    — `jumpToSlot` (rebuild the window around the slot, scroll-center, `paintSel`, `toast`) and the
    `nextFreePtr` per-machine pointer bookkeeping — is pure orchestration of side effects and stays in the
    legacy adapter; likewise the week-growth (`prependWeek`, `ensureOverflow`) and the plain week-nav
    buttons (`btnPrev`/`btnNext` are already just `addDays ± 7` + `notify`, nothing to extract). This closes
    the grid-interaction extraction; what remains in `legacy.js` is the DOM adapter (Phase 5) and the modal
    /view builders (Phase 4.3).

  - **4.3 — scope decision (view *models*, not markup).** The original sketch imagined extracting each
    modal's `render*(state) → html` string builder and snapshot-testing it. On contact with the code that
    proved the wrong cut: the modals are ~14 large **interpolated-markup shells** (`openModal(\`…\`)`) whose
    HTML is nearly branch-free — the real logic is the small **pure kernel** each one wraps (run-grouping,
    stats aggregation, booking-conflict detection, log derivation, filter/sort). Porting the markup would be
    high-risk transcription (E1 makes every byte behaviour, so a stray space is a regression) guarded only by
    a tautological "output == the same string" test — low verifiable value, against E7's intent (100% on
    *logic*) and E8 (don't scope-creep into markup churn). So 4.3 extracts the **pure view-model / computation
    kernel** behind each screen (one per commit, under `ui/views/`), injected with its data (E4) and gated to
    100%; the `openModal(html)` shell, the `.map(row => \`…\`)` markup, and all event wiring stay in the legacy
    adapter — exactly as 4.1/4.2 left paint/patch/scroll there. A modal whose kernel is trivial (pure markup,
    no logic — e.g. Help) is left in legacy for the Phase-5 burn-down rather than extracted for its own sake.
    - **my-bookings done.** `ui/views/my-bookings.ts` — `computeMyRuns(machines, bookings, user, today)`
      groups the user's future bookings into consecutive-workday runs (Fri→Mon is one run), date-sorted.
      Legacy's `computeMyRuns()` deleted; its one call site now passes `orderedMachines()/S.data.bookings/
      S.user/todayStr()`. The modal's expand/goto/delete-series wiring stays in legacy. 5 tests, 100% cov.
    - **stats done.** `ui/views/stats.ts` — `computeStats(machines, bookings, from, to)` builds the whole
      aggregation the modal renders (per-machine counts + percent + who booked, a cross-machine person
      index, and a maintenance/downtime tally), fully pure over `core/dates`+`core/machines` (no function
      injection — all four helpers were already gated). Split into two internal aggregators to stay under
      the complexity cap. Legacy `compute()` keeps only the DOM read of the range + `f>o` validation, then
      calls `computeStats`; all mode/drilldown/fold markup + wiring stay in legacy. 7 tests, 100% cov;
      smoke cross-checked 9462 booked cells across 245 machines against a manual count and reconciled the
      person-day totals to the same number.
    - **all-bookings done.** `ui/views/all-bookings.ts` — `computeAllRuns` (per-*person* consecutive-workday
      runs with the earliest creation ts) + `filterAllRuns` (the list's person/machine/group/date-window
      filter, five sort keys with a `termin` fallback, capped at 300). Legacy `computeAllRuns()` deleted and
      the `sorters`+filter chain in `renderList` replaced by the bridged calls (raw input values in; trim/
      lowercase inside). The go-to wiring + row markup stay in legacy. 9 tests, 100% cov (comparator
      tie-breakers and empty group/name/ts fallbacks explicitly covered).
    - **admin done.** `ui/views/admin.ts` — `filterAdminMachines(machines, sort, query)`: the Verwalten
      list's order (manual = stored order, or by name / group→name) + "name group" substring search. The
      reorder/edit/add wiring, the status/maintenance badges and row markup stay in legacy. 6 tests, 100%.
    - **machine-text done.** `ui/machine-text.ts` — the pure German presentation formatters shared by the
      row headers, admin badges and machine form: `maintText(slot)`, `statusRangeText(m, today=todayStr())`
      (clock injected with a default so legacy `statusRangeText(m)` is unchanged — E4/E6), `daysMaskText(m)`.
      Not under `views/` because they're cross-view. Legacy defs deleted; `blockText` calls bridged
      `maintText`; legacy `WD_SHORT` kept only for the machine-form checkboxes. 11 tests, 100%.
    - **Deferred (kernel too thin to extract now — left for the Phase-5 burn-down):** Log (`openLog` is a
      branch-free `log.slice(0,200).map(...)`), Help/Settings (near-static markup), booking-detail (display).
    - **Booking write-path (`submitBooking`) — noted, not yet cut.** Its conflict-detection + apply reducer
      is real domain logic but it *mutates fresh server state and POSTs*, so it belongs in a `core/booking`
      slice (Phase 5/6 territory) and can't be browser-smoked without a production write. Gate-only when done.

### The `ui/` gate layer
New layer: **ui/ may import core/ + net/ + state; nothing may import ui/** (add the eslint boundary).
Pure model builders are held to the 90/85 floor; DOM writes are browser-smoked (E5). ui/ may touch the
DOM (unlike core/), but keep the *pure* model logic in DOM-free functions so it stays unit-testable.

### Faithful-port constraints (E1/E2) — must preserve, do NOT "fix"
- `refreshCell` rebuilds `className` from scratch (dropping `sel`/`kfocus`), then `patchCells` calls
  `paintSel()` (now `paintSelection()`, `ui/grid-interaction.ts`) to restore them. Keep that ordering.

### Fixed post-migration (was a faithful-port constraint above, now resolved)
- `render()` added a `wknd` class to weekend cells; `refreshCell()` didn't — so a booking patch on a
  weekend column lost its `wknd` styling until the next full render. Conserved verbatim through the
  whole Phase 7 extraction (E1) since fixing behavior mid-port isn't extraction; **fixed** once the
  migration itself was done and the code was safe to actually change — `ui/cell-patch.ts`'s
  `refreshCell` now computes `weekend` the same way `GridBody.tsx` does (`isWeekend(parseIsoDateString(date))`)
  and passes it to `cellClass` on every branch. See `PROGRESS.md`'s Known Bugs (moved to Fixed).

### Action-layer question — RESOLVED (see §16)
Resolved the same way in both places it was asked: no new `actions.ts` layer. `ui/mutate.ts`
ported legacy's own `mutate` orchestrator faithfully — it already wraps the reducer +
persistence + notify shape this question was asking whether to build. (This question was
originally posed twice, once here and once in §16 below; both are the same resolution.)

## 16. Phase 5 design — write-path reducers + burn-down

### 5.1 — `core/booking.ts` (the write-path reducers) — IMPLEMENTED 2026-08-29
Every `mutate(fresh => …)` callback body — the domain logic of a write — is now an exported pure/mutating
reducer in `core/booking.ts`, mirroring the exact `{abort}` / `{conflicts}` / `{count,undo}` / `{n,undo}`
shapes the legacy callbacks returned. Eight functions, one per write path:
- `bookCells(fresh, mids, dates, opts)` — the `submitBooking` conflict-check + apply. The two impurities
  are **injected** (E4): `ts` (the wall-clock stamp) and `newGid` (the group-id factory, called only when
  the action forms a group). Internally split into `findConflicts` + `applyBooking` (+ `writeMachineCells`)
  to stay under the complexity cap. Returns `{abort:true, conflicts}` (nothing written) or `{count, undo}`.
- The four **delete** reducers — kept distinct because their selection predicates differ and each
  difference is behaviour (E1): `deleteCells` (booking-detail run, **exact** stored-name match),
  `deleteOwnCells` (my-bookings, **case-insensitive** user match), `deleteSelectedCells` (marquee context
  menu, an explicit cell list, **no** name check), `deleteGroup` (by `gid` across **all** machines). Each
  ends by calling `sweepWeekends` on the affected machine(s), so every `sweepWeekends` caller now lives in
  core (the legacy adapter no longer sweeps directly).
- The three **machine-CRUD** reducers: `saveMachine` (edit-or-create; the German slug/transliteration and
  same-group insertion index moved in with it), `deleteMachine`, `moveMachine` (same-group neighbour swap).

The legacy call sites are now one-liners: `mutate(fresh => bookCells(fresh, …), logAction)` etc. The DOM
around them — reading the form, `openModal`, `askConfirm`, `offerUndo`, `patchCells`/`notify`, the
conflict-box re-open — stays in the legacy adapter (E3). `shared/types.ts` grew the fields the write-path
actually writes: `Booking.note/gid/gtitle`, `Machine.redu`.

**Verification (E5) — gate-only + a clone smoke, NO production write.** These reducers POST to
`/api/mutate`, so they cannot be browser-smoked against the live backend without mutating real data. They
are proven two ways: (1) exhaustive unit tests to **100% branch** (43 tests in `booking.test.ts`); (2) a
browser cross-check that ran every bridged reducer against a `structuredClone` of the **live** `S.data`
(245 machines) — `deleteGroup` removed exactly the 10 cells carrying a real gid, `saveMachine` create
produced the right slug and same-group index, `moveMachine` swapped a real adjacent pair, cross-group and
unknown-id aborted — with `window.S.data` left untouched and the server `rev` unmoved (23) throughout.

### 5.2 — burn-down (FS-era dead code) — IMPLEMENTED 2026-08-29
Deleted the file-backed-variant corpse (§14 D4), all confirmed zero-caller before cutting:
- `writeFile()` (+ its `S.handle.createWritable`/`S.lastRaw`/`lastMtime` uses) — the FS-Access-API writer,
  never invoked in server mode (persistence goes through `apiPost('/api/mutate')` in `persist()`).
- `setupFileObserver()` and `startRefreshTimer()` — empty FS-era stubs; the `setupFileObserver()` call in
  `startUI()` was dropped with them (server pushes via SSE, no polling).
- The dead `lastRaw` field — removed from `AppState` (`shared/types.ts`), `hydrateState()` (`app.ts`), and
  the `state.test.ts` fixture. It was only ever written, never read.

`legacy.js` 2712 (1.2) → **2362**. `knip` reports no dead code in the gated layers (it does not analyse
`legacy.js`, so that burn-down stays manual). Gate green; app boots identically (245 machines / 266 rows),
console clean, `rev` 23.

**Deferred (with rationale, not skipped):**
- **Trivial modal markup** (Log/Help/Settings/booking-detail) — branch-free `innerHTML`; folding into
  `openModal` templating moves strings without removing logic (low value, E8). Revisit only if a real
  templating need appears.
- **`AS_TREE` adapters + `window.S` shrink** — retiring the Phase-2 assistant bind-adapters means moving the
  Assistant tree into the store: a real state migration, not a burn-down. Deferred to the store-migration
  slice / Phase 6, where it has a clean seam.

### 5.3 — tooling — IMPLEMENTED 2026-08-29
- **`knip` promoted into `verify`.** `verify` is now `format:check && check && lint && deadcode && test:cov`
  (knip placed after lint — a cheap structural check that fails fast before the slower coverage run). Config
  tidied to zero findings: dropped the stale `web/js/legacy.ts` ignore and the not-yet-existing
  `server/*.ts` entries (Phase 6 re-adds them), scoped `project` to `{web,shared}/**/*.ts`, and set
  `ignoreExportsUsedInFile` (so a module's own public types — e.g. the store's `Store` — aren't flagged).
  knip auto-detects `web/js/app.ts` as the entry via its Vite/index.html plugin, so no explicit `entry` is
  needed. Dead code now fails the gate.
- **Repo-wide coverage floor** added to `vitest.config.ts` (top-level `lines: 90, branches: 85`) as a safety
  net beneath the explicit per-layer globs, so a new top-level module (e.g. a future `actions.ts`) can't slip
  in untested. Project standard stays 100% in practice.
- **CSS/HTML tidy — deferred (E8).** No dead-CSS need was identified and a restyle risks silent visual drift
  against the faithful-port bar; revisit only with a concrete trigger.

**Phase 5 is complete** (5.1 write-path reducers, 5.2 FS-era burn-down, 5.3 tooling). Remaining
legacy-shrink items (modal markup, `AS_TREE`/`window.S`) are deferred with rationale above and travel with
the Phase-6 backend work / a later store-migration slice.

### Action-layer question — RESOLVED (2026-09 update)
`bookCells` and friends had a caller shape that would suit a thin `actions.ts` (`book`/`del`/… →
reducer + `store.set` + persistence + `notify`). Resolution: no new layer. Phase 7 ported
legacy's own `mutate` orchestrator to `ui/mutate.ts`, faithfully — it already wraps the
reducer + persistence + optimistic-patch shape this question asked whether to build, so a
separate `actions.ts` would have duplicated it. See `PROGRESS.md`'s "Carry forward" note.

## 17. Phase 6 design — backend → TypeScript

### 6.1 / 6.2 — conversion + gate + build — IMPLEMENTED 2026-08-29
The zero-dependency backend (`src/*.mjs`, ~350 lines) was ported to gated TypeScript under `server/`,
decomposed so the domain logic is pure and unit-testable while the impure I/O stays in a thin entry shell:
- `server/db.ts` — schema, `openDb`, meta helpers (`getMeta`/`setMeta`/`bumpRev`), `importFromJson` (split
  into `seedMachines`/`seedBookings` for the complexity cap). **`node:sqlite` is loaded via `createRequire`**,
  not a static `import` — it's too new for Vite's builtin list, so a static import breaks the Vitest loader
  (and would need bundler special-casing); `createRequire('node:sqlite')` sidesteps that in both the tests
  and the compiled build, with the type still coming from `@types/node` (erased, zero runtime cost).
- `server/model.ts` — the read model (`isBlocked`, `machineOut`, `bookingOut`, `getState`); pure over the db.
- `server/mutate.ts` — the single write path (`applyMutate`), split into the structural and cell-delta
  reducers plus per-machine/per-cell helpers. **The SSE `broadcast` is injected (E4)**, defaulting to a noop,
  so the whole write path is unit-testable with an in-memory DB and no live server.
- `server/server.ts` (HTTP/SSE/backup/seed) and `server/import.ts` (seed CLI) — the impure entry shells,
  run-verified (E5), coverage-excluded like `app.ts`. `server/types.ts` is type-only.

**Testing (E5/E6).** 31 backend tests run against `openDb(':memory:')` — deterministic, no production
contact: the read model, both mutate paths (book/delete, foreign+blocked conflicts, compare-and-set delete,
the 1000-cell cap, the validation errors, orphan cleanup, group/ts handling) and even the rollback/error
paths (by pointing the reducer at a deliberately broken DB). Backend coverage 99.4% lines / 90.9% branches —
above the 90/85 floor; the only uncovered branches are the defensive "rollback itself failed" inner catches.

**Build (zero runtime deps kept).** `tsconfig.server.json` compiles `server/*.ts` → `dist/server/*.js` with
`tsc` (NodeNext, `.js` import specifiers so the emit runs natively on Node). The Docker build stage now runs
both `npm run build` (vite → `dist/public`) and `npm run build:server` (tsc → `dist/server`); the runtime
stage ships the compiled server at `/app/server` (so its `../public` / `../buchungen.json` paths resolve
exactly as `src/*.mjs` did) and runs `node server/server.js`. No new runtime dependency — only Node built-ins.
`src/` was deleted; the eslint/knip/tsconfig gate exclusions for it were removed (the backend now faces the
full gate: prettier, tsc, eslint with the 60-line/complexity-12 budgets, knip, and coverage).

**Validation without touching production.** The whole flow was proven on a throwaway image
(`maschinenplan:phase6-test`) run on an isolated port + fresh volume: `/api/health`, `/api/state` (real
seeded data), the static frontend (200), and a real booking through `POST /api/mutate` (`rev` 0→1, read
back) — then torn down. The production `maschinenplan` container and its `data` volume were never touched.

### 6.3 — server-authoritative weekend auto-bridging — IMPLEMENTED 2026-08-29
`server/bridge.ts` is the mirror of `core/weekend.ts`'s sweep — the ADD direction:
- **`missingBridges(bookings)`** (pure, tested) — a faithful recovery of the baseline `missingWeekendBridges`:
  for every booked Friday whose Monday is also booked (any person), the empty Saturday/Sunday between them is
  returned, carrying the **Friday's** name.
- **`maintainBridges(db, mids, ts)`** — runs inside the mutate transaction; `INSERT … ON CONFLICT DO NOTHING`
  so it never overwrites a real cell. Wired into `applyCells`: after the client's writes, it bridges the
  affected machines and **appends the bridges to the broadcast `changes`** (so every client patches them in via
  SSE), while `applied` stays the client-requested count. Gated by the `WEEKEND_BRIDGE` env (on unless `off`),
  threaded through `applyMutate(db, body, broadcast, bridge)`. Only the cell path bridges (structural doesn't).
- **`backfillBridges(db)`** — one-time whole-DB pass in a single transaction (internal SQL, **not** subject to
  the 1000-cell API cap that made the old client migration fail with HTTP 400). Exposed as the `server/backfill.ts`
  CLI (`npm run backfill`).

10 tests (pure computation incl. only-fills-missing / non-Friday / no-Monday; in-DB maintain incl.
never-overwrite; whole-DB backfill incl. idempotence). Validated on the compiled image: a Fri+Mon booking
auto-bridged Sat/Sun with the Friday's name; the backfill CLI inserted 1782 legacy bridges — all on a throwaway
temp DB. **The live backfill and the deploy that enables the maintain hook are production actions and were NOT
performed — they await explicit authorization** (a daily VACUUM backup exists; the client sweep removes bridges
again if a series later breaks, so both directions are reversible).

## 18. Phase 7 — view layer → React (guardrail change, DECIDED 2026-08-30)

### The decision
§14 and §15 each evaluated adopting a framework for the view layer and declined, on the
measured evidence at the time (a large `innerHTML`-string renderer + hand-tuned DOM patches,
where a rewrite would mean touching effectively all of it while also breaking §5 rule 6's
zero-runtime-dependency invariant). That evidence hasn't changed — this is not a correction
of §14/§15's analysis. What changed is the standing decision to build the reworked frontend
in React going forward, made explicitly by the project owner. §14/§15 are superseded by this
section for any future view-layer question; their measurements remain useful history.

### The guardrail change
`ARCHITECTURE §5` rule 6 and `CLAUDE.md`'s "Do not add runtime dependencies" guardrail are
both narrowed to **backend only**. The frontend's runtime now includes exactly two
dependencies: `react` and `react-dom`. No other runtime dependency, on either side, without
another explicit, reasoned change like this one — the zero-dependency discipline still
applies everywhere it hasn't been deliberately lifted.

### Scope and approach
Phase 7 replaces `legacy.js`'s DOM/render layer with React components, **reusing every
`core/`/`net/`/`state.ts`/`ui/*` module completely unchanged** — this is a view-layer swap,
not a rewrite of the already-tested domain logic. `legacy.js` is deleted whole once every
screen has a React equivalent (mirrors the strangler pattern §14/E3 already established:
bridge new code in, thin adapter for anything still coupled, delete the old code only once
nothing depends on it). The full per-slice backlog (B0–B10), each slice's grounded
must-haves, and the rationale for every naming/structure decision live in
**`PHASE7-PLAN.md`** (project root) — the living companion doc to this section, updated as
each slice lands, the same way `PROGRESS.md` tracks Phases 0–6.

### Testing
React Testing Library + jsdom, queried by role/text/label as a user would — not by class
name or implementation detail. `vitest.config.ts`'s existing per-file `jsdom` opt-in
(`// @vitest-environment jsdom`) is used as-is; pure-logic tests stay on the `node`
environment they already run in.

## 19. Phase 14 — Tailwind CSS + shadcn/ui-pattern components (guardrail change, DECIDED
2026-09-04; revised direction same day)

### The decision (as first made)
The project owner wanted the frontend to move toward component-library-based UI going
forward, on the same "own the code" model shadcn/ui popularized (Tailwind CSS for styling;
components are copied into the repo and can be freely edited, not pulled in as an opaque
npm dependency). Piloted on one screen first — the Booking Assistant
(`web/js/ui/components/Assistant{Modal,Tree,Checklist,Results}.tsx`) — not a full
replatform; `web/css/app.css` stays in place and is retired incrementally, primitive-class
first (buttons → inputs → dropdowns → cards → modals → …), never in one big-bang rewrite,
consistent with §1's refactor-not-reimagine stance and the running "conserve every
behavior" discipline. The pilot's first two slices used hand-rolled `Button`/`Input`
primitives styled directly against app.css's own (Tailwind-exposed) tokens, and hit one real
production regression along the way — Tailwind's Preflight base reset, imported by default,
turned out to affect every button app-wide, not just the ones this migration touched (found
via user report, fixed by importing only the `theme`/`utilities` layers instead of the plain
`'tailwindcss'` import; see the Known Bugs → Fixed entry in `PROGRESS.md`'s Phase 14 section
for the full story — that lesson, "a Tailwind-styled primitive should never depend on a
global reset," carried forward into everything below).

### The decision (revised, same day)
Running `shadcn@latest init --preset b6EWdD0CK8` (a tweakcn theme) on a fork branch, to
evaluate a real externally-designed shadcn setup, pulled in far more than a color theme:
**Base UI** (`@base-ui/react`) as the primitive-component library — not Radix — **Tabler**
icons, self-hosted **Inter**/**Manrope** variable fonts, and a full olive-palette shadcn
semantic token set. **Decided to adopt this in full**, superseding the narrower plan above:
Base UI is now the primitive library (Radix was never actually adopted — the "deliberately
not added yet" note below is now moot, not deferred), Tabler replaced the hand-rolled
`Icon.tsx` sprite system, Inter/Manrope apply app-wide, and the preset's `:root`/`.dark`
tokens are canonical for anything built against the new components. `web/css/app.css`'s own
role is unchanged in kind — it still styles everything not yet migrated — but its own design
tokens were renamed (`--app-bg`, `--app-panel`, `--app-border`, `--app-text`, `--app-muted`,
`--app-accent`, …) specifically because the preset defines semantic tokens of the same bare
names (`--border`/`--muted`/`--accent`/…) for a different palette; without the rename, every
one of app.css's ~150 uses of those names would have silently repainted with the preset's
colors instead of its own the moment the preset's tokens landed in the same stylesheet.

### The guardrail change (final)
§18 narrowed the zero-runtime-dependency rule to backend-only and named exactly two
frontend exceptions: `react`/`react-dom`. This section adds the full set the adopted preset
actually needs: `@base-ui/react` (primitive components — headless, accessible, this
migration's real interactive-widget library, filling the role §18/the original Phase 14
plan had reserved for Radix), `@tabler/icons-react` (icons, replacing the SVG-sprite
`Icon.tsx` internals), `class-variance-authority`/`clsx`/`cn` (style-composition
utilities — `cn` supersedes the hand-written `clsx`+`tailwind-merge` combination the pilot
started with, since shadcn-generated files import it directly), `@fontsource-variable/inter`
and `@fontsource-variable/manrope` (self-hosted variable fonts — static font-file assets,
zero JS shipped). `tailwindcss`/`@tailwindcss/vite`, `shadcn` (its npm package is referenced
only via a build-time CSS `@import` — confirmed by inspecting its contents: animation
keyframes and `data-*` custom variants, no JS, no reset of its own), and `tw-animate-css`
are **not** a guardrail change: build-time-only, ship no JS to the browser, already allowed
under `ARCHITECTURE §5` rule 6 ("dev tooling is fine").

### Scope and approach
**2026-09-05 — Assistant range-picker extension (user-requested).** Add
`react-day-picker` 10.0.1 as a frontend runtime dependency, including its locked date-fns
dependencies. This is the calendar engine used by shadcn's documented Calendar + Popover
composition; Base UI already supplies Popover but no equivalent calendar in our installed
component set. Reusing its range/keyboard/calendar semantics is safer and smaller in owned
code than building date arithmetic and an accessible calendar from scratch. The backend
remains zero-dependency. `components/ui/calendar.tsx` adapts DayPicker, and
`date-range-picker.tsx` owns ephemeral range drafts; the Assistant receives ISO endpoints
together only after application. Explicit UTC handling matches `shared/dates.ts` and
prevents local-time/DST date shifts. Typed endpoints adjust the opposite endpoint when
crossed; cleared endpoints still fail the existing search validation.

Shared palette values now live in `web/css/theme.css` (imported by app.css). Shadcn primary
tokens reference the existing blue accent; dark semantic tokens now use `html[data-theme]`
as well. See `docs/UI-DESIGN.md` and the tracked `docs/ASSISTANT-UX-PLAN.md`. The date popup
is portaled within its owning field; the modal lets an open nested popover consume Escape
before closing itself. Button/Input forward refs to support Base UI composition on React 18.

New Base UI/shadcn-pattern components live under `web/js/components/ui/` (the CLI's own
convention — a different tree than the hand-rolled `web/js/ui/components/ui/` the pilot
started with, which was deleted once its two components were reconciled against the real
ones). A path alias (`@/*` → `web/js/*`) was added to `tsconfig.json`/`vite.config.ts`
specifically because the shadcn CLI requires one to run at all — the original pilot's "no
alias" call is superseded for anything under `components/ui/`; every other file keeps the
repo's existing relative-import convention. Dark mode still keys off the app's own
`html[data-theme="dark"]` attribute (`web/js/ui/theme.ts`), via a `@custom-variant dark` —
not the preset's own default class-based (`.dark`) mechanism, which was never wired to
anything and doesn't fire.

**No Preflight, still.** `web/css/tailwind.css` imports only the `theme`/`utilities` layers
(the fix from the initial pilot slice, kept through the pivot) — confirmed the `shadcn`
package's own bundled CSS doesn't reintroduce a reset either. One *does* remain: the
preset's own `@layer base { * { border-color } body { bg/text } }` convention. Kept, because
CSS Cascade Layers give **unlayered** styles (app.css, a plain stylesheet) priority over
**any** layered style regardless of selector specificity or source order — confirmed
empirically (`getComputedStyle`, not assumed) that `body`'s actual background/text still
resolve to app.css's own `--app-bg`/`--app-text`, not the preset's, and that the toolbar
(plain HTML, untouched by any of this) still measures pixel-identical to the pre-Phase-14
baseline (`ef7d334`: 29px/78px). One thing this section does **not** claim fixed: an
automated-screenshot check found the Assistant's card backgrounds rendering light in dark
mode despite `getComputedStyle`/`elementsFromPoint` both reporting the correct dark color
with nothing painted over it (reproduced in both Playwright's headless Chromium and a real
installed Chrome) — strong evidence of a software-rendering (no-GPU/SwiftShader) screenshot
artifact specific to the sandboxed verification environment rather than a real bug, but not
100% confirmed; flagged in `PROGRESS.md`'s Known Bugs → Open for a real-browser spot-check
rather than either declared fixed or chased indefinitely on unresolved automated evidence.

Full slice-by-slice backlog and rationale: `PROGRESS.md`'s Phase 14 section.

### Supplied assistant integration (2026-09-06)

The user's replacement TSX/README supersedes the earlier Assistant presentation. Its
sections are split under `ui/components/booking-assistant/` to retain the existing
function/file budgets without changing its markup or interaction model. The host
`AssistantModal` injects catalog/search/book/calendar/close callbacks. No demo machines,
random scheduling, additional backend endpoint, or alternative write path is used.

The expressly requested frontend dependencies are dnd-kit (core/utilities; sortable was
dropped once the plan list stopped re-ordering itself mid-drag, see below),
lucide-react, direct date-fns, and the locally served JetBrains Mono font. These preserve
the supplied gestures, iconography and date/number typography. Base UI remains the single
primitive library; small adapters translate the supplied shadcn composition API.
The backend remains zero-dependency. This is the reasoned frontend guardrail extension.

`booking-assistant.css` scopes the supplied green/orange light/dark palette and reset to
the dialog and its portals. Explicit CSS layer ordering keeps the local reset below
utilities; `revert-layer` isolates legacy unlayered element rules. Other screens retain
their theme. Narrow panes allow the footer blocks to wrap. The dialog caps itself at the
window height and its middle section is `flex: 1 1 506px`: the supplied 506px is what it
takes whenever the window allows, and it gives way before the footer does, so the date
range, the day fields and the actions are always reachable without scrolling. Nothing
outside the dialog scrolls; the catalog and plan panels scroll inside themselves.

**Plan drag model.** The list never re-orders itself mid-drag: the grabbed card's slot stays
put as a faded placeholder, no other card moves, and the outcome is shown by two overlays —
a green line in the gap the card would land in, or a ring around the card it would group
with. Jumping is therefore structurally impossible rather than merely tuned away. That is
why `@dnd-kit/sortable` is gone: shuffling cards during the drag is precisely its job.

**The plan is a tree.** A requirement group's members are plan entries, so a member may be a
group in turn — "either the big press, or both small ones", which a flat device list cannot
say. Every entry, at any depth, carries its own id and is therefore draggable and droppable
in its own right; there is no separate "member" concept and `PlanCard` renders its members
through itself. The solver follows the same shape: `chooseAt` takes a group's `requiredCount`
longest-lived members, each member resolved the same way. Greedy is exact because members'
device sets are disjoint (`validatePlan`), so maximising each member's own run maximises the
group's minimum.

Two rules carry the model. **Targets rank, they never compete** (`planTargeting.ts`): a card
is the only drop target on its own height, and grouping vs. inserting before/after is
decided by the pointer's height within it, never by a second droppable. Cards tile their own
level without gaps — each carries its own `pb-2` instead of the list carrying a `gap` — so
the pointer always hits exactly one per level; across levels a nested group necessarily lies
inside its parent, and there the innermost (smallest) hit wins. Only when no card is hit does the list area catch the
drag, which is what makes the space below the last card a real target: releasing a device
there lifts it out of its Bedarfsgruppe onto the end of the list without having to hit a
gap, and it is the only way out when the group is the sole card. That fallback overlaps the
cards but cannot rival them, because it is consulted only after they miss — the order in the
collision function is the whole ranking. Earlier a merge zone overlapped each card's middle
half and the list competed on equal footing, so `over` flipped several times per card of
travel; while `SortableContext` was still in play each flip fed `items.indexOf(over.id) ===
-1` into `verticalListSortingStrategy`, which shoved every card above the dragged one down
by a full card height. **One reading of a drop** (`planDrop` in `model.ts`): the same function answers
both the preview during the drag and the mutation on release, so the marker cannot promise
something the drop does not do. Its insertion index counts the gaps of the list *including*
the dragged card — exactly where the line sits — and dropping into either gap touching the
card's own slot is a no-op that shows no marker. Dropping onto a card merges: two device
cards become a Bedarfsgruppe, a card dropped onto an existing group joins it keeping the
group's required count, and a *group* dropped onto a group becomes its member rather than
dissolving into it — that one rule is where nesting comes from. Nothing can be dropped into
itself or into one of its own members (`entryContains`), which is what keeps the tree a tree.

The supplied inclusive duration represents calendar days. `core/booking-assistant-search`
computes deterministic maximal windows with the same resolved machines available on
every day (bookings, maintenance and machine weekday masks included). Excluded/off days
break a window; no workday skipping or claims about holidays are introduced. Windows
stay within the requested date range; unchecked future availability is never called open.
Local Date objects cross into the existing ISO contract through their calendar components,
then the established UTC date utilities enumerate exact reservation dates. Booking
rechecks the latest store snapshot and enters the existing confirmation/mutation flow,
including its read-only, conflict and batch-size checks. Server weekend bridging is unchanged.
