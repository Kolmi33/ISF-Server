# CLAUDE.md — operating manual for this repo

Maschinenplan booking tool. Zero-dependency Node + `node:sqlite` backend, TypeScript
frontend (Vite). Being reworked top-down, module by module, **conserving every behavior**.

**Resuming, or after any context clear: read `PROGRESS.md` first** — it holds the current
phase, the backlog, and step-by-step how to continue. Then this file (how we operate) and
`PRINCIPLES.md` (the coding standard). `ARCHITECTURE.md` = design & decisions; `FEATURES.md`
= behavioral acceptance checklist.

## Golden rule

**Nothing is "done" until `npm run verify` is green in the dev container AND the step is
committed.** `verify`'s exit code is the single source of truth for whether the coding
principles hold. Do not weaken a gate to make it pass — fix the code, or escalate.

## Environment

Node lives ONLY in the dev container (the Windows host has no Node). Run everything through:

```bash
docker compose -f docker-compose.dev.yml run --rm dev npm run verify   # the gate
docker compose -f docker-compose.dev.yml run --rm dev npm test          # tests
docker compose -f docker-compose.dev.yml run --rm dev npm run check      # types
docker compose -f docker-compose.dev.yml run --rm --service-ports dev npm run dev  # Vite @ :5173
```

Production is separate: `docker compose up -d --build` (see START.md).

## Versioning & rollback

Every step is one small commit on a linear history; the pre-commit hook keeps `HEAD` green, so
each commit is a known-good save point. The repo is **local only** (no remote yet). To roll back:

- Discard uncommitted edits: `git restore .`
- Undo the last commit, keep edits: `git reset --soft HEAD~1`
- Discard the last commit entirely: `git reset --hard HEAD~1`
- Return to a known-good step: `git reset --hard <hash>`
- Return to the original app: `git reset --hard 789bfec` (the untouched baseline)
- Recover from a mistaken reset: `git reflog` (every HEAD move is logged)

Local workflow uses `reset`; if a shared remote is ever added, prefer `git revert` instead.

## How we work: the per-module loop

Unit of work = one module extraction. Each is ONE commit:

1. Read the target functions in the monolith (`public/index.html`, later `web/js/app.ts`).
2. Write the test for the new module's intended behavior (red). The existing code's
   behavior is the spec.
3. Implement the module until green.
4. Rewire the app to import it; delete the old copies.
5. `npm run verify` green + quick browser smoke of the touched behavior.
6. Commit (Conventional-style subject; end with the Co-Authored-By trailer).

Work the backlog in `PROGRESS.md` top to bottom. Update it as items land.

This per-module workflow is `PRINCIPLES.md`'s implementation loop
(Understand → Plan → Explain → Define behavior → Implement → Test → Review → Clean up)
applied to one module.

## Loop / autonomy

Cadence is **per-phase**: within a phase, run the backlog autonomously — extract, `verify`,
commit each module without pausing — then HALT with a summary at the phase boundary for review.
Also HALT immediately when: the same item fails `verify` twice (escalate, don't thrash), or the
run's budget is hit. Keep scope to one module per iteration; rely on `verify`'s exit code (not
re-reading the tree) to know you're done.

## Enforcement & the legacy quarantine

`verify` is enforced by a git `pre-commit` hook (`.githooks/pre-commit`, runs the dockerized
gate). Enable once per clone: `git config core.hooksPath .githooks`. Never bypass with
`--no-verify`.

The un-extracted monolith lives in **`web/public/legacy.js`** — a **classic** (non-module) script,
loaded via `<script src="/legacy.js">`, so its ~130 functions stay global and the 125 inline
`onclick=` handlers keep working with zero changes. It is **gate-excluded** (ESLint/Prettier/tsc),
a shrinking quarantine that must reach zero by Phase 5. All NEW modules face the full gate. Each
extraction moves code OUT of `legacy.js` into a gated ES module.

## Principles

Full standard: **`PRINCIPLES.md`** (P0–P6). Conflict order:
**Correctness/Security → Maintainability → Simplicity → Testability → Performance → Aesthetics.**

Project-specific rules (full list `ARCHITECTURE.md §5`) — the ones that bite daily:
- Conserve behavior (baseline commit `789bfec` is the reference).
- Pure `core/` has no DOM. · One authoritative server write path; never trust the client.
- State changes go through the store. · Backend runtime stays zero-dependency; the
  frontend's only runtime dependency is `react`/`react-dom` (Phase 7, ARCHITECTURE §18).

## Guardrails

- Do not add backend runtime dependencies — dev dependencies only there. The frontend's
  only runtime dependencies are `react`/`react-dom`, adopted deliberately in Phase 7
  (rationale: ARCHITECTURE §18). No other runtime dependency, either side, without an
  explicit, reasoned guardrail change like that one.
- Do not edit the untouched baseline behavior without a test that pins the change.
- If a gate is wrong, change the gate deliberately (with reasoning in the commit), never
  bypass it with `--no-verify` or inline disables.
