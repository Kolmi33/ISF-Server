# Assistant UX improvement plan — 2026-09-05

Status markers: checked and struck through means implemented and validated.
The full Docker gate passed; the completed change is committed through the mandatory hook.

## Feature plan

- [x] ~~1. Align Base UI checkboxes vertically with names; use an explicit 12px gap and full-row targets.~~
- [x] ~~2. Use black category titles/icons in light mode and readable foreground in dark mode.~~
- [x] ~~3. Show UND between required devices/groups; ODER for alternatives; all-required groups show UND.~~
- [x] ~~4. Match the two device-card heights; place the full-width card named
  “Auswahl Zeitraum und gewünschter Buchungstage” underneath, with actions bottom-right.~~
- [x] ~~5. Restore blue primary actions and selections; centralize palette tokens and document decisions.~~
- [x] ~~6. Initialize every fresh search result with the requested consecutive-day count, including repeat searches.~~
- [x] ~~7. Add muted drag-and-drop guidance in Einzelgeräte explaining how to form a Bedarfsgruppe.~~
- [x] ~~8. Clear the device filter after checking a search result and return focus to the filter.~~
- [x] ~~9. Provide one German date-range picker with start/end selection, month navigation,
  chronological ordering, same-day support, and keyboard interaction.~~

## Implementation plan

- [x] ~~Read architecture/principles, inspect the current components and official library documentation.~~
- [x] ~~Define regression tests for filter clearing, boolean display, repeated searches, and range selection.~~
- [x] ~~Implement the theme tokens and checkbox/category presentation (features 1, 2, 5).~~
- [x] ~~Implement filter clearing and explicit requirement connections with guidance (features 3, 7, 8).~~
- [x] ~~Implement the result-state reset (feature 6).~~
- [x] ~~Add the reusable Calendar/range-picker composition and document the frontend dependency decision (feature 9).~~
- [x] ~~Restructure the Assistant into equal-height device cards and the shared parameters card (feature 4).~~
- [x] ~~Run targeted tests, full local verify/build, and browser checks (keyboard, scrolling, mobile, dark mode).~~
- [x] ~~Review the diff and update architecture, acceptance checklist, and progress with evidence.~~
- [x] ~~Run Docker verify and create a commit through the mandatory pre-commit gate.~~

## Behavior and boundaries

The scheduling algorithm, server validation, weekday counting, grouped-device semantics,
and frozen result snapshots stay authoritative. UND is a presentation of the existing
all-required root semantics, not a new solver mode. For groups requiring more than one but
fewer than all children, show “Auswahl” with the existing N-of-M count rather than imply a
simple OR. Selecting a date range updates both endpoints together; canceling a partial
selection retains the previously applied range. Same-day ranges remain supported.

New searches reset result-day edits and per-result device removals. Editing search inputs
alone does not rewrite the existing frozen results.

The calendar uses shadcn's documented Calendar + Popover composition: React DayPicker owns
calendar navigation and keyboard semantics; installed Base UI owns the popup. Application
state continues to store ISO date-only strings. Explicit UTC calendar handling avoids
timezone/DST shifts. No backend dependencies are added.

## Validation evidence

- Host Node 24: full `npm run verify` passed, 1,006 tests in 71 files. Production build passed.
- Regression tests cover repeated search defaults/reset, filter clearing/focus, UND/ODER/N-of-M,
  required day bounds, leap-day/month-crossing ranges, reverse ranges, same-day selection,
  incomplete drafts/cancel, typed endpoint normalization, and nested-popover Escape priority.
- Chromium: checkbox/name vertical-center delta 0px, horizontal gap 12px, category ink RGB(0,0,0),
  primary blue RGB(26,95,180). Desktop selection cards measured 494×420px on both sides.
- 1400px, 860px, and 390px layouts: no horizontal modal overflow. Light/dark screenshots reviewed.
  Mobile popup shows one month with the apply action visible; desktop shows two months.
- Keyboard calendar selection across the March DST boundary yielded the same 2024-03-09 →
  2024-03-13 ISO range in Europe/Berlin and America/Los_Angeles. Month navigation worked;
  Escape restored focus to the trigger and left the Assistant open. No page errors.
- Calendar behavior is unit-tested separately from popup geometry because jsdom has no layout;
  the actual Base UI popup/focus composition is validated in Chromium.

Docker Node 22: full `npm run verify` passed with the same 1,006 tests / 71 files.
Both lists also scrolled independently with 25 selected devices while preserving equal
card heights; the temporary backend revision remained 0.
