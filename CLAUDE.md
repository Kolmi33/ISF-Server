# CLAUDE.md — operating manual for this repo

Maschinenplan booking tool. Zero-dependency Node + `node:sqlite` backend, TypeScript
frontend (Vite). Being reworked top-down, module by module, **conserving every behavior**.

Read `ARCHITECTURE.md` (principles, layout, phases, quality gates) and `FEATURES.md`
(behavioral acceptance checklist) before making changes.

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

## How we work: the per-module loop

Unit of work = one module extraction. Each is ONE commit:

1. Read the target functions in the monolith (`public/index.html`, later `web/js/app.ts`).
2. Write the test for the new module's intended behavior (red). The existing code's
   behavior is the spec.
3. Implement the module until green.
4. Rewire the app to import it; delete the old copies.
5. `npm run verify` green + quick browser smoke of the touched behavior.
6. Commit (Conventional-style subject; end with the Co-Authored-By trailer).

Work the backlog in `ARCHITECTURE.md` §13 top to bottom. Update it as items land.

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

The un-extracted monolith lives in `web/js/legacy.ts` — **gate-excluded** (ESLint size/complexity/
`any` + coverage), a shrinking quarantine that must reach zero by Phase 5. All NEW modules face
the full gate. Each extraction moves code OUT of `legacy.ts` into a gated module.

## Principles (full list in ARCHITECTURE.md §5)

- Pure `core/` has no DOM. · One authoritative server write path; never trust the client.
- State changes go through the store. · Conserve behavior (baseline commit `789bfec`).
- Small reversible commits. · Types are the contract. · Runtime stays zero-dependency.

## Guardrails

- Do not add runtime dependencies. Dev dependencies only.
- Do not edit the untouched baseline behavior without a test that pins the change.
- If a gate is wrong, change the gate deliberately (with reasoning in the commit), never
  bypass it with `--no-verify` or inline disables.
