# Coding Principles

The coding standard for this repo. Binding for every change, alongside the project-specific
rules in `ARCHITECTURE.md §5` (which instantiate these for this codebase). Where a change is
non-trivial, briefly explain the chosen approach and important trade-offs before implementing.

**When principles conflict, resolve in this order:**
Correctness/Security → Maintainability → Simplicity → Testability → Performance → Aesthetics.

---

## P0 — Correctness & Safety
- Correctness, security, data integrity, and backward compatibility come first.
- Validate external input; handle errors explicitly; never swallow failures.
- Never expose secrets or sensitive data.
- Avoid regressions and preserve existing behavior unless intentionally changed.

## P1 — Think Before Coding
- Understand the existing architecture, data flow, conventions, and dependencies before
  modifying code.
- Identify the simplest appropriate design before implementation.
- Consider edge cases, failure modes, security, testability, and maintainability.
- For non-trivial changes, briefly explain the chosen approach and important trade-offs.

## P2 — Architecture & Maintainability
- Separate concerns: UI, business logic, data access, infrastructure, configuration.
- Keep modules/functions focused and interfaces clear.
- Prefer composition, dependency injection, and clear dependency direction.
- Avoid god classes/modules, circular dependencies, global mutable state, and unnecessary
  coupling.
- Follow SOLID when it provides practical value.

## P3 — Simplicity
- Follow KISS, YAGNI, and pragmatic DRY.
- Prefer the simplest solution that fully solves the current problem.
- Avoid premature abstractions, design patterns, extensibility, and optimization.
- Prefer readable/explicit code over clever code.

## P4 — Testing
- Treat testability as a design requirement.
- For non-trivial behavior, define expected behavior and edge cases before implementation.
- Prefer tests that verify behavior/contracts rather than implementation details.
- Use a test-first/TDD approach when practical, especially for business logic and complex
  changes.
- Always consider: happy path, invalid input, boundary conditions, and failure paths.
- Run relevant tests after changes and fix regressions before finishing.

## P5 — Code Quality & Documentation
- Use meaningful names and follow existing project conventions.
- Avoid magic values, unnecessary `any`/casts, dead code, and unnecessary dependencies.
- Keep comments minimal and valuable: explain WHY, constraints, or non-obvious decisions —
  not WHAT the code does.
- Document public APIs and important architectural decisions.
- Keep code self-explanatory wherever possible.

## P6 — Performance & Operations
- Avoid unnecessary I/O, network/database calls, allocations, and expensive computation.
- Consider algorithmic complexity and scalability where relevant.
- Optimize based on evidence, not speculation.
- Add useful logging around important boundaries/failures without exposing sensitive data.

---

## Implementation loop
Understand → Plan → Explain important decisions → Test/define behavior → Implement →
Run tests → Review for simplicity/security/regressions → Clean up.

(The per-module extraction workflow in `CLAUDE.md` is this loop applied to one module.)

## Default
Write boring, explicit, modular, predictable code that is easy to understand, test, debug,
and change.

---

## In-depth operating principles (the rework)

These deepen P0–P6 into the concrete rules this top-down rework runs by. They emerged from
Phase 2 and are **binding** for every extraction. Each says how it is verified.

### E1 — Faithful port: behavior is the spec
An extraction reproduces the old behavior **exactly**, quirks included (e.g. `mondayOf` reads
*local* calendar components; UTC-vs-local is preserved, not "corrected"). Write the test to
capture current behavior **first**, then port until green. Never improve logic inside a move —
a behavior change is a separate, explicitly-flagged step (see E2).
*Verify:* tests encode the old behavior; browser smoke shows identical output.

### E2 — Conserve behavior over resurrecting dead code
When a fix reveals dormant or obsolete code, the right fix preserves what the system **actually
did**, not what the code looks like it intended. A fix must never silently activate a path that
never ran. (The `migrating` bug: merely declaring the variable would have resurrected a
server-rejected migration; removing the obsolete code conserved behavior and was correct.)
*Verify:* server `rev` unchanged / no new writes; console clean; diff against baseline `789bfec`.

### E3 — Strangler bridge, with thin adapters for coupled code
Each extraction moves pure logic into a gated module and bridges its exports onto `window` for
the legacy layer. Code too coupled to move cleanly (e.g. bound to the `AS_TREE` global) keeps a
**thin one-line adapter** in `legacy.js` that binds the global and delegates to core, so call
sites stay unchanged. Adapters are temporary and **must name the phase they retire in**.
*Verify:* `legacy.js` line-count burn-down; adapters grep-able and phase-tagged.

### E4 — Inject impurity to keep core pure
When pure logic needs impure data (bookings, state, time), **inject it as a parameter** (a
predicate or value); never reach for a global. This is how coupled logic becomes `core/`-eligible
(e.g. the solver takes `isFree(id, day)`).
*Verify:* core/ DOM-free + no-restricted-imports lint; the module imports nothing impure.

### E5 — Two-tier verification: gate proves logic, smoke proves integration
`verify` proves the extracted unit; a **browser smoke** proves the wiring (bridge resolves, app
boots, behavior identical). For impure/DOM/init code with no unit-test surface, the smoke **is**
the acceptance test — say so honestly rather than implying a unit test covers it.
*Smoke acceptance:* console clean (only known issues), **no unintended writes (server `rev`
unchanged)**, the feature runs end-to-end.

### E6 — Deterministic tests
Tests never depend on ambient environment or "now": pin `TZ=UTC`, use fixed real-calendar
anchors (known ISO weeks), and inject time/availability. Determinism is what makes the gate a
trustworthy oracle.
*Verify:* re-runs are identical; no `Date.now()`/timezone reliance in assertions.

### E7 — 100% on pure core, and mean it
90/85 is the hard floor; the working target for pure `core/` logic is **100%**. An uncovered
branch in pure logic is a defect to close (add the case), not an allowance to spend — unless the
branch is genuinely unreachable, in which case remove it.
*Verify:* coverage report; we actively closed e.g. the `pickNode` comparator branch.

### E8 — Defer, don't scope-creep
A real feature or non-blocking bug found mid-extraction is **recorded as a fully-specified
backlog item** (with grounded facts, so it needs no re-investigation) and the plan continues.
Layers open only in their phase — the backend stays sealed until Phase 6. (Weekend auto-bridging
→ Phase 6.3.)
*Verify:* item exists in `PROGRESS.md` with enough detail to execute cold.

---

## What the automated gate enforces (and what it can't)

`npm run verify` mechanically checks *part* of these principles. It is **necessary but not
sufficient** — green means the checkable rules hold, not that the design is good.

| Principle | Enforced by `verify` | Stays human judgment |
|---|---|---|
| P0 correctness / no regressions | tests + baseline `789bfec` diff (partial) | preserving subtle behavior |
| P2 focused units, layered deps, no global mutable state | ESLint (complexity, size, import boundaries, core DOM-free) | good separation & interfaces |
| P3 simplicity | complexity/size limits (partial) | avoiding premature abstraction |
| P4 testing | tests pass + coverage 90/85 on core | testing the *right* behavior |
| P5 quality | no-`any`, dead-code (knip), formatting | naming, useful comments |
| P6 performance | — | evidence-based optimization, logging |
| P1 think first | — | entirely judgment |

So: run the gate every time, but do not treat it as a substitute for P1 (understand first)
or for reviewing design, naming, and behavior preservation by hand.
