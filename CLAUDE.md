# CLAUDE.md — operating manual for this repo

Maschinenplan booking tool. Zero-dependency Node + `node:sqlite` backend, TypeScript
frontend (React, Vite) — fully gated end to end as of Phase 7 (the frontend's legacy
monolith, `web/public/legacy.js`, was retired module by module and finally deleted whole;
see `PHASE7-PLAN.md` for the slice-by-slice history). Further changes still follow the same
per-module loop below, **conserving every behavior**.

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

Unit of work = one module (new feature, or a change to an existing one). Each is ONE commit:

1. Understand the target behavior — for a change, the current code IS the spec; conserve it
   unless the change deliberately alters it.
2. Write the test for the intended behavior (red).
3. Implement the module until green.
4. Wire it in (rewire callers, delete superseded code).
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

## Enforcement

`verify` is enforced by a git `pre-commit` hook (`.githooks/pre-commit`, runs the dockerized
gate). Enable once per clone: `git config core.hooksPath .githooks`. Never bypass with
`--no-verify`.

There is no gate-excluded legacy quarantine anymore — `web/public/legacy.js` (the original
non-module monolith, its ~130 functions kept global for the 125 inline `onclick=` handlers)
was extracted module by module through Phase 7 and deleted whole once nothing referenced it.
Every file under `web/`, `server/`, and `shared/` now faces the full gate (ESLint/Prettier/tsc).

## Principles

Full standard: **`PRINCIPLES.md`** (P0–P6). Conflict order:
**Correctness/Security → Maintainability → Simplicity → Testability → Performance → Aesthetics.**

Project-specific rules (full list `ARCHITECTURE.md §5`) — the ones that bite daily:
- Conserve behavior (baseline commit `789bfec` is the reference).
- Pure `core/` has no DOM. · One authoritative server write path; never trust the client.
- State changes go through the store. · Backend runtime stays zero-dependency; the
  frontend's runtime dependencies are `react`/`react-dom` (Phase 7, ARCHITECTURE §18) plus
  `@base-ui/react`/`@tabler/icons-react`/`class-variance-authority`/`clsx`/`cn`/
  `@fontsource-variable/inter`/`@fontsource-variable/manrope` (Phase 14, revised direction —
  the adopted shadcn preset, ARCHITECTURE §19).

## Guardrails

- Do not add backend runtime dependencies — dev dependencies only there. The frontend's
  runtime dependencies are `react`/`react-dom` (Phase 7, ARCHITECTURE §18) and the shadcn
  preset's own set — `@base-ui/react` (the primitive-component library, filling the role
  originally reserved for Radix), `@tabler/icons-react`, `class-variance-authority`/`clsx`/
  `cn`, `@fontsource-variable/inter`/`@fontsource-variable/manrope` (Phase 14, ARCHITECTURE
  §19) — `tailwindcss`/`@tailwindcss/vite`/`shadcn`/`tw-animate-css` are build-time-only
  devDependencies or CSS-only imports, not a guardrail exception. No other runtime
  dependency, either side, without an explicit, reasoned guardrail change like those.
  The user-requested range calendar adds `react-day-picker` (and its locked date-fns
  dependencies) on the frontend only; rationale and boundaries are in ARCHITECTURE §19.
  The user-supplied replacement Assistant additionally authorizes dnd-kit, lucide-react,
  direct date-fns and JetBrains Mono on the frontend; see ARCHITECTURE §19's supplied
  assistant integration decision. The backend still has no runtime dependencies.
- Do not edit the untouched baseline behavior without a test that pins the change.
- If a gate is wrong, change the gate deliberately (with reasoning in the commit), never
  bypass it with `--no-verify` or inline disables.
