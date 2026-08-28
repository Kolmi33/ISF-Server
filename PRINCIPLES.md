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
