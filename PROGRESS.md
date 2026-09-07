# PROGRESS — living project state

## Assistant footer alignment and hover cleanup (2026-09-07)

The duration controls are centered in the flexible region between both vertical separators.
The former full-block hover surfaces were removed from the duration and action regions while the
calendar range trigger keeps its interactive hover treatment. The individual controls and buttons
retain their own hover and focus feedback.

## Assistant result labels include machine details (2026-09-07)

Resolved machines in each search result now use the same two-line identity shown in the catalog
and selected-plan cards: machine name followed by its area and optional machine info. The former
technical-ID suffix has been removed from these labels. Direct and ODER-resolved machines retain
their existing neutral/brand color distinction. Integration coverage verifies the shared subtitle
survives the transition from selection to results.

## Assistant search expands every ODER candidate (2026-09-07)

The booking Assistant no longer resolves an ODER/N-of-M group to the longest-lived alternative
for each possible start day. The recursive plan tree now emits every fixed machine combination:
groups enumerate exactly `requiredCount` direct members, nested groups recursively contribute
their candidate lists, and top-level AND entries form their Cartesian product. Machine IDs are
canonically sorted and duplicate combinations are removed.

Availability is prepared once per machine as a Monday-to-Friday boolean mask covering the search
starts plus the minimum-duration lookahead. Candidate masks are intersected while the tree is
expanded; empty and too-short candidates are pruned early, and subtree results are cached. Each
remaining combination is scanned once for all contiguous free runs, so alternatives can never be
swapped between days inside a result. Booking, maintenance/defects and recurring weekday locks all
remain conflicts. Finite runs retain their complete known duration while `maxWorkingDays` only
caps the selectable booking length; open-ended runs retain the finite selectable horizon.

Focused tests cover `A AND (B OR C)`, two independent OR groups, nested group alternatives,
2-of-3 requirements, fixed combinations across days, all runs, full finite ranges, workdays and
the fresh-state booking check. The full quality gate passes with 1,024 tests.

## Assistant ODER action keeps groups atomic (2026-09-07)

Using the explicit ODER action on a requirement group now treats that complete group as one
alternative. Selecting a loose machine produces `machine ODER group` in a new outer requirement
group; it no longer inserts the machine among the existing group's members or changes that
group's requirement count. The same rule applies when the selected alternative is another group.
Drag-and-drop onto a group deliberately retains its direct "add member" behavior.

Regression coverage exercises a nested-card action followed by a group-anchor action and asserts
that the original group identity, members, and requirement remain intact. The full quality gate
passes with 1,019 tests. A live browser run grouped two machines, used that group's ODER action
with a third machine, and rendered an outer “1 von 2 Möglichkeiten” group containing the unchanged
two-machine group and the separate machine. The browser console remained clean.

## Phase 15 — application-wide visual unification (2026-09-07, DONE)

**Goal.** Make every secondary window read as one designed application by deriving the visual
system from the Buchungsassistent and applying it outward. Visual/structural only — no change
to booking, filtering, statistics or API behaviour. The main booking grid is deliberately out
of scope (`docs/UI_STYLE_GUIDE.md` §20).

**Reference.** `docs/UI_STYLE_GUIDE.md` — extracted from the Assistant's real code, not invented.

### How the migration works

The Assistant's look is delivered by a CSS scope class, not by classes on individual elements:
it carries the token palette, a local reset, and an `all: revert-layer` rule that neutralises
the unlayered `app.css` inside it. That block was generalised from `.booking-assistant` to a
shared **`.ui-scope`** (`web/css/ui-scope.css`). A window is "migrated" when its root carries
`ui-scope`; from that moment its legacy class names are inert and Tailwind/shadcn utilities win.
Legacy class names are therefore **kept as query hooks** where tests or other modules use them.

### Backlog

- [x] P15.0 — style guide (`docs/UI_STYLE_GUIDE.md`) extracted from the Assistant
- [x] P15.1 — `.booking-assistant` scope generalised to `.ui-scope` (`web/css/ui-scope.css`)
- [x] P15.2 — shadcn primitives lifted out of the Assistant into `web/js/components/ui/`
      (`app-button`, `badge`, `scroll-area`, `popover`, `tooltip`, `native-select`)
- [x] P15.3 — app dialog kit (`web/js/ui/components/app/`): `AppDialog`, `AppDialogHeader`,
      `AppDialogBody`, `AppDialogFooter`, `SectionHeading`, `EmptyState`, `SearchField`,
      `FormField`/`FieldLabel`, `StatTile`
- [x] P15.4 — Name prompt · Aktive Nutzer · Änderungsprotokoll · Legende
- [x] P15.5 — Einstellungen
- [x] P15.6 — Buchen (BookingForm) · Buchungsdetail
- [x] P15.7 — Meine Buchungen (summary, filters, runs, groups)
- [x] P15.8 — Alle Buchungen
- [x] P15.9 — Statistik (controls, overviews, drilldowns)
- [x] P15.10 — Verwalten · Ressourcenformular · Wartungsslots
- [x] P15.11 — Filterfenster (Ressourcen-, Bereichsfilter) · Kontextmenü
- [x] P15.12 — Bestätigungsdialog (`#confirm2`)
- [x] P15.13 — visual verification pass (light/dark, 1400px/520px, empty + long content)

### Result

Every secondary window listed above now renders inside `AppDialog`: a tinted icon tile and a
22px title, labels above their controls, one control height per role, `ScrollArea` lists of
bordered cards, real empty states, and the muted footer band carrying the count plus one
primary action. Behaviour, copy and storage keys are unchanged throughout; where a test keyed
off something the design system genuinely replaces (the `▸` expand chip, the `dangerfill`
class, `.mybk-stat-value`, `.stat-kpi-label`) it now keys off the accessible name or a shared
`data-slot`. The gate is green at 1,019 tests.

Two deliberate exceptions, both because the colour encodes data rather than chrome: Statistik
keeps its per-category accent (`--stat-fill`), and the Legende keeps the grid's own dot
colours. Custom properties survive `all: revert-layer`, so both still read the values app.css
sets.

### Found and fixed while verifying in the browser

- **The isolation rule lost on specificity.** `all: revert-layer` only wins by specificity and
  `app.css` is unlayered, so `.mlist .grp.cathead:not(:first-child)` (five class components)
  beat the original two-class scope selector and legacy fills were still showing in the
  filter popover. The scope class is now repeated seven times.
- **Id-level rules can never be out-specified.** `#modal h2` was making every `SectionHeading`
  16px, and `#confirm2 .cbox` was still adding its own 10px card padding. Those rules styled
  the insides of containers that are now fully migrated, so they were deleted from `app.css`
  (twelve rules across `#modal`, `#confirm2`, `#machDrop`, `#groupDrop`, `#ctxMenu`); the
  containers' own position/backdrop/toggle rules stay.
- **Statistik's dashboard card overlapped the list below it** — both were shrinkable flex
  children. The dashboard now holds its height, the list grows, and it has a 16rem floor so a
  short or narrow window scrolls the body instead of squeezing the list to nothing.
- **A long "Meistgenutzt: …" label stretched its KPI tile** instead of truncating.
- **Native controls ignored the theme.** `.ui-scope` now sets `color-scheme`, so the date
  inputs and `NativeSelect` dropdowns follow light/dark.

### Verification

`npm run ui:shots` (new, `scripts/ui-shots.mjs` — the companion to `ui:smoke`) opens each
window in a real browser and screenshots it, at a given viewport and theme. Checked: all
thirteen windows plus the context menu and both filter popovers, at 1400×950 and 520×900, in
light and dark, with empty / normal / long-content data. Console clean in every run.

**It is strictly read-only, and that rule is load-bearing:** the dev server proxies `/api` to
the real backend, and an earlier version of the driver clicked through a delete-confirm and
removed a live booking (Monforts RNC200, 2026-09-07, group `g_mtpkqr44jqme`; not restored —
the user chose to leave it). Scenes may only open things; the confirm dialog is reached via
the machine form's delete and left unanswered.

### Audit — what was inconsistent before

Every window except the Assistant rendered legacy `app.css` markup: `.formrow` (label left of
control, 13px, `--app-muted`), `.btn`/`.btn.primary` (6px radius, blue `--app-accent`),
`.mlist`/`.resultlist` (native scrollbars, 6px radius), `.hint`, `.tag`, `.mybk`, `.admrow`,
`.statrow`, `.seg`, plus ~40 inline `style={{…}}` one-offs. Concretely: two accent colours
(blue `--app-accent` vs. the Assistant's green `--primary`), three button heights, four border
radii (4/6/8/10px vs. the scale in §6), inputs at 30px vs. 40px, `<h2>` at 16px vs. the 22px
dialog title, no icon tile, no footer band, `<p class="hint">` instead of a real empty state,
and dialog padding of 18/20px against the Assistant's 24/28px.


## Assistant workday slots and open end (2026-09-07)

The booking Assistant now treats Monday through Friday as its only booking-day sequence. Weekend
days are excluded from the search, duration bounds, result counts, and the exact dates passed to
the booking form; Friday followed by Monday remains continuous. Date-range presets still cover
their stated calendar span, while the range summary and Min./Max. controls show its actual number
of workdays. A weekend-only search range is rejected explicitly.

Availability is now event-based rather than bounded by an arbitrary future scan. For each fixed
device resolution, the scheduler finds the next known weekday booking, maintenance boundary, or
recurring machine-day restriction. No such future conflict marks the result as open ended “nach
aktuellem Buchungsstand”. Nested N-of-M groups choose the fixed alternatives with the furthest
boundary, open-ended results sort before finite results, and the live booking handoff rechecks the
exact workday list before confirmation.

Focused coverage exercises Friday-to-Monday continuity, ignored weekend bookings and maintenance,
finite weekday boundaries, recurring weekday masks, open maintenance, stable alternative choices,
nested groups, exact DST-weekend handoff, and stale-result rejection. The full quality gate passes
with 1,019 tests.

A real browser run searched a Sunday-to-Saturday range and correctly reported five workdays. An
open-ended result offered three to five workdays; reducing it to three passed Friday, Monday, and
Tuesday to the booking form without either weekend date. The browser console remained clean.

## Assistant slot length and ordering (2026-09-06)

The booking Assistant now returns each distinct continuous free run exactly once. A run shorter
than the requested minimum is omitted; a longer run is capped to the requested maximum before it
is shown. For example, one seven-day run with a three-to-six-day duration request produces one
six-day result, rather than separate four-, five-, and six-day variants or another result from
the unused remainder. The booking-duration control still allows any value from the requested
minimum through the offered slot length and initially selects the longest value.

Results are ordered by offered length from longest to shortest, with earlier start dates first
when lengths match. The adapter and booking handoff use the same capped interval, so the displayed
end date, duration control, and submitted dates remain aligned. Focused regression tests cover
run de-duplication, maximum clipping, duration selection, descending length order, and the
equal-length date tie-break.

The full quality gate passes with 1,017 tests. A real browser run searched GIANA across 30 days
with a three-to-six-day request. Its long remaining free run appeared once as a six-day result,
defaulted to six booking days, remained adjustable to three, and produced no console errors.

## Assistant ODER picker (2026-09-06)

Every plan card now has a branch/ODER action beside its position and remove/ungroup control.
The action opens a compact multi-select popover containing every other valid plan element across
the complete tree: individual machines, complete booking groups, and entries inside other
groups. Applying the selection moves those entries into a new interchangeable group while
keeping the chosen anchor in place. Ancestors and descendants of the anchor are excluded to
prevent cycles and duplicate contents. If a group and one of its members are selected in the
same draft, the latest choice replaces the overlapping one. The action works at the top level
and inside nested groups; drag and drop remains available and both paths use the same normalized
plan tree.

Focused state and integration coverage exercises multi-selection, device anchors, existing
group anchors, nested cards, control placement, and the resulting requirement group. A real
browser run created two separate groups and a loose machine. The loose machine's picker offered
both complete groups and all of their members, excluded the source, and nested one complete group
under the loose machine. The resulting three group cards retained the subgroup structure and the
browser console remained clean.

The full quality gate passes with 1,016 tests.

## Assistant controlled dismissal and card numbering (2026-09-06)

The booking Assistant now opens as a sticky modal: Escape and backdrop clicks leave it open,
and the redundant header close button is gone. “Abbrechen” remains the explicit dismissal
action. Top-level plan positions moved from the left edge into a compact badge directly before
the card action on the right. Requirement groups now receive the same top-level numbering;
their nested alternatives remain unnumbered.

The full gate passes (1,012 tests). Browser verification confirmed both blocked dismissal
paths, dismissal through “Abbrechen”, the right-aligned `01`/`02` badges on a group and loose
device, and a clean console.

Group badges now reflect the number of required alternatives: a group requiring two machines
shows `01, 02`, and the next top-level machine continues at `03`. The label updates immediately
when the group count changes. Browser verification covered grouping two machines, increasing
the requirement, cumulative numbering of the following card, badge fit, and a clean console.

The grouping tooltip is now a scannable three-item list explaining checkbox selection as UND,
drag-and-drop grouping as ODER, and both ways to separate grouped machines.

## Assistant drag/drop identity fix (2026-09-06)

Fixed duplicate green insertion markers and cards becoming non-draggable after dissolving a
requirement group. A newly created group had reused its target device's plan-entry ID while
also retaining that device as a child, registering two simultaneous dnd-kit targets under the
same identity. New groups now receive their own entry ID; member IDs remain stable through
grouping and dissolution. A regression assertion enforces unique IDs throughout the group tree.

The full gate passes (1,011 tests). Browser verification against the restarted Vite server
grouped two cards, observed exactly one insertion marker during the next drag, dissolved the
group back to three draggable cards, and successfully dragged the former target card again;
the console remained clean.

## Supplied booking assistant integration (2026-09-06)

Replaced the earlier assistant UI with the user's Downloads/BuchungsAssistent.tsx and
README design. The supplied section markup, green/orange palette, fonts, range presets,
Min./Max. controls, plan cards, drag gestures and separate results view are preserved.
Small component/API adapters reuse the installed Base UI shadcn variant; the supplied
file is split into focused modules to meet existing code-size gates. Theme/reset rules
are scoped to this dialog and its portals. The host provides scrolling and responsive
footer wrapping. Initial dates use the current day and the supplied one-week range length.

Live catalog fields use actual names, IDs and departments (the backend has no separate
inventory-code or laboratory field). Random results are replaced by deterministic
calendar-day availability with fixed N-of-M device assignments across each whole result.
Booking validates the latest state and opens the existing confirmation form with exact
IDs/dates. Calendar navigation filters to the resolved devices and retains the assistant
for reopening. Cancel/close and authoritative server writes use the existing host flow.

Progress and validation: `docs/ASSISTANT-INTEGRATION-PLAN.md`. Earlier entries below describe
superseded designs. Formatting, types, lint, dead-code checks and all 1,002 tests pass
(97.81% line / 93.03% branch coverage). Browser checks in Orca cover real catalog/search,
grouping, calendar/help and mobile scrolling. Production rebuilt on localhost:3000.
No live test reservations were created.

## Assistant scrolling and duration bounds (2026-09-05)

Supersedes the weekday-selection UI described below. The Assistant searches Monday–Friday
again. The selected-device/group count now lives beside “Ausgewählte Geräte”. “Zeitraum &
Dauer” contains date endpoints, Mindestdauer and Höchstdauer, then right-aligned actions.
Duration bounds are positive integers (initially 1–30, with no new hard maximum). An inverted
range blocks search with an inline error. A longer free window remains a match; each result
freezes and enforces the requested minimum and the smaller of maximum/window length. Booking
receives the exact selected weekdays as before; existing server weekend bridging is unchanged.

Fixed the missing flex/height constraint on `.assist-shell` and prevented body sections from
shrinking. The body now scrolls inside the viewport-bounded dialog; the header and close
button remain visible. Mobile date endpoints stack so their values have sufficient room.
Calendar popovers are hosted at the dialog level, outside its scrolling body.

Focused regression tests cover duration bounds, invalid ranges, summary placement, removal
of weekday selection, staleness, and the Friday/Monday booking handoff. Browser inspection
through Orca reproduced the old 680px dialog / 847px overflowing shell at 1280×720 and
confirmed body scrolling and reachable actions after the fix, including at 390px width.

## Assistant redesign — spacious layout, weekday selection, help tooltip (2026-09-05)

User-requested full redesign of the booking Assistant on the existing shadcn/Tailwind
components, superseding parts of the same-day "usability update" section below (notably its
page-level footer decision — the search action now sits directly beside the "Zeitraum &
Dauer" card again, per this newer, more specific request).

**Layout**: `Buchungsassistent` + subtitle header; 45/55 two-column device cards ("Geräte
auswählen" / "Ausgewählte Geräte") stacking on narrow screens; a full-width "Zeitraum & Dauer"
card below (date range + duration, then weekday selection, then a separator, then the
selection summary + search/cancel actions); "Passende Termine · {count}" below that once a
search has run. Dialog now sizes to `min(1200px, 100%)` wide and `calc(100vh/100dvh - 40px)`
tall (was a fixed max-width/vh clamp) — header stays fixed, only the body scrolls. The catalog
card keeps its own bounded scroll (`clamp(340px,45vh,480px)`); the selected-devices card has
none, growing with the dialog's own scroll instead of a second small scrollbar.

**Weekday selection (new)**: `core/assistant.ts` gained a `WeekdayMask` (7-char Monday-first
mask, same format as `Machine.days`) and generalized `groupRuns`/`extendOpenRuns` plus a new
`candidateDaysInRange` to step by an injected mask instead of a hardcoded Mon–Fri skip
(defaulted to the old Mon–Fri mask, so every existing call site/test is unaffected). A Base UI
`ToggleGroup` (`AssistantWeekdaySelector.tsx`) exposes all 7 days plus "Mo–Fr"/"Alle Tage"
presets, wired into the real search (not a cosmetic filter) and into "Mindestdauer"'s helper
text (`ui/assistant-weekdays.ts`'s `durationUnitHint`, 3 variants). An empty selection is
rejected with an inline error, blocking the search.

**Booking-write fix (real conflict identified and resolved, not silently patched over)**: the
booking write path (`BookingForm.tsx`) always expanded a Von/Bis range into every calendar day
between them (intentional for the Mon–Fri/weekend-bridge default). A custom, gapped weekday
selection would have silently re-included the excluded days on write. Fixed by giving
`openBookingForm`/`BookingForm` an optional explicit `dates` list — the Assistant now always
passes its own already-resolved day list for its "Buchen…" action, bypassing the range
recompute; every other caller (grid rectangle/single-cell, booking-detail modal) is untouched.
The Mon–Fri default's weekend bridging is unaffected: it's the server's own `maintainBridges`
(Phase 6.3) that re-establishes it after the fact, independent of the exact dates POSTed.

**Other features**: inline field-level validation (date range, weekday selection) replacing
two of the three toast cases (the "no devices" toast stays — cart-level, no labeled field to
attach to); a deferred (`setTimeout`) search with a token guard (prevents a superseded search
from clobbering a newer one) and a "Termine werden gesucht…" loading state on the search
button; a staleness banner ("Suchkriterien geändert…") once any input changes after a
completed search; a live "N Einzelgeräte · N Bedarfsgruppen" selection summary
(`ui/assistant-summary.ts`); the permanent "Ähnliche Geräte…" hint paragraph replaced by a
`AssistantHelpTooltip.tsx` (Tooltip for hover/focus, Popover fallback for touch via
`useMediaQuery`) beside an always-visible "Bedarfsgruppen" heading; group requirement reworded
to "N von M Geräten benötigt"; a keyboard-accessible "In Gruppe verschieben" alternative to
drag-and-drop (`AssistantGroupMenu.tsx`, a Base UI `Menu` scoped to top-level loose
devices/groups — nested-group targets are out of scope for now, drag-and-drop still covers
those); results heading now reads "Passende Termine · {count}"; repeated result rows' "Buchen…"
button uses the quieter `outline` variant.

**Validated**: `npm run verify` green (1,027 tests / 74 files, was 1,006/71 — 21 new tests
across `core/assistant.test.ts`, `ui/assistant-weekdays.test.ts`, `ui/assistant-summary.test.ts`,
`BookingForm.test.tsx`), production build clean. Browser-verified against the real dev server
(Playwright, Chromium): 1200×~696px dialog at 1440×900 with ~20px overlay margin; weekday
toggles + presets functional; duration hint switches to "Aufeinanderfolgende ausgewählte
Wochentage" under a custom mask; tooltip shows the exact required copy on hover, positioned
within viewport; a real search against live seed data returns "Passende Termine · 1" with no
console errors; 390px mobile viewport reflows to one column with no additional horizontal
overflow beyond the pre-existing (unrelated) wide booking-grid table; a checked device updates
the summary and reveals the "Bedarfsgruppen" heading + tooltip. Not separately re-screenshotted:
dark mode, 200% zoom, and the keyboard "In Gruppe verschieben" menu's own interaction (covered
by unit tests, not a live browser pass).

## Assistant usability update (2026-09-05)

All nine requested improvements are implemented and locally verified. The tracked feature
and implementation checklist is in [docs/ASSISTANT-UX-PLAN.md](docs/ASSISTANT-UX-PLAN.md).
The two device cards now have equal heights; a full-width range/duration card sits below.
Base UI checkboxes have aligned names and 12px spacing; category headings/icons use black
ink in light mode. Required nodes show UND, alternative groups ODER, intermediate N-of-M
choices Auswahl. Einzelgeräte includes grouping guidance. Checking a filtered device clears
the query and restores filter focus. Fresh searches reset each result's booking-day count
to the requested minimum and clear prior per-result edits/removals.

The date-range field combines synchronized editable endpoints with a German DayPicker
calendar in a Base UI popup (two months desktop, one mobile). Draft/cancel, reversed and
same-day ranges, leap days, keyboard selection, and UTC/DST handling are verified. Theme
values now live in web/css/theme.css; blue primary tokens and design decisions are documented
in docs/UI-DESIGN.md. ARCHITECTURE §19 records the frontend-only calendar dependency.

Host Node 24 verify: 1,006 tests / 71 files passed; production build passed. Chromium checks
covered layout, colors/alignment, independent scrolling, keyboard/focus, and DST in Berlin
and Los Angeles; no page errors or booking writes (temporary backend rev remained 0).
Docker Desktop was found under AppData/Local/Programs/DockerDesktop and started successfully;
the full Node 22 container gate also passed (1,006 tests / 71 files). This step is
committed through the mandatory Docker pre-commit hook; all plan items are crossed off.

**Read this first when resuming, and after any context clear.** It is the single source of
truth for *where we are* and *what's next*. Update it whenever an item lands or the plan
changes. (The stable design lives in `ARCHITECTURE.md`; the volatile state lives here.)

_Last updated: 2026-09-04 — **Phase 14, revised direction: the shadcn preset (`b6EWdD0CK8`)
adopted in full, on fork branch `phase14-shadcn-preset` — halted before merge/deploy.** After
14.1–14.3 shipped to production (Tailwind tooling + hand-rolled Button/Input, then a real
Preflight regression found and fixed same day), the project owner tried a real shadcn CLI
preset and decided to adopt it fully: Base UI (not Radix), Tabler icons, Inter/Manrope fonts,
the preset's own palette. Reconciled against 14.1–14.3's work, `npm run verify` green (998
tests / 70 files) throughout. One item deliberately left open, not fixed or ignored — see
Known Bugs → Open. Full detail in the Phase 14 section below._

_Previously: 2026-09-03 — **Phase 13 (second user-requested feature/UX batch, post-deploy
feedback) COMPLETE** — 3 commits, full detail in the Phase 13 section below. `npm run verify`
green at 933 tests / 68 files throughout._

_Previously: 2026-09-03 — **Phase 12 (user-requested feature/UX batch) COMPLETE** — 8
commits, one module each, full detail in the Phase 12 section below. `npm run verify` green
at 906 tests / 68 files throughout._

_Previously: 2026-09-02 — **The architecture audit (`docs/ARCHITECTURE_AUDIT.md`) is now
fully resolved except F7's full-merge option (open by design) and F10 (checked, not worth
doing).** F1–F7(minimal) landed earlier same-day; **F9** (the `window.S` → `store` migration)
and **F8** (the "4 React roots" window cross-talk) both landed since, in F8's case after a
re-investigation showed the original "merge the roots" framing didn't hold up against actual
call sites — see the audit's own F8 write-up for what shipped instead. A follow-up code
review then surfaced and fixed two real bugs (undo's CAS check silently skipped after
undoing a booking creation; `machById`'s cache going stale after a machine create/delete)
plus a defensive consistency fix (three modals guarded against opening before data loads) —
see Known Bugs → Fixed. `npm run verify` is green at 797 tests / 62 files.
Also done earlier same-day: Phase 6's two operational items — the deploy
(`docker compose up -d --build`, user-authorized) and the one-time weekend backfill
(`node server/backfill.js`, 1,484 rows inserted, re-run confirmed idempotent at 0) both
ran successfully; production is on the current gated codebase with the weekend maintain
hook live. Every "awaits authorization"/"not run" note below about these two items is
now historical. Also done: the wknd-on-patch bug fix (see Known Bugs → Fixed)._

_Previously: 2026-08-31 — **Phase 7 COMPLETE** — the frontend's React migration (Backlog B,
tracked slice-by-slice in `PHASE7-PLAN.md`) has landed in full: `web/public/legacy.js` (the
non-module monolith this file's "Current state"/"Done log" below describe extracting FROM,
Phase 1.2 onward) is deleted outright, and the frontend is 100% gated TypeScript + React. The
"view-layer decision: no framework" note under "Next step" below is superseded by that — see
`PHASE7-PLAN.md`/`ARCHITECTURE.md §18` for the React adoption rationale._

_Previously: 2026-08-29 — **Phase 6 COMPLETE (code)** — backend → gated TS under `server/` + weekend auto-bridging (maintain hook + backfill CLI). Whole roadmap (0–6) implemented & gated._

---

## How to resume (after a context clear or a new session)
1. Read this file — the "Current state" and "Next step" below.
2. Read `CLAUDE.md` (operating manual) and `PRINCIPLES.md` (coding standard). Skim
   `ARCHITECTURE.md` (design/decisions) and `FEATURES.md` (acceptance checklist) as needed.
3. `git log --oneline` — confirm the last landed step matches "Done log" below.
4. Run the gate — it must be green before you continue:
   `docker compose -f docker-compose.dev.yml run --rm dev npm run verify`
5. Continue from "Next step". Work the backlog top-down: one item → per-module loop →
   verify → commit. Update this file as items land.

## Current state
- **Phase 0 / 0.5 — done. Phase 1 — COMPLETE** (1.1–1.4b).
- **Phase 2 — in progress.** 2.0 + 2.1 landed:
  - `web/js/app.ts` — the ESM entry/bridge. Loaded as `<script type="module">` BEFORE
    `legacy.js` (which is now `defer`); both run post-parse in document order, so the bridged
    globals exist before legacy's `init()`. It does `Object.assign(window, dates)`.
  - `web/js/core/dates.ts` (+ `dates.test.ts`, 22 tests, **100% cov**) — the 12 pure date
    helpers extracted from `legacy.js` and deleted there; legacy calls them via the window bridge.
  - Coverage is now **enforced by `verify`** (`test:cov`, threshold 90/85 on `core/**`); TZ pinned
    to UTC in `test/setup.ts` for deterministic date tests; `tsconfig` allows `.ts` import specifiers.
  - `shared/types.ts` seeded (the domain contract): `Machine`, `MaintSlot`, `MachineCategory`.
    It grows as extraction surfaces more fields.
  - `web/js/core/machines.ts` (+ `machines.test.ts`, 18 tests, 100% cov) — the pure resource
    category + maintenance/availability predicates (`catOf`, `maintSlots`, `slotCovers`, `maintAt`,
    `isBlockedM`, `anyMaint`, `dayAvailable`, `cellBookable`), extracted and deleted from `legacy.js`.
    The German status-text helpers (`maintText`, `statusRangeText`, `daysMaskText`, `blockText`,
    `maintKind`) stayed in `legacy.js` (presentation; move with the views in Phase 4).
  - `web/js/core/weekend.ts` (+ `weekend.test.ts`, 6 tests, 100% cov) — the live `sweepWeekends`
    (removes orphaned Sat/Sun days on booking writes), extracted + bridged.
  - **`migrating` bug FIXED** (see Known bugs → Fixed): removed the two obsolete file-era
    Bestands-Migrationen (`migrateWeekends`/`migrateMesstechnik`) and their `startUI()` calls.
    They never ran (threw on undeclared `migrating`/`migratingMess`) and the server *rejects* the
    weekend-bridge write (HTTP 400), so removal preserves behavior (no migration ran before/after)
    while clearing the console error. `missingWeekendBridges` was only used by the removed migration,
    so it was deleted too (not extracted).
  - **2.4a** `web/js/core/assistant.ts` (+ `assistant.test.ts`, 16 tests, 100% cov) — the pure
    Assistant **tree ops** (`treeFind`, `treeFindParent`, `treeIsAncestor`, `treeDetach`, `treeDevs`,
    `treeDevUid`, `treeCleanup`). The Assistant is heavily UI-coupled (AS_TREE global + DnD + DOM),
    so legacy keeps **thin one-line adapters** (`asFind`, …) that bind `AS_TREE` and delegate to
    core — call sites unchanged; adapters retire in Phase 4 when AS_TREE becomes a store.
    Browser-verified: core + adapters + the real `asAdd`→`asDevs` mutation path all work; console clean.
  - **2.4b** the Assistant **N-of-M solver** — `nodeNeed`, `nodeFree`, `dayOk`, `anyRedund`,
    `nextWeekday`, `freeDays`, `groupRuns`, `extendOpenRuns`, `winFree`, `pickNode`, `pickFor`
    extracted into `core/assistant.ts`, **parameterized by an injected `isFree(id,day)` predicate**
    so the scheduler is a pure function of (tree, days, availability). `runAssistant` refactored to
    call them (keeps its DOM/result rendering + the S-coupled `isFreeDev`). +15 tests, 100% cov.
    Browser-verified by **running the Assistant end-to-end**: correct result card
    ("… durchgehend frei (offen – 542 Tage wählbar)"), core cross-check matches, console clean.
- **Phase 2 is COMPLETE.** All four core modules extracted, tested (78 tests, 100% cov on `core/**`),
  and behavior-verified.
- **4.1c-2 (reactive wiring, rest) DONE 2026-08-29** — migrated all 27 remaining direct `render()`
  calls to `notify()` (bulk, then reverted the two internal render/overflow-loop sites back to direct
  `render()`: `ensureOverflow` and the keyboard grow-right — they must not re-enter via the store).
  `render()` now appears only as its definition, those two loops, and the store subscription; every
  user repaint routes through `store.notify()`. Smoke via instrumented render-count on real clicks:
  btnNext/btnPrev = exactly 1 render each (KW 34/35/36 ↔ 35/36/37); btnToday = 2 (notify + prependWeek,
  pre-existing, not a new double); category-filter toggle = exactly 1 render, grid 163 ↔ 263 rows;
  console clean; `rev` 23. **Phase 4.1 complete — grid logic extracted + store-reactive.**
- **4.1c-1 (reactive wiring, core) DONE 2026-08-28** — `app.ts` subscribes the legacy `render` to the
  store (`store.subscribe`, guarded so the grid never renders before the first data load) and bridges
  `window.notify = () => store.notify()` (Window augmented with `render`/`notify`). The two runtime
  data-change paths — `refreshNow` (`S.data=d; notify(); stampRef()`) and the SSE `structural` handler
  (`… fillGroupSel(); notify()`) — now trigger the repaint **through the store**, delivering the
  deferred 3.3 goal (SSE/refresh → store → notify → render). The SSE `update` handler keeps its
  `patchCells` fast path; the ~34 UI-trigger `render()` calls stay direct for now (mixed mode is safe
  — both call the same render). Smoke: `notify()` after a `S.startMonday` mutation repainted the header
  (KW 34/35/36 → 35/36/37) and restored; migrated `refreshNow` ran store-driven (3675 cells, no error);
  console clean; `rev` 23. **First real store.notify consumer is live.**
- **4.1b (ui/grid header + dot) DONE 2026-08-28** — `web/js/ui/grid.ts`: `weekHeaderCells` (KW +
  weekday/date header columns; pure over core/dates — the gap-`<th>` asymmetry between the two header
  rows preserved) and `classifyDot` (5-state today-dot: defekt/maint/busy/unavail/free), which dedups
  the dot decision across `render()` and `refreshDot()`. +5 tests, 100% cov. Smoke: header shows KW
  34/35/36, 15 day columns, exactly 1 today column, "Mo17.08." format; 245 dots (232 free / 13 busy);
  `refreshDot` idempotent ("heute belegt: Hensler"); console clean; `rev` 23. Remaining row-header
  string assembly stays in legacy for now (see backlog 4.1b note).
- **4.1a (ui/grid cell model) DONE 2026-08-28** — `web/js/ui/grid.ts`: pure `classifyCell` (4-state
  priority), `isMine` (case-insensitive owner check), `cellClass` (class stem). +9 tests, 100% cov.
  `render()` and `refreshCell()` both refactored to the shared helpers — removes the per-cell decision
  duplication that had already drifted (title/aria richness) between them. New `ui/` gate layer
  (coverage 90/85). Smoke: grid renders (216 booked / 40 mine / 245 today / 3459 free), `refreshCell`
  idempotent vs. the full render for booked+free cells, console clean, `rev` 23. Pre-existing
  `wknd`-on-patch asymmetry preserved (Known bugs → Open). **Phase 4 started.**
- **3.3 (net/sse) DONE 2026-08-28** — `web/js/net/sse.ts`: pure event logic `applyUpdate`
  (mutates bookings, returns rev + repaint patch), `presenceInfo` (badge count/label), `isForeign`
  (remote-change gate). +8 tests, 100% cov. Legacy `connectSSE`/`applyPresence` refactored to the
  bridged helpers (thin DOM/EventSource adapter remains). **Plan adjusted:** the SSE orchestrator
  move + `store.notify()` wiring are **deferred to Phase 4** (notify has no subscriber until `render`
  subscribes — E3/E5/E8; see ARCHITECTURE §14 "3.3 SSE"). Gate + smoke green (live `presence` event
  drove the badge through the new adapter; `applyUpdate`/`isForeign` bridged and correct; `rev` 23).
  **Phase 3 complete.** **Next: Phase 4.1.**
- **3.2 (net/api) DONE 2026-08-28** — `web/js/net/api.ts`: `API`, `apiGet`/`apiPost` (fetch
  injected, E4), `validateData` + `normalizeState` (faithful ports of legacy `validateData`/
  `readFile` normalization). +14 tests, 100% cov; new `net/` gate layer wired (eslint boundary
  `net/ ↛ ui/`; coverage floor 90/85). legacy `API`/`apiGet`/`apiPost`/`validateData` removed,
  `readFile` thinned to `normalizeState(await apiGet('/api/state'))`. Gate + smoke green
  (boot + a live `/api/state` round-trip both 200; `rev` unchanged). **Next: 3.3 `net/sse.ts`.**
- **3.1 (state store) DONE 2026-08-28** — see Done log.
  - `web/js/state.ts`: `createStore(initial): Store` — pure, mutates its state object in place so
    the bridged `window.S` reference stays valid; `get`/`set`(shallow-merge+notify)/`subscribe`
    (returns unsubscribe)/`notify`. +6 tests, 100% cov; gate floor extended to `state.ts` (D6).
  - `shared/types.ts`: added `LogEntry`, `ServerData` (= `BookingData` + `groups`/`rev?`/`revision`/
    `log`), `AppState` (the 16-field legacy `S`, byte-identical incl. dead `lastRaw`, D4).
  - `app.ts`: `hydrateState()` (localStorage + `mondayOf(new Date())`, the impurity `createStore`
    avoids — D3/E4) → `createStore` → `window.S = store.state`; `Window.S` augmented.
  - `legacy.js`: `const S = {…}` removed (its 158 `S.x` sites now resolve to the bridge; zero
    call-site changes). Manual `render()` kept — `subscribe`/`notify` built+tested but NOT wired
    (D2/Q2b; first consumer is SSE in 3.3).
  - Gate green (85 tests, 100% cov). Browser smoke: `window.S` = 16 fields in order, Sets intact,
    data loaded (245 machines, rev 23), 265 rows rendered, stored filters (`machSel`/`person`/
    `personOnly`) hydrate faithfully across reload, console clean, server `rev` unchanged (23).

## Next step
> **Phase 6's operational items are done** (2026-09-01/02): `docker compose up -d --build` deployed
> the reworked stack (user-authorized), and the one-time weekend backfill (`node server/backfill.js`)
> inserted 1,484 rows, re-run confirmed idempotent (0 the second time). The weekend maintain hook is
> live in production. Both steps below are kept here only as a historical record of what they were.
>   1. ~~Deploy the reworked stack~~ — done.
>   2. ~~Run the one-time weekend backfill~~ — done.
>
> **Carry forward, updated 2026-09-02 post-architecture-audit:** the modal-markup fold and the
> `AS_TREE`-adapter are both moot now (`ui/modal.tsx` and the Assistant's `useAssistantTree` hook
> superseded them in Phase 7 B7/B10d); the action-layer question resolved itself the same way —
> `ui/mutate.ts` ported legacy's own `mutate` as the orchestrator, faithfully, no new `actions.ts`
> layer. The **wknd-on-patch** known bug is fixed (see Known Bugs). The full architecture audit
> (`docs/ARCHITECTURE_AUDIT.md`) is now resolved except F7's full-merge option (deliberately open)
> and F10 (checked, not worth doing) — see that file's §10/§11 for the final status of every item,
> including F8/F9, both done as of this update (see the "Last updated" note above).
>
> **What's actually still open:** F7's full `shared/types.ts`⟷`server/types.ts` merge (the
> minimal compile-time contract test shipped instead; a full merge remains a real, larger
> decision, not scheduled). Nothing else from the audit is outstanding.
>
> **View-layer decision (resolved, §15):** no framework — keep the custom string render + a tiny
> store subscription (zero-dep). Revisit only if the UI grows materially.
>
> **Canonical-naming rule (superseded by F9, done):** `store` was the canonical abstraction for
> all new TS while `window.S` was migrating; that migration is now complete for every module this
> app owns (F9). `window.S` still exists as the read bridge a handful of deliberately-still-window
> -bridged utilities rely on (`mutate`/`askConfirm`, kept for their wide fan-out — see F8's
> write-up) — no new code should reach for it directly.

## Backlog (task queue — the single canonical copy)
Checked off as each item lands (one commit per item unless noted).

**Phase 1 — Skeleton (app runs identically, structure ready for extraction)**
- [x] 1.1 Vite `web/` root serving the current `index.html` unchanged; app loads identically
- [x] 1.2 Monolith inline `<script>` → `web/public/legacy.js` (classic, global-scope,
  gate-excluded); app boots byte-for-byte
- [x] 1.3 Lift the `<style>` block into `web/css/app.css`; app looks identical
- [x] 1.4a Multi-stage Dockerfile builds the frontend; production container serves the built
  output from `/app/public` (verified end-to-end at :3000)
- [x] 1.4b Retire the old top-level `public/`; confirm production still serves the app

**Phase 2 — Core logic (TDD; coverage 90/85 arms here)**
- [x] 2.0 clean ESM entry `web/js/app.ts` (module, runs before `defer` legacy.js); bridges
  extracted modules onto `window` so legacy's inline handlers keep resolving. Coverage armed
  into `verify` (`test:cov`, 90/85 on `core/**`).
- [x] 2.1 `core/dates.ts` (+ 22 tests, 100% cov); 12 helpers deleted from `legacy.js`
- [x] 2.2 `core/machines.ts` (+ 18 tests, 100% cov) + `shared/types.ts` seeded; 8 predicates
  deleted from `legacy.js`
- [x] 2.3 `core/weekend.ts` (`sweepWeekends`, + 6 tests, 100% cov); `migrating` bug fixed by
  removing the two obsolete migrations (see Done log + Known bugs → Fixed)
- [x] 2.4a `core/assistant.ts` — pure tree ops (7 fns, + 16 tests, 100% cov); legacy keeps thin
  `AS_TREE`-binding adapters (retire in Phase 4)
- [x] 2.4b `core/assistant.ts` — the N-of-M solver (11 fns, predicate-injected; +15 tests, 100% cov);
  `runAssistant` refactored to call it. **Phase 2 complete.**

**Phase 3 — State + net**
- [x] 3.1 `state.ts` (store + subscribe/notify) — pure `createStore`, +6 tests 100% cov; `AppState`/
  `ServerData`/`LogEntry` typed; `app.ts` hydrates + bridges `window.S`; `const S` removed from
  `legacy.js`. Gate + smoke green; `render()` still manual (D2). **DONE 2026-08-28.**
- [x] 3.2 `net/api.ts` — `apiGet`/`apiPost` (fetch injected) + `validateData`/`normalizeState`
  faithful ports; +14 tests 100% cov; `net/` gate layer wired (eslint `net/↛ui/`, coverage 90/85).
  legacy HTTP client removed/bridged. Gate + smoke green. **DONE 2026-08-28.**
- [x] 3.3 `net/sse.ts` — pure `applyUpdate`/`presenceInfo`/`isForeign` (+8 tests 100% cov); legacy
  `connectSSE`/`applyPresence` refactored to the bridged helpers (adapter stays). SSE orchestrator
  move + `store.notify` wiring **deferred to Phase 4** (see §14). Gate + smoke green. **DONE 2026-08-28.**

**Phase 4 — UI**  _(design: ARCHITECTURE §15)_
- [x] 4.1a `ui/grid.ts` — pure per-cell model (`classifyCell`, `isMine`, `cellClass`); +9 tests
  100% cov; `render()` + `refreshCell()` refactored to share it (removes the duplicated cell
  decision). New `ui/` gate layer (coverage 90/85). Gate + smoke green. **DONE 2026-08-28.**
- [x] 4.1b `ui/grid.ts` — `weekHeaderCells` (KW + weekday/date header columns, core/dates-only) and
  `classifyDot` (today-dot state, dedups render() vs refreshDot()). +5 tests 100% cov; `render()`
  header loop + dot and `refreshDot()` refactored to them. **Remaining row-header markup (cat/group
  header rows, star/status-tag/next-free buttons) left in the legacy adapter** — trivial interpolation
  over still-legacy presentation helpers (`esc`/`ic`/`catLabel`/`statusRangeText`/`daysMaskText`);
  extract once those helpers move (low logic value now, P3/E8). Gate + smoke green. **DONE 2026-08-28.**
- [x] 4.1c-1 reactive wiring (core) — `render` subscribed to the store in `app.ts` (guarded: no
  render before first data); `notify()` bridged; the data-change paths (`refreshNow`, SSE
  `structural`) route through the store instead of calling `render()` directly. Delivers the
  deferred 3.3 goal (SSE/refresh → store → notify → render). Gate + smoke green. **DONE 2026-08-28.**
- [x] 4.1c-2 reactive wiring (rest) — migrated all remaining direct `render()` calls to `notify()`
  (27 sites). `render()` now appears only as its definition + the two internal overflow/grow loops
  (`ensureOverflow`, keyboard grow-right, kept direct by design) + the store subscription. Every
  user-facing repaint flows through the store. Gate + smoke green. **DONE 2026-08-29.**
- [x] 4.2a `ui/selection.ts` — pure rectangle geometry (`computeSelCells` injected with `visM`/`visD`)
  + `clampIndex` (the arrow-key move/extend clamp, used for row and column). 8 tests, 100% cov;
  bridged; browser smoke drove a real drag (`.sel`=4, `.kfocus`=1 via `paintSel`), ArrowRight moved one
  column, ArrowUp clamped at the top row; console clean; `rev` unchanged (23). **DONE 2026-08-29.**
- [x] 4.2b `ui/navigation.ts` — pure next-free scan geometry (`nextFreeDay`/`prevFreeDay`, machine
  bookability injected as a predicate — E4). 11 tests, 100% cov; legacy `nextFreeAfter`/`prevFreeBefore`
  now thin wrappers over the bridged fns; browser smoke drove real ⏭/⏮ jumps (08-31→09-01→08-31, prev
  never before today), wrapper≡pure cross-checked live, `rev` unchanged (23). Week-nav/growth DOM
  (`prependWeek`/`ensureOverflow`/scroll) stays in the legacy adapter (E8). **DONE 2026-08-29.**
- [x] 4.3 `ui/views/*` — view-model kernels extracted (one per commit): my-bookings (`computeMyRuns`),
  stats (`computeStats`), all-bookings (`computeAllRuns`+`filterAllRuns`), admin (`filterAdminMachines`),
  machine-text (`maintText`/`statusRangeText`/`daysMaskText`). All 100% cov + smoked, `rev` never moved.
  Trivial modal markup (Log/Help/Settings/booking-detail) + the write-path reducers (`submitBooking`,
  machine-form save, reorder) intentionally deferred to Phase 5 (§15 scope; write-paths → `core/booking`).
  **DONE 2026-08-29.**

**Phase 5 — Polish + write-path reducers**
- [x] 5.1 `core/booking.ts` — extracted **all eight** write-path reducers (not just the three planned):
  `bookCells` (submitBooking conflict/apply, ts+gid injected), the four distinct delete reducers
  (`deleteCells` exact / `deleteOwnCells` ci / `deleteSelectedCells` cell-list / `deleteGroup` by-gid — so
  **every** `sweepWeekends` caller now lives in core), and machine CRUD (`saveMachine`/`deleteMachine`/
  `moveMachine`). 43 tests, 100% cov. Gate-only + clone-smoke (no production write); `rev` 23. **DONE 2026-08-29.**
- [x] 5.2 deleted dead FS-era code (`writeFile`/`S.handle`/`lastRaw`/`lastMtime` + empty stubs
  `setupFileObserver`/`startRefreshTimer` and the stub call in `startUI`); `lastRaw` dropped from
  `AppState`/`hydrateState`/tests. legacy.js 2712→2362. knip clean on gated layers; boot identical, `rev` 23.
  Modal-markup folding + `AS_TREE` retirement **deferred with rationale** (§16: low-value / real migration).
  **DONE 2026-08-29.**
- [x] 5.3 `knip` promoted into `verify` (`… && lint && deadcode && test:cov`); knip.json tidied to zero
  findings (dropped stale `legacy.ts` ignore + Phase-6 `server/*.ts` entries, `ignoreExportsUsedInFile`,
  auto-entry via Vite plugin). Repo-wide coverage floor (90/85) added under the layer globs. CSS/HTML tidy
  deferred (E8 — no dead-CSS need, restyle risks visual drift). **DONE 2026-08-29.** **Phase 5 COMPLETE.**

**Phase 6 — Backend → TypeScript**
- [x] 6.1 `server/` conversion — `db.ts`/`model.ts`/`mutate.ts` (pure, unit-tested against in-memory
  SQLite; 31 tests incl. concurrency/compare-and-set/validation/rollback) + the impure entry shells
  `server.ts`/`import.ts`. `node:sqlite` loaded via `createRequire`. **DONE 2026-08-29.**
- [x] 6.2 `src/` deleted; gate exclusions removed (eslint/knip/tsconfig); `tsconfig.server.json` + Dockerfile
  compile `server/*.ts` → `dist/server`; runtime runs `node server/server.js`. Full gate covers the backend
  (99.4% lines / 90.9% branch). Validated on a throwaway image (isolated port+volume); prod untouched. **DONE 2026-08-29.**
- [x] 6.3 **Server-authoritative weekend auto-bridging** (feature; scope = *maintain + backfill*).
  `server/bridge.ts`: pure `missingBridges` (recovered baseline logic) + `maintainBridges` (in-transaction,
  ON CONFLICT DO NOTHING) + `backfillBridges`. Maintain wired into `applyCells` (bridges the affected
  machines after a write, appended to the broadcast `changes`; `applied` stays the client count), behind
  `WEEKEND_BRIDGE` env (on unless `off`). Backfill = `server/backfill.ts` CLI (`npm run backfill`).
  10 tests. Validated on the compiled image: a Fri+Mon booking auto-bridged Sat/Sun with the Friday's name;
  backfill inserted 1782 legacy bridges — all on a **temp** DB. **Live backfill NOT run — awaits authorization.**
  **DONE 2026-08-29.**

## Deferred features (decided, scheduled — not yet built)

### Server-authoritative weekend auto-bridging  → Phase 6.3 — **BUILT 2026-08-29** (`server/bridge.ts`)
**Decision (2026-08-28):** scope = **maintain + backfill** (full). **Status:** implemented, gated, and
validated on a throwaway image (§17). The maintain hook goes live on the next deploy (toggle `WEEKEND_BRIDGE`);
the one-time backfill (`npm run backfill`, ~1.8k bridges) is a production write and **awaits authorization**.
The facts below are kept for reference.

**What it is.** A weekend day (Sat/Sun) should be booked as part of any continuous Fri→Mon
series (see `core/weekend.ts` `sweepWeekends`, which already REMOVES orphaned weekend days on
every client write). "Auto-bridging" is the ADD direction: when a Fri→Mon span exists, the Sat/Sun
between them should be filled (carrying the Friday booking's name). Today the ADD direction does
not happen at all.

**Design (server owns the invariant):**
1. **Maintain (going forward):** in the `/api/mutate` cell path, within the same transaction,
   when a write completes a Fri→Mon span, insert the two weekend days (same name). Symmetric
   triggers: booking a Friday whose Monday is already booked, or a Monday whose Friday is already
   booked, fills that weekend. (Optionally also move the orphan-sweep server-side for full
   authority; the client sweep can then be retired.)
2. **Backfill (one-time):** a server-side pass computing all missing bridges and inserting them in
   a single DB transaction — internal SQL, so NOT subject to the API's 1000-cell/batch cap.

**Grounded facts (from live data @ rev 23):**
- **1,794** missing bridges across **245** machines; **0** have empty names.
- The old client migration (`migrateWeekends`, removed in 2.3) tried to POST all 1,794 in one
  `/api/mutate` call and got **HTTP 400** — cause: the server caps a batch at **1,000 cells**
  (`src/server.mjs` ~line 133, `Zu viele Zellen (max. 1000)`). 1794 > 1000. (NOT a name/availability
  problem — the server only turns blocked days into *conflicts*, never 400s.)

**Principled build:** put the pure bridge computation (the old `missingWeekendBridges` logic,
removed in 2.3 — recover from git if useful) in a **tested** module the TS backend uses; keep the
removed client-side migrations gone. Safety: daily VACUUM backup exists; backfill is reversible via
restore, and the sweep removes bridges automatically if a series later breaks.

**Phase 8 — Naming & structure clarity (`PRINCIPLES.md` E9/E10)**
User-driven code-review pass (2026-09-02): the codebase has real anti-patterns — machine CRUD
reducers hiding inside `booking.ts` with no `machines.ts` mutation-side counterpart (breaking the
`booking.ts`/`booking-queries.ts` pairing E10 now names), and `mid`/`gid`/`n`/`dir`-style
unexplained abbreviations spread across ~46 files. Two principles now govern the fix (E9, E10);
this is their systematic application, file by file, one commit per safe-to-isolate module.

**Scope boundary — decided once, applied everywhere (do not re-litigate per file):**
Renaming is a plain identifier change UNLESS it touches something already fixed elsewhere,
which turns it into a data-shape change:
- **Stays exactly as-is:** SQL DDL/DML text (`server/db.ts`'s `CREATE TABLE`/column names,
  every `db.prepare(...)` string) — a real column rename needs a migration, out of scope here.
- **Stays exactly as-is:** `server/types.ts`'s `MachineRow`/`BookingRow` (typed 1:1 against a raw
  `SELECT *`) — same precedent the file already sets itself (`grp` stays raw there; `group` is
  the cleaned-up name one layer out, in `MachineOut`).
- **Stays exactly as-is:** `shared/types.ts`'s `Machine`/`Booking`/`MaintSlot` fields (`gid`,
  `gtitle`, `redu`, `cat`, `maint`, `days`) — these are the literal at-rest shape of the bundled
  seed `buchungen.json` and round-trip through `/api/state` unchanged; renaming needs an
  import/export transform, not a naming pass. Each gets/keeps a doc-comment carrying the clarity
  its name can't (most already do).
- **Renamed, in lockstep client+server, same commit:** every *live, non-persisted* wire shape —
  `/api/mutate` request cells (`CellDelta.mid`), its conflict/change response arrays
  (`MutateConflict`/`MutateChange`), the SSE change/presence payloads, and the `data-mid` DOM
  attribute the grid renders and every interaction/patch module queries by. None of these are
  ever written to disk verbatim; both ends of each always deploy together, so there's no
  compatibility window to break.
- **Renamed freely, no coordination needed:** every local variable, function parameter, and
  purely in-memory/computed type (`CellUndo`, `CellRef`, `BookingGroup`, `Bridge` — the last
  feeds `db.prepare(...).run(...)` **positionally**, so its field names carry no SQL meaning) —
  the vast majority of the ~46 files.

**Backlog:**
- [x] 8.1 Split `core/machines.ts`: the pure predicates it already holds move to
  `core/machines-queries.ts` (naming mirrors `booking-queries.ts` exactly); the machine-CRUD
  reducers currently mislabeled inside `booking.ts` (`saveMachine`, `deleteMachine`,
  `moveMachine`, `MachineForm`, and their private helpers) move into a new `core/machines.ts`.
  `booking.ts`'s header comment is trimmed to what it actually still owns. `moveMachine` also
  gets a doc-comment/readability pass in the move (the concrete example that started this phase).
  **Superseded by 8.1r below — see that entry.**
- [x] 8.1r **Revision**: merged the query/mutation split back into one file per domain
  (`PRINCIPLES.md` E10 rewritten). `core/machines.ts` + `core/machines-queries.ts` →
  `core/machines.ts`; `core/booking.ts` + `core/booking-queries.ts` → `core/bookings.ts` (new
  plural name, matching `shared/types.ts`/`shared/dates.ts`/`web/js/state.ts`'s convention),
  each sectioned internally (types / queries / mutations). Reason for reverting 8.1's own split:
  its stated justification — staying under the `max-lines` ESLint budget (400) — doesn't hold in
  practice (both merge back to well under 300 effective lines); what the split cost was the "one
  place to look for this domain" property. Every real importer (39 import sites across
  `web/js/ui/`, `web/js/ui/components/`, `server/model.ts`) repointed; all four old files and
  their tests deleted, contents merged into `machines.test.ts`/new `bookings.test.ts`.
- [x] 8.2 Rename `mid`→`machineId`, `gid`→`groupId` across every file the scope boundary above
  clears — one large mechanical commit (a partial rename doesn't type-check, so it can't be
  split further without breaking `HEAD` green). Includes the `data-mid` DOM attribute and the
  wire-shape structs named above, updated in lockstep. Excludes everything the boundary keeps.
- [x] 8.3 Rename `findConflicts` → `findBookingConflicts` (core/booking.ts) — states *what* it
  finds conflicts in, not just that it finds them.
- [x] 8.4a Bare `n`/`dir`/`id` — the two-domain sweep, done: `bookings.ts`'s four delete
  reducers' `{ n, undo }` result → `{ deletedCount, undo }` (also fixed in `ui/mutate.ts`'s
  `MutateResult` mirror type, and every consumer: `BookingDetailModal.tsx`, `ContextMenu.tsx`,
  `MyBookingsModal.tsx` + their tests). `AdminModal.tsx`'s `onMove: (id, dir)` →
  `(machineId, direction)`, matching `core/machines.ts`'s `moveMachine` signature it calls.
  `server/server.ts`'s presence broadcast `{ n: clients.size }` → `{ clientCount }` (confirmed
  dead-on-the-wire first — `live-connection.ts`'s presence handler only ever reads `.users`, so
  this was a safe rename, not a coordinated client+server one).
- [x] 8.4b `web/js/ui/views/stats.ts`'s `StatsMachineRow`/`StatsMaintRow`: `m`→`machine`,
  `n`→`bookedWorkdayCount` (already the local var name), `inst`→`slotCount`, `pct`→`percent`.
  Updated every consumer: `StatsDrilldown.tsx`, `StatsModal.tsx`, `StatsOverviews.tsx`,
  `stats.test.ts`. Separately, `web/js/ui/views/all-bookings.ts`'s `AllRun` and
  `my-bookings.ts`'s `BookingRun` (two distinct types, same bare `.m` field) both →
  `machine`, across `AllBookingsModal.tsx`, `MyBookingsModal.tsx`,
  `all-bookings.test.ts`/`my-bookings.test.ts`. `npm run verify` green, 797/797 tests.
- [x] 8.4c Rescanned for anything else in the same vein; found little — `el` (DOM element) and
  `req`/`res` (Node's request/response) are the standard idiom for this domain and were
  deliberately left alone, not renamed. Fixed the two real small findings: `selection.ts`'s
  `clampIndex(idx, len)` → `(index, length)`; `debug-panel.ts`'s `handleError(ctx, err)` → `(source,
  err)` (`ctx` wasn't a React/JS context object, just a short origin tag like `'sse/presence'`).
  Noted but deliberately NOT done here — a separate, bigger candidate: the `/api/mutate` wire
  types (`CellDelta.val`, `MutateChange.val`, `CellUndo.prev`) still use bare `val`/`prev`, same
  category as the Phase 8.2 `mid`/`gid` rename (a live, non-persisted wire shape, renamable in
  lockstep client+server) — scope it properly if it's ever picked up. **Phase 8 (naming &
  structure clarity) is now complete.**

**Phase 9 — REST API (user-requested design, full plan discussed 2026-09-02/03) — COMPLETE**
A genuine `/api/v1/*` REST surface alongside the existing `/api/state`/`/api/mutate`/`/api/stream`
trio, NOT replacing it — that trio is the live grid's own sync protocol (batch CAS writes, full-
state reads, SSE push) and stays exactly as-is; REST is for external tooling/scripts/admin use
that wants single-resource semantics instead. Full reasoning (resource list, endpoint map, status
codes, auth stance, versioning, testing strategy) was worked out in conversation and isn't
re-derived here — this backlog is the executable summary.

- [x] 9a Routing plumbing, zero endpoints yet — `server/api-router.ts` (`matchRoute`/`findRoute`,
  a `:param`-segment matcher over a plain route-array, no router dependency) and
  `server/api-response.ts` (`apiSuccess`/`apiError`, the `{data}` / `{error,code,details?}`
  envelope, `ApiErrorCode` = VALIDATION/NOT_FOUND/CONFLICT/PRECONDITION_FAILED/INTERNAL). Not
  wired into `server.ts` at all yet — that starts in 9b. `npm run verify` green, 818/818 tests,
  100% coverage on both new modules (21 new tests).
- [x] 9b `GET /api/v1/machines` (filters: `?category=`, `?group=`, `?status=`, combinable;
  `?sort=name`, German collation; otherwise DB order) and `GET /api/v1/machines/:id` (404
  `NOT_FOUND` naming the id) — `server/api-machines.ts`, reusing `model.ts`'s existing
  `machineOut` wire mapper (a REST machine is the exact `/api/state` shape, not a parallel
  contract). Wired into `server.ts`'s dispatch via `findRoute`/`apiV1Routes`, extracted into a
  `tryApiV1` helper to stay under the complexity budget once the branch count grew.
  **Real gap found and fixed**: the new files used `.ts` import extensions (correct for
  vitest, which `npm run check`'s tsconfig also tolerates) instead of the `.js` extensions
  `tsconfig.server.json`'s stricter Node-ESM resolution requires (matching every existing
  `server/*.ts` file's own imports) — `npm run verify` doesn't run `build:server`, so this
  passed the gate clean and only surfaced when the production Docker image was actually built
  for the smoke test. Fixed; confirmed live afterward against a throwaway container with real
  seed data: `GET /api/v1/machines` → 245 machines, `GET /api/v1/machines/:id` → 200 for a real
  id / 404 `{code: "NOT_FOUND"}` for a bogus one, `?category=messtechnik` → 150, and the legacy
  `/api/state` still 200s unchanged. **Worth remembering**: `npm run verify` alone doesn't prove
  a server change actually builds for production — run `docker compose build` (or the full
  smoke pattern above) before considering a server-side slice done, not just `npm run check`.
  `npm run verify` green: 827/827 tests (9 new), 100% coverage on `api-machines.ts`.
- [x] 9c `server/api-bookings.ts`. `GET /api/v1/machines/:id/bookings` — `?from=&to=` both
  required (400 `VALIDATION` otherwise, or if `from > to`), 404 if the machine doesn't exist,
  empty array (not an error) for a range with nothing booked. `GET
  /api/v1/machines/:id/bookings/:date` — 404 for an unknown machine, 400 for a malformed date,
  404 for a free cell (no booking resource at that address yet). `GET
  /api/v1/bookings?groupId=` — 400 without `groupId`, direct SQL on the existing `gid` index
  rather than routing through the client's pure `core/bookings.ts` query logic (which expects
  an in-memory `Bookings` map the server never builds). Wired into `server.ts`'s route table;
  `DAY_RE` exported from `mutate.ts` rather than redefined, one source of truth for "valid ISO
  day". `npm run build:server` checked directly before the docker build this time (the 9b
  lesson) — clean on the first try. Verified live against a throwaway container: booked two
  real cells sharing a `gid` via `/api/mutate`, then all three endpoints returned exactly the
  expected data/errors (400s, 404s, the range list, the single cell, the cross-machine group
  list). `npm run verify` green: 839/839 tests (12 new), 100% coverage on `api-bookings.ts`.
- [x] 9d `GET /api/v1/activity` — `server/api-activity.ts`. The `log` table is the one genuinely
  unbounded, append-only collection in the app (unlike `machines`, a few hundred rows, or one
  machine's bookings, naturally bounded by a date range), so cursor pagination on its own
  autoincrement `id` is the fit, not offset/limit: `?cursor=` is the previous page's last-seen
  `id` (strictly older, since ordering is `id DESC`), `?limit=` (default 50, max 200, clamped
  not rejected), `?user=` and `?since=` (ISO-string `ts >=`) filters, combinable. Fetches
  `limit + 1` rows to detect "more pages" without a second COUNT query; `meta.nextCursor` is
  present only when there actually is a next page (omitted entirely otherwise, not `null`) —
  needed extending `apiSuccess(data, status, meta?)` with that third optional parameter in
  `api-response.ts`, same omit-when-absent convention as `apiError`'s `details`. New `LogRow`
  type in `server/types.ts` alongside `MachineRow`/`BookingRow`. `npm run build:server` checked
  directly before the docker build (still following the 9b lesson) — clean on the first try.
  Verified live against a throwaway container: the fresh container's own first-run import log
  entry, then 5 more generated via real `/api/mutate` bookings — default listing came back
  newest-first (6 entries, import last); `?user=smoketester` filtered to the 5; `?limit=2` paged
  correctly across two calls following `nextCursor` (entries 6,5 then 4,3, no overlap); `?since=`
  returned exactly the entries at/after the given timestamp; non-numeric `?limit=`/`?cursor=`
  both 400 `VALIDATION`; the 9b/9c endpoints re-checked unaffected. `npm run verify` green:
  850/850 tests (11 new — 9 for `listActivity`, 2 for `apiSuccess`'s `meta`), 100%
  statement/function/line coverage on `api-activity.ts` (branch coverage 88.88%: the
  `activityOut` mapper's `row.ts/user/action || ''` null-fallbacks are unreachable in practice —
  every writer already supplies real values — left as defensive rather than chased for 100%,
  since the schema technically allows null and `verify`'s aggregate 90/85 floor was already met).
- [x] 9e+9f Write endpoints — `server/api-machines-write.ts`, `server/api-bookings-write.ts`,
  `server/api-write-helpers.ts` (landed together: both re-derived the exact same "read current
  state, apply one in-memory change, hand it to `applyMutate`" shape, so building them side by
  side kept that shape honest instead of guessing at it twice).
  - **9e** `POST/PUT/DELETE /api/v1/machines`, `POST /api/v1/machines/:id/move`. Not a second
    write engine: each handler reads the full current machine list (`machineOut`-mapped, same
    wire shape `/api/v1/machines` already returns), applies one change to it in memory — reducers
    ported field-for-field from `core/machines.ts`'s `saveMachine`/`deleteMachine`/`moveMachine`
    (slugify, group-insertion index, the legacy-status-clearing `applyFormFieldsToMachine`) the
    same way `model.ts`'s `blockReason` ports rather than imports client logic (server code never
    imports `web/js/*`) — then hands the whole list to `applyMutate`'s existing structural path.
    That one call is doing all the real work: validation/clamping (`insertMachine`/`cleanMaint`),
    the transaction, the revision bump, the SSE broadcast, and the activity log, so these REST
    handlers add only the REST-specific shell (id-lookup 404s, a 409 `CONFLICT` for a move that
    would run off the list or cross a group boundary, mapping `applyMutate`'s error string to 400
    `VALIDATION`). A REST write without an explicit `log` auto-generates one tagged `(REST)` (e.g.
    `Maschine angelegt: X (REST)`) in the same German phrasing the UI's own save/delete/move
    already log, so `GET /api/v1/activity` reads the same regardless of origin.
  - **9f** `PUT`/`DELETE /api/v1/machines/:id/bookings/:date`, `POST /api/v1/bookings/batch`,
    `POST /api/v1/bookings/batch-delete`. Every write is one `applyMutate` cell-delta call — the
    exact path the grid's own booking clicks use — so blocked-day checks, "never overwrite a
    foreign booking" by name, weekend bridging, the broadcast, and the log all come for free.
    Added an `ETag`/`If-Match` CAS layer on top (new: `bookingEtag(row)` in `api-bookings.ts`,
    `"empty"` for a free cell else derived from the booking's own name+ts; `GET
    .../bookings/:date` now returns it as a response header) — given, a stale `If-Match` is
    refused with 412 before the write is even attempted; omitted, the write is unconditional
    (falling back to `applyMutate`'s own same-name-only-overwrite rule, which still applies
    either way). Batch book reports `{applied, conflicts}` and is 207 Multi-Status when some
    cells conflicted, 200 when all applied cleanly; batch-delete is unconditional (no per-cell
    `If-Match`; the single-cell DELETE is for that) and reports only `applied`.
  - Extended `ApiRoute`/`ApiResponse` (`api-router.ts`) with `body`/`headers` on the request side
    and an optional `headers` on the response side — additive, so every existing GET-only route
    handler (fewer params than the type) kept compiling unchanged. Generalized `server.ts`'s
    `readBody` to `Promise<unknown | null>` (was hard-typed to `MutateBody`) so `/api/v1/*` writes
    reuse the same body-reading/overflow/malformed-JSON handling `/api/mutate` already had,
    without a second copy of it.
  - `npm run build:server` checked directly before the docker build (still the 9b lesson) — clean
    on the first try. Verified live against a throwaway container with real seed data: created,
    updated, moved (409 on an invalid direction), and deleted a machine via REST, confirming each
    step in `GET /api/v1/activity`; booked a cell unconditionally, round-tripped its `ETag` via
    GET, confirmed a stale `If-Match` 412s and the correct one 200s, confirmed the existing
    same-name-conflict rule still 409s a REST write; batch-booked 2 cells clean (200), batch-
    booked 2 more with one conflicting (207, `applied:1`), batch-deleted 3 cells (`applied:3`).
    `npm run verify` green: 893/893 tests (57 new across the two write modules + the shared
    helpers), 100% statement/function/line coverage on every new file (`api-machines-write.ts`
    100/100/100/100; `api-bookings-write.ts` 100/89.55/100/100 branch — the handful of remaining
    branches are header-array edge cases and defensive fallbacks, not untested request paths;
    aggregate floor comfortably met either way).
- [x] 9g Auth decision: **not implementing it now** — a deliberate decision, not a skipped step.
  `/api/v1/*` runs on the same trusted network as the existing `/api/state`/`/api/mutate`/
  `/api/stream` trio, which has had zero auth since before this REST work started; nothing
  outside that network calls any of it today, so a bearer-token check right now would be
  speculative infrastructure with no concrete caller to protect against — exactly the kind of
  guardrail PRINCIPLES.md's simplicity ordering (Correctness/Security → Maintainability →
  **Simplicity** → …) argues against adding ahead of an actual need. It's also worth being
  precise about what it could even be: this app has no user table or login, so "auth" here can
  only ever be one shared secret gating all-or-nothing access to `/api/v1/*` — authentication,
  never per-user authorization (the `user`/`log` fields REST writes accept are, like `/api/mutate`
  today, an unauthenticated free-form display name, not an identity).
  **If a real external caller shows up later**, the concrete shape to add (sketched now so it
  isn't re-derived from scratch): an `API_BEARER_TOKEN` env var; `tryApiV1` in `server.ts` checks
  the request's `Authorization: Bearer <token>` header against it *before* calling `findRoute` —
  applied only to `/api/v1/*`, never to `/api/state`/`/api/mutate`/`/api/stream`, which keep
  serving the live grid unauthenticated exactly as now; a missing/wrong token is a new
  `ApiErrorCode` (`UNAUTHORIZED`) → 401, added to `api-response.ts`'s closed set at that time, not
  preemptively. When `API_BEARER_TOKEN` is unset (every deployment today), the check is skipped
  entirely — so adding it later is opt-in infrastructure, not a breaking change forced onto the
  current deployment.
- [x] 9h Hand-written `openapi.yaml` (repo root, alongside `ARCHITECTURE.md`/`PROGRESS.md`) —
  documentation only, no new runtime or dev dependency (`js-yaml`/`@apidevtools/swagger-cli` were
  used ad hoc via `npx` just to validate the file while writing it, never added to `package.json`).
  Covers all 9 `/api/v1/*` paths (14 operations: the 6 reads from 9a–9d plus the 8 writes from
  9e/9f) with request/response schemas, the shared `{data}`/`{error,code,details?}` envelope, the
  `If-Match`/`ETag` CAS headers, and the 9g auth decision noted in the doc's own description.
  Validated two ways: `js-yaml` parses it (catches YAML syntax mistakes — an unquoted flow-style
  description containing a comma broke the parse and was fixed), and `@apidevtools/swagger-cli
  validate` confirms it's schema-valid OpenAPI 3.0, not just parseable YAML.

**Phase 10 — Repo-wide comment/readability sweep (user-requested 2026-09-03) — SOURCE FILES
COMPLETE, superseded by Phase 11 for everything else.**
Rewrote every source file's comments (file header + per-function docs) to the verbose style
established when `web/js/core/machines.ts` was hand-rewritten: a banner file header, a "Key
Principles" summary, and per-function JSDoc with a one-line summary plus a numbered "How it
works" walkthrough. Landed as 10 sub-items (10a–10j, ~14 commits), one directory group at a
time, each comments-only and verify-green before moving on:
`shared/` → `core/` → `js/` root + `net/` → `ui/` top-level (2 parts) → `ui/components/`
(2 parts, all 28 files) → `ui/views/` → `server/api-*.ts` → `server/` the rest. Along the way,
fixed every stale "stays in legacy.js" / "faithful port of legacy X" comment left over from
Phase 7 deleting that file (grepped clean at the end — see Phase 11's audit below), while
preserving substantive historical notes (e.g. `stats.ts`'s category+group-bucketing bug-history
rationale) just reworded off "legacy" framing.
**What Phase 10 did NOT do — carried into Phase 11 below:** the "What/How" test-comment
convention it established (in `live-connection.test.ts`, the one file that got it) was never
retrofitted onto the other 67 test files, and Phase 10's brief was comments-only — it
deliberately left naming/structure/dead-code issues alone even when noticed. Full sub-item
history (10a–10j write-ups) is preserved in git history (`72c27b7`'s parent and earlier) rather
than repeated here.

**Phase 11 — Deep code-quality pass: naming, structure, dead code, and the test-comment
retrofit (user-requested 2026-09-03)**
Broader and stricter than Phase 10: not just comments, but the code itself — self-explanatory
names, no unexplained abbreviations, no "historic remnant" API surface (dead aliases, a
re-export nothing imports, a file split with one consumer), *and* finishes the "What/How"
test-comment retrofit Phase 10 left owed. See "Phase 11 methodology" below for how each item
is scoped, decided, and verified before it lands — the short version: every structural change
must be evidence-based (grep every real call site first) and behavior-preserving (tests still
pin the old behavior, `verify` green, one commit per module).
- [x] 11a `web/js/core/machines.ts` + `weekend.ts` (the user's three flagged examples,
  confirmed by tracing every real call site — full reasoning in commit `72c27b7`):
  merged `weekend.ts` into `bookings.ts` (`sweepWeekends` had exactly one consumer — E10);
  removed the dead `MaintenanceSlot` re-export (zero importers; `shared/types.ts` already
  exports it directly); simplified `MoveDirection` from `'up'|'down'|-1|1` to just `-1|1`
  (the string form was never produced by any real caller, only by tests); removed
  `MachineForm`'s four dead "nicer alias" fields (`category`/`redundancyGroup`/
  `weekdayAvailabilityMask`/`maintenanceSlots` — the real form-builder never constructs
  them, only the wire-named `cat`/`redu`/`daysMask`/`maint` siblings). `npm run verify`
  green: 889/889 tests unchanged, 68 test files (one merged in).
- [x] 11b Grep-based naming/dead-code audit across the rest of `web/js/` and `server/` —
  systematic search for abbreviation smells (E9), leftover re-exports, and single-consumer
  file splits, beyond the three examples already fixed in 11a. (11a's own audit found the
  rest of the tree already clean — no further short-name or dead-re-export hits outside
  CSS class-name string literals, which are out of scope; recorded here so the check itself
  is on record, not just its one positive result.)
- [x] 11c–11x "What/How" test-comment retrofit — **COMPLETE**, all 68 test files. Landed as
  ~20 commits, one directory group at a time (mirroring Phase 10's own grouping): `shared/`
  → `web/js/core/` → `web/js/` root + `net/` → `web/js/ui/` top-level (24 files) →
  `web/js/ui/components/` (17 files) → `web/js/ui/views/` (4 files) → `server/` (13 files).
  Every `it(...)` in every test file now has a `// What: <behavior/invariant this pins>` /
  `// How: <setup/action/assertion approach>` pair above it, per the template established in
  `web/js/ui/live-connection.test.ts` back in Phase 10. Along the way, fixed two more stale
  "(still-legacy)" references found in test descriptions/comments
  (`AdminModal.test.tsx`, `MyBookingsModal.test.tsx` — `MachineFormModal.tsx`/`mutate.ts` are
  fully ported, not legacy). Comments-only throughout; no behavior change. `npm run
  build:server` clean and `npm run verify` green (889/889 tests, 68 files) after every commit.

**Phase 11 is now COMPLETE.** Both directives from the user's original request are done:
naming/structure/dead-code cleanup (11a/11b — the three flagged examples fixed, the rest of
the tree audited and found already clean) and the full What/How test-comment retrofit
(11c–11x — all 68 test files). Every source file under `web/js/` and `server/` now carries
the machines.ts-style banner/JSDoc comments (Phase 10), and every test file now carries
What/How comments on each of its test cases (Phase 11) — the two-part "readability sweep"
directive the user gave is fully executed end to end.

**Phase 11 methodology** (how a structural finding gets decided, not just a comment rewrite):
1. **Notice** — a name, split, or export that doesn't explain itself, found either by a grep
   sweep (abbreviation patterns, `legacy` mentions, `export type {` re-exports) or by reading
   a file closely while doing the test-comment pass.
2. **Trace every real call site** (`grep`, not assumption) before deciding it's dead or
   redundant — a field/export used only by its own test file is dead in production even if a
   test exercises it; a field used by exactly one other file is a merge candidate, not
   automatically wrong (CLI entry points, cross-cutting helpers like
   `server/api-write-helpers.ts`, and genuinely-distinct single-purpose UI widgets are
   legitimate one-consumer files — E10 is about a *domain* split into pieces, not "every
   small file is suspect").
3. **Decide against the wire-naming exemption (E9) and the domain-file rule (E10)** before
   touching anything — both are already-settled project rules, not this pass's to
   re-litigate.
4. **Fix with tests first when behavior could change**; comment-only and dead-code-removal
   changes still get a full `verify` run (and `build:server` when `server/` is touched)
   before committing, same gate as every other module.
5. **One commit per finding or small group of related findings**, explaining the evidence
   (not just the conclusion) in the commit message — so a future reader can check the
   reasoning without re-deriving it.

**Phase 12 — User-requested feature/UX batch (2026-09-03) — COMPLETE**
Seven items from a single user request (numbered 1–7 in the request, "item 5" arrived as a
follow-up German-language spec mid-turn), each its own commit via the normal per-module loop
(test-first where behavior changed, full `verify` + browser-reasoning before every commit).
- [x] 12.1 `MyBookingsModal.tsx` restyled to match `AllBookingsModal`'s row card layout
  (`.abmach`/`.abdate` inside `.mybk`): bold machine name + group on top, date range below —
  the group was never shown at all in the old single-line layout. `RunHead` split into
  `RunHead`/`RunCardBody` to stay under the function-length budget. Commit `115de80`.
- [x] 12.2 `AllBookingsModal`'s "Bereich" filter can now select a whole top-level category
  (`Maschinen (alle Bereiche)` / `Messtechnik (alle Bereiche)`), not just one department
  group — a `cat:<id>` prefix on `AllBookingsFilter.group` (`CATEGORY_FILTER_PREFIX`,
  `views/all-bookings.ts`), dispatched in `filterAllRuns` via `getMachineCategory`. Commit
  `939a925`.
- [x] 12.3 `BookingDetailModal`'s "Statistik" button moved from the "Gebucht von" row to the
  "Maschine" row (same behavior, different placement). Commit `600fbdd`.
- [x] 12.4 Stats' "Personen" mode tab hidden (commented out in `StatsControls.tsx`, not
  deleted) — still reachable via a booking's Statistik button (`openStats(presetPerson)`)
  straight into a person's drilldown, and from there "← Übersicht" reaches the bare overview.
  Commit `098e01d`.
- [x] 12.5 Assistant redesign (5 sub-items from the user's own itemized German spec): a
  two-column desktop layout (`#modal:has(.assist-columns)` widens only this modal); drag
  handles (⋮⋮) + dashed drop-zone highlights replacing all explanatory drag-and-drop prose;
  demand groups restyled as neutral cards (the old per-group `AS_HUES` color palette removed
  outright — `AssistGrp.color`, `groupNodeOnto`'s `newColor` param — not just hidden), need
  label shortened to "Benötigt: N von M", dissolve button switched to icon-only; the
  checklist's already-whole-row-clickable `<label>` rows got more generous padding; suggested
  devices in results render as colored pill badges (`nameColor`-derived) directly under the
  date instead of a "Vorschlag: …" text line. Extracted `ui/theme.ts`'s `isDarkTheme()` (read
  side of `applyTheme`) so `AssistantResults.tsx` and `GridBody.tsx` share one implementation
  instead of a second private copy. Commit `4fe5064`.
- [x] 12.6 Stats visual upgrade: `StatBar`'s new `colorByUtilization` prop traffic-lights the
  Ressourcen overview's machine bars (yellow <60%, green 60–85%, red >85%) — deliberately not
  applied to the other `StatBar` usages, which show a percent relative to the list's own top
  scorer rather than a genuine utilisation rate. Category filter switched from the `seg`
  segmented-control style to a new `pillrow` style, visually separating it from the primary
  Ressourcen/Wartung tab row. `.statgrp` (group headers) gained background/text contrast;
  `.pct`/`.statgrp` gained `tabular-nums`. Commit `5049748`.
- [x] 12.7 Main grid: (a) a new Settings toggle ("Rasterlinien abschwächen", off by default)
  swaps the cell grid's border color to a much lighter grey via a new `--gridline` token,
  independent of and separate from (b) the always-on consolidation of continuous same-name
  multi-day bookings into one seamless bar with the name centered once — new pure
  `weekBookingBarSegments` (`ui/grid.ts`), scoped to one displayed week (weeks are already
  visually separated by their own gap column). Every cell keeps its own `data-machine-id`/
  `data-date`/click handling — only the border and the printed name change, nothing about the
  grid's DOM/interaction contract. Commits `ad17713` (toggle), `da8fb2c` (merge).

`npm run verify` green after every commit; 68 files / 906 tests at the end of the batch (up
from 891 at the start — Phase 11's parting count plus the `grid-interaction.ts` fix commit
`eb0165a` and the externally-edited-comment commit `f9c58cd`, both from the session
immediately before this phase).

**Phase 13 — Second user-requested feature/UX batch, post-deploy feedback (2026-09-03) —
COMPLETE**
Phase 12 was deployed to production (`docker compose up -d --build`, user-authorized) and
tested live; this phase is the user's follow-up feedback from that testing session. Five
items, landed as 3 commits (some combined where they shared `app.css` and couldn't be usefully
split further).
- [x] 13.1 `MyBookingsModal`: booking groups are now detected and displayed (a "Teil einer
  Buchungsgruppe" hint, mirroring `BookingDetailModal.tsx`, shown only when a run's group
  genuinely spans more than one machine); the expand chip moved from the date line to the
  right side, under the pin button; a filter row (Maschine/Bereich/Sortieren/Von/Bis) was
  added, matching All Bookings' own minus the Person field. The Bereich filter's
  group-or-category matching rule moved from `views/all-bookings.ts` to
  `core/machines.ts` (`CATEGORY_FILTER_PREFIX`/`matchesGroupFilter`) as shared groundwork,
  since both modals now need the identical rule. Commit `0a2bb65`.
- [x] 13.2 Grid: the "KW X" header is now sticky on the left edge while its own week's columns
  scroll through — previously it scrolled away with no way to tell which week was in view past
  the first column. Commit `738bffe`.
- [x] 13.3 Settings: the grid-line control changed from an on/off "soften" checkbox to a 0–4px
  thickness slider (`--gridline-width`), replacing the `body.softgrid` mechanism from Phase 12
  outright. Commit `738bffe`.
- [x] 13.4 Grid: booking blocks now merge in two dimensions, not just across days — a new
  `computeBookingBlocks` (`ui/grid.ts`, replacing Phase 12's `weekBookingBarSegments`) finds
  the maximal rectangle of same-name, same-date-range bookings across BOTH calendar-adjacent
  days and vertically-adjacent visible machine rows, centering the name once in the whole
  rectangle; a category/group header row genuinely breaks vertical adjacency (kept in the row
  list passed to the algorithm with an always-null `nameAt`, specifically so it counts as a
  real break, not a filtered-out gap a filtered machine correctly WOULD close). Also fixed a
  real bug this surfaced: the "mine" accent had stayed a plain `outline` (Phase 12), which
  can't be suppressed per-side, so it drew a full box around every day of an already-merged
  block — now four independently-overridable box-shadow layers composed through CSS custom
  properties, which also fixed a latent, unrelated collision with the weekend-tint's own
  box-shadow that the naive version would have introduced. Commit `738bffe`.
- [x] 13.5 Assistant: restructured into a card-based dashboard layout (light-grey backdrop,
  white cards for Geräteauswahl/Buchungsparameter/Ausgewählte Geräte, scoped to just this
  modal via `#modal:has(.assist-columns)`), with the primary action anchored at the bottom of
  the right column — per the user's own "modern SaaS dashboard" reference. Commit `7282aeb`.

`npm run verify` green after every commit; 68 files / 933 tests at the end of the batch.

**Phase 14 — Tailwind CSS + shadcn/ui-pattern components, piloted on the Booking Assistant
(user-requested 2026-09-04) — IN PROGRESS**
The project owner wants the frontend to move toward component-library-based UI going forward
(reui.io prompted the conversation; shadcn/ui — Tailwind CSS + Radix-based primitives you copy
into the repo and own, not an npm black box — was settled on as the actual model). Scoped as a
**pilot on one screen** (the Booking Assistant, `web/js/ui/components/Assistant{Modal,Tree,
Checklist,Results}.tsx`), not a full replatform; `web/css/app.css` stays in place and is retired
incrementally, primitive-class first (buttons → inputs → dropdowns → cards → modals → nav →
machine cards → booking UI → calendar → tables → remaining misc CSS), never a big-bang rewrite.
Full reasoning (why Tailwind/shadcn vs. reui directly, the guardrail-change decision, why this
scope, why this CSS strategy) worked out in conversation; the guardrail change itself is
`ARCHITECTURE.md` §19. Grounded by an Explore pass over the actual repo before any code
landed: no existing path alias/PostCSS wiring, `web/js/ui/**` faces the 90/85 coverage floor
with no import-boundary restriction, the 925-line `AssistantModal.test.tsx` queries buttons/
checkboxes by role+accessible name (safe to restyle) but asserts many literal class names
(`.asdev`, `.asgrp*`, `#asWork`, `.aspill-name`, `.asRange`, `.asDays`, `.asNeed`, `.dragover*`,
`.cathead`, …) that must survive restyling, and `Icon.tsx`/`modal.tsx` are app-wide (20/14
importers) — out of scope for an Assistant-only pilot.
- [x] 14.1 Tooling foundation, no visible UI change: **Tailwind CSS v4** via `@tailwindcss/vite`
  (devDependency, build-time only — no guardrail conflict, `ARCHITECTURE §5` rule 6 already
  allows dev tooling). `web/css/tailwind.css` re-exposes app.css's *existing* design tokens
  (`--bg`, `--panel`, `--accent`, `--border`, `--muted`, …) as Tailwind theme colors via
  `@theme`, so `bg-panel`/`text-muted`/`border-border` utilities are pixel-identical to today —
  one palette, not two; a `@custom-variant dark` mirrors the app's existing
  `html[data-theme="dark"]` toggle (`web/js/ui/theme.ts`). Imported once from `web/js/app.ts`;
  `app.css`'s own `<link>` in `index.html` is untouched, the two coexist. `web/js/lib/utils.ts`
  — the standard shadcn `cn()` helper (`clsx` + `tailwind-merge`), tested. New runtime deps
  `class-variance-authority`/`clsx`/`tailwind-merge` — the guardrail change, `ARCHITECTURE §19`
  (CLAUDE.md's guardrail line updated to match). No path alias added: shadcn's usual `@/`-style
  generated imports get hand-adjusted to this repo's actual convention (relative, explicit
  `.ts`/`.tsx` extensions) as each primitive lands, keeping one import style app-wide.
- [x] 14.2 `web/js/ui/components/ui/button.tsx` — a shadcn Button trimmed to the three
  variants actually used (`default`/`primary`/`ghost` — not the originally-sketched
  `default`/`primary` only: the Assistant's "Abbrechen" button relied on a scoped app.css
  override, `.assist-actions .btn:not(.primary)`, that made it transparent/borderless; since
  it no longer carries the literal `.btn` class that override was keyed on, a `ghost` variant
  conserves that look explicitly instead of silently losing it) × `default`/`small` sizes, no
  `asChild`/Radix Slot. Applied to the Assistant's four `.btn`-classed buttons (Abbrechen,
  Freie Termine suchen, pin, Buchen…), preserving exact accessible names (tests query by
  role+name, not `.btn` class — verified safe by the exploration pass). The plan's parenthetical
  about also converting `.rm`/`.asstep` (dissolve/remove/stepper) was **not** followed — those
  never carried the `.btn` class to begin with (they're small bespoke icon/stepper controls,
  a different shape than "Button"), so they're out of scope here, not silently dropped.
- [x] 14.3 `web/js/ui/components/ui/input.tsx` — a thin native-`<input>` wrapper (no Radix),
  applied to the date-range/min-days/search/`.asNeed`/`.asDays` fields, passing the existing
  `.asNeed`/`.asDays` classes through via `cn()` so the test file's direct `.value` reads keep
  working unchanged. Landed in the same commit as 14.2 (both ended up touching the same four
  Assistant files once actually implemented — not usefully splittable, same rationale Phase 13
  used for its own shared-file commits).
  Verified: `npm run verify` green (1003 tests, 71 files); a throwaway `docker build` +
  Playwright screenshot of the real Assistant modal (light AND dark theme, real seeded data,
  zero console errors) confirmed the converted buttons/inputs render visually identical to the
  pre-Tailwind app.css styling.
- **Phase-boundary halt after 14.3** (per CLAUDE.md's per-phase cadence): reported back. Landed
  same day on production, then a real regression was found and fixed the same day too — see
  Known Bugs → Fixed, "Tailwind's Preflight inflated every `.btn`-classed element app-wide".

**Phase 14, revised direction — shadcn preset (`b6EWdD0CK8`) adopted in full (same day,
2026-09-04) — on fork branch `phase14-shadcn-preset`, halted before merge/deploy**
After 14.1–14.3 shipped, the project owner ran `shadcn@latest init --preset b6EWdD0CK8`
(tweakcn) on a new fork to try a real externally-designed setup. It pulled in far more than a
theme — **Base UI** (not Radix), **Tabler** icons, self-hosted **Inter**/**Manrope** fonts, a
full olive semantic palette, a duplicate `Button` at a different path, and it silently
overwrote the tested `web/js/lib/utils.ts`. **Decided: adopt it in full**, not a one-off theme
swap — full reasoning + guardrail rewrite in `ARCHITECTURE.md` §19 (revised). Reconciled
against 14.1–14.3's work in one combined pass (see the per-item notes for why some items that
were separate slices in the plan landed together):
- [x] **Token collision resolved.** app.css's own `--bg`/`--panel`/`--border`/`--text`/
  `--muted`/`--accent` (186 occurrences, `sed`-renamed with word-boundary precision, verified
  0 remaining bare collisions after) → `--app-*` prefixed, since the preset defines its own
  semantic tokens of the same bare names for a different (olive) palette — without the
  rename, every one of those 186 uses would've silently repainted with the preset's colors.
  4 real non-CSS references caught by grep (`grid.ts`'s `mineAccentLayers`, `ContextMenu.tsx`,
  `GroupFilterDropdown.tsx`, `MaintenanceSlotEditor.tsx` — all inline `style={{...}}` using
  `var(--accent)`/`var(--muted)`/`var(--border)` literally) updated to match.
- [x] **`Button`/`Input` reconciled.** The hand-rolled `web/js/ui/components/ui/{button,
  input}.tsx` (+ tests) from 14.2/14.3 deleted; the Assistant's four buttons + all its inputs
  repointed to the CLI-generated `web/js/components/ui/{button,input}.tsx` (Base UI-backed).
  Variant remapping: Base UI's `default` variant is a *filled* primary style (unlike the old
  primitive's plain-bordered `default`) — the pin button needed an explicit `variant="outline"`
  it didn't need before, or it would've silently rendered as a bold primary-colored button.
  `size="lg"` is exactly `h-9` (36px) — the manual `className="h-9"` height-parity hack from
  the Preflight-fix commit is gone, replaced by the real size prop; confirmed the existing
  height-parity regression test still passes unchanged (`size="lg"`'s own cva string still
  literally contains `h-9`). The two bare date inputs needed `className="w-auto"` since the
  new Input defaults to `w-full` (everything else — `.asNeed`/`.asDays`'s explicit inline
  widths, the `.assist-card input[type=…]{height:36px}` attribute-selector rule — already had
  higher-specificity app.css rules protecting them, confirmed by reasoning through the cascade
  then verifying visually, not assumed).
- [x] **`Icon.tsx` → Tabler, API unchanged.** All 21 names actually passed through the `Icon`
  component (enumerated from real call sites + `core/machines.ts`'s category icons +
  `assistant-checklist.ts`'s favorites star, not guessed) mapped to their Tabler equivalent;
  every Tabler export name confirmed to actually exist in the installed package before use
  (`IconWrench` doesn't exist — used `IconTool` instead). `className="ic"` is the only prop
  passed — CSS presentation properties (width/height/stroke/fill) always win over an SVG's own
  attributes, so every existing `.ic` rule (base + the context-scoped overrides in
  `.aswork-empty`/`#modalReopen`/`.stat-kpi`) keeps working with zero per-context prop
  replication. **Found and deliberately left alone**: 3 sprite symbols (`search`, `bug`, `cal`)
  have real non-`Icon`-component consumers (`web/index.html`'s own static `machBtn`/`dbgHead`
  markup, `ContextMenu.tsx`'s raw `<use>`, `MachineFilterDropdown.tsx`'s string-built HTML) —
  the sprite `<symbol>` defs stay in `index.html`, not deleted, since removing them would break
  those out-of-scope call sites. `eye` appears genuinely unused anywhere; also left alone
  (no speculative cleanup). New `Icon.test.tsx` (previously untested directly, only via other
  components' indirect coverage) — 3 tests incl. the unmapped-name defensive branch.
- [x] **Typography app-wide.** app.css's `body{font:14px/1.4 -apple-system,…}` shorthand split
  into `font-size:14px;line-height:1.4` with the system-font family dropped entirely, so the
  preset's `html{@apply font-sans}` (Inter Variable) cascades app-wide. **A real collision
  checked, not assumed**: the preset's own `@layer base{body{@apply bg-background
  text-foreground}}` targets the same `body` element app.css's `body{background,color}` rule
  does — confirmed via `getComputedStyle` that app.css's rule still wins (CSS Cascade Layers
  give *unlayered* styles priority over *any* layered style, regardless of selector specificity
  or source order — app.css was never wrapped in a Tailwind `@layer`), so body's actual
  background/text color stayed app.css's own `--app-bg`/`--app-text`, not the preset's, with no
  extra fix needed. Confirmed empirically, since this is exactly the class of thing the
  Preflight bug taught not to assume.
- [x] **`cn()`.** Kept the CLI-generated `web/js/lib/utils.ts` (`export { cn } from "cn"`)
  rather than reverting to the hand-written clsx+tailwind-merge version — every
  shadcn-generated file imports `cn` directly, not from `lib/utils`. `clsx`/`tailwind-merge`
  uninstalled (genuinely dead once nothing imports them directly).
- [x] **Guardrail + docs rewritten** — `ARCHITECTURE.md` §19 (revised, not appended twice),
  `CLAUDE.md`'s guardrail line, this section. `knip.json` `ignoreDependencies` extended for the
  CSS-only imports (`shadcn`, `tw-animate-css`, both `@fontsource-variable/*` packages — same
  pattern as `tailwindcss` from 14.1: referenced only via a CSS `@import`, invisible to knip's
  TS-only analysis).
- **Verified**: `npm run verify` green throughout (998 tests after the file churn — down from
  1006, net of the 9 deleted-file tests vs. the new Icon.test.tsx's 3). A throwaway
  `docker build` + real Playwright measurements confirmed the toolbar/`#btnAssist` match the
  pre-Phase-14 baseline (`ef7d334`: 29px/78px) **exactly**, and the Assistant's screenshots
  (light theme) look correct with the new Base UI/Tabler/Inter styling.

**Halted before merge to `master-2` or any deploy** (per CLAUDE.md's per-phase cadence — a
redeploy is its own explicit decision, not automatic once a branch builds), with one open item
— see Known Bugs → Open — rather than either declaring it fixed or chasing it indefinitely
against ambiguous automated evidence.

## Done log (newest first)
- **2026-09-02 — Code-review fixes**: undo's CAS-check bug and `machById`'s stale-cache bug
  (both found by an external review, verified with a failing regression test before fixing —
  see Known Bugs → Fixed for the full write-up), plus a defensive consistency fix (Admin/
  AllBookings/Stats now guard against opening before `store.get('data')` has loaded, matching
  `Grid.tsx`'s existing pattern — not a known crash, since the toolbar buttons that open them
  stay hidden until load succeeds, but a real inconsistency worth closing cheaply). Three
  separate commits, each its own regression test, `npm run verify` green throughout
  (789 → 797 tests).
- **2026-09-02 — F8** (`docs/ARCHITECTURE_AUDIT.md`): investigated before implementing —
  grepped every live `window.*` bridge entry's actual call sites rather than trusting the
  audit's original "4 independently-mounted React roots need to talk to each other" framing.
  That framing didn't hold up: the real causes were dead leftovers never pruned, ~20 leaf
  utilities with zero cycle risk, one genuine imperative-code-into-React need unrelated to
  root count, and two real ES-module import cycles — none of it actually caused by having 4
  separate mount points. Shipped direct ES imports for the majority, a new
  `ui/grid-render-bridge.ts` for the render-trigger case, and an injected
  `GridInteractionHandlers` struct for `grid-interaction.ts`'s dependency-hub shape. The
  original "merge the 4 roots into one tree" proposal was rejected outright — nothing on the
  bridge needed actual tree machinery (context, cross-sibling refs). `app.ts`'s `Window`
  interface shrank from ~30 entries to 3.
- **2026-09-02 — F9** (`docs/ARCHITECTURE_AUDIT.md`): the `window.S` → `store` migration,
  completed in three slices — the bounded first slice (11 plain `.ts` orchestration files, 99
  of ~162 sites), then two component batches (the remaining 18 React components, 63 sites).
  Every app-owned module now reads/writes state via `store.get()`/`store.set()`/
  `store.notify()`; `window.S` stays as the intentional, shrinking compat bridge F8's write-up
  describes. Same notify-timing case-by-case analysis throughout (collapse a write+notify into
  one `store.set()`, or keep a silent `store.state.x =` write where more logic runs before a
  single eventual notify) as every other slice in this backlog.
- Phase 6.3 weekend auto-bridging — `server/bridge.ts` (the ADD direction, mirror of core/weekend's sweep):
  pure `missingBridges(bookings)` (faithful recovery of the baseline `missingWeekendBridges` — for each booked
  Friday whose Monday is booked, fill the empty Sat/Sun with the Friday's name), `maintainBridges(db,mids,ts)`
  (in an open transaction, INSERT … ON CONFLICT DO NOTHING) and `backfillBridges(db)` (whole-DB one-time pass,
  internal SQL, not the 1000-cell API cap). Maintain hook wired into `applyCells`: after the client writes, it
  bridges the affected machines and appends the bridges to the broadcast `changes` (so every client patches
  them), while `applied` stays the client-requested count; gated by the `WEEKEND_BRIDGE` env (on unless `off`,
  threaded as `applyMutate(…, bridge)`). Backfill exposed as `server/backfill.ts` (`npm run backfill`,
  coverage-excluded entry). 10 tests (pure computation, in-DB maintain incl. never-overwrite, whole-DB backfill
  incl. idempotence). Validated on the compiled image: booking Fri 2027-01-08 + Mon 2027-01-11 auto-bridged
  09/10 with the Friday's name; the backfill CLI inserted 1782 legacy bridges — all on a throwaway temp DB, prod
  untouched. **The live backfill is a production write and was NOT run — it awaits explicit authorization.**
  ARCHITECTURE §17 updated. **Phase 6 COMPLETE (code).** **DONE 2026-08-29.**
- Phase 6.1/6.2 backend → TypeScript — ported `src/*.mjs` (~350 lines) to gated `server/*.ts`, decomposed so
  domain logic is pure/tested and I/O stays in a thin shell: `db.ts` (schema/meta/import; `node:sqlite` via
  `createRequire` — Vite/bundler can't resolve the new builtin from a static import), `model.ts` (read model),
  `mutate.ts` (single write path, structural+cell reducers, SSE `broadcast` injected — E4). Entry shells
  `server.ts`/`import.ts` coverage-excluded (run-verified, E5). 31 backend tests vs. `:memory:` SQLite (both
  mutate paths, foreign/blocked conflicts, compare-and-set delete, 1000-cell cap, validation, orphan cleanup,
  rollback via a broken DB). Backend cov 99.4%/90.9% (only defensive rollback-inner-catches uncovered).
  `tsconfig.server.json` (NodeNext, `.js` specifiers) compiles → `dist/server`; Dockerfile build stage runs
  `build:server`, runtime ships it at `/app/server` and runs `node server/server.js` (zero runtime deps kept).
  `src/` deleted; eslint/knip/tsconfig un-sealed → backend faces the full gate. Validated end-to-end on a
  throwaway image `maschinenplan:phase6-test` (isolated port 3998 + fresh volume): health, real seeded state,
  static frontend 200, a real booking through POST /api/mutate (rev 0→1, read back), then torn down — the
  production container + `data` volume never touched. ARCHITECTURE §17 added. **DONE 2026-08-29.**
- Phase 5.3 tooling — `knip` promoted into `verify` (now `format:check && check && lint && deadcode &&
  test:cov`; knip after lint = cheap fail-fast). knip.json tidied to **zero findings**: removed the stale
  `web/js/legacy.ts` ignore and the not-yet-existing `server/*.ts` entries (Phase 6 re-adds), scoped project
  to `{web,shared}/**/*.ts`, set `ignoreExportsUsedInFile`; app.ts entry auto-detected via knip's Vite plugin.
  Added a repo-wide coverage floor (top-level `lines:90, branches:85`) beneath the per-layer globs in
  `vitest.config.ts`. CSS/HTML tidy deferred (E8). Gate green (213 tests, 100%). **Phase 5 COMPLETE.** **DONE 2026-08-29.**
- Phase 5.2 FS-era burn-down — removed the file-backed-variant dead code, each confirmed zero-caller first:
  `writeFile()` (+ `S.handle`/`S.lastRaw`/`lastMtime`), the empty stubs `setupFileObserver`/`startRefreshTimer`
  and the `setupFileObserver()` call in `startUI`; the dead `lastRaw` field dropped from `AppState`
  (`shared/types.ts`), `hydrateState` (`app.ts`) and the `state.test.ts` fixture (written, never read).
  legacy.js 2712→**2362**. `knip` shows no dead code in the gated layers (legacy.js isn't analysed by knip →
  manual burn-down). Gate green; browser reload booted identically (245 machines / 266 rows), console clean,
  `rev` 23. Modal-markup folding + `AS_TREE` retirement deferred with rationale (ARCHITECTURE §16). **DONE 2026-08-29.**
- Phase 5.1 write-path reducers — `core/booking.ts`: the eight `mutate(fresh=>…)` callback bodies extracted
  as pure/mutating reducers with the legacy return shapes. `bookCells` (conflict-check + apply, ts + gid
  factory injected — E4; split into findConflicts/applyBooking/writeMachineCells for the complexity cap);
  four delete reducers kept distinct by predicate (E1): `deleteCells` exact-name run, `deleteOwnCells`
  case-insensitive user, `deleteSelectedCells` explicit cell list, `deleteGroup` by-gid across all machines
  — all sweep via core/weekend, so no legacy site calls `sweepWeekends` directly any more; machine CRUD
  `saveMachine` (edit/create + slug/transliteration + same-group insert index), `deleteMachine`,
  `moveMachine`. `shared/types.ts` grew `Booking.note/gid/gtitle` + `Machine.redu`. Legacy call sites are
  now one-liners over the window bridge. 43 tests → **100% cov** (213 total). E5 note: these POST, so they
  are gate-only — verified additionally by running every bridged reducer against a `structuredClone` of the
  **live** S.data in the browser (245 machines): `deleteGroup` hit exactly the 10 cells of a real gid, create
  slugged `ueber-smoke` after its group, `moveMachine` swapped a real pair, cross-group/unknown-id aborted;
  `window.S.data` untouched, app rendered identically (266 rows / 216 booked), server `rev` unmoved (23).
  ARCHITECTURE §16 added. **DONE 2026-08-29.**
- Phase 4.3 machine-text — `ui/machine-text.ts`: pure German status/availability formatters
  `maintText(slot)`, `statusRangeText(m, today=todayStr())` (today injected w/ default), `daysMaskText(m)`.
  Legacy defs deleted; `blockText` now calls the bridged `maintText`; legacy `WD_SHORT` kept only for the
  Verwalten checkboxes. 11 tests, 100% cov. Smoke: bridged formatters produce correct text on synthetic
  slots/masks (live data has no maint/day-restricted machines), default-today path matches, `rev` 23.
  **DONE 2026-08-29.**
- Phase 4.3 admin — `ui/views/admin.ts`: `filterAdminMachines(machines, sort, query)` — order
  (manual/name/group→name, German collation) + case-insensitive "name group" search of the machine
  list for the Verwalten modal. Legacy `renderList` sort/filter block replaced by the bridged call
  (`manual` flag kept for the ↑/↓ markup). 6 tests, 100% cov (empty-group collation + name tiebreak).
  Smoke: 245→7 rows on live search, name-sort ascending, input not mutated, `rev` 23. **DONE 2026-08-29.**
- Phase 4.3 all-bookings — `ui/views/all-bookings.ts`: `computeAllRuns(machines, bookings, today)`
  (per-person consecutive-workday runs w/ earliest ts) + `filterAllRuns(runs, criteria)` (case-insensitive
  person/machine, group, [from,to] overlap window, 5 sort keys w/ termin fallback, cap 300). Legacy
  `computeAllRuns()` deleted + the `sorters` map/filter chain in `renderList` replaced by the bridged calls.
  9 tests, 100% cov (incl. comparator tie-breakers + empty-field fallbacks). Smoke: 66 runs / 564 run-days
  == manual future-weekday count, sort dropdown works, `rev` 23. **DONE 2026-08-29.**
- Phase 4.3 stats — `ui/views/stats.ts`: `computeStats(machines, bookings, from, to)` extracted — the
  full stats aggregation (per-machine counts/percent/person-breakdown, cross-machine person index,
  maintenance+downtime tally), pure over core/dates+core/machines. Legacy `compute()` keeps only the
  range DOM-read + validation. 7 tests, 100% cov; browser smoke cross-checked 9462 booked cells over 245
  machines vs. a manual count (person-day totals reconcile), all 3 modes render, `rev` 23. **DONE 2026-08-29.**
- Phase 4.3 my-bookings — `ui/views/my-bookings.ts`: `computeMyRuns(machines, bookings, user, today)`
  extracted (consecutive-workday run-grouping of the user's future bookings, date-sorted; Fri→Mon = one
  run). Legacy `computeMyRuns()` deleted, call site injects `orderedMachines()/bookings/user/today`. The
  modal shell + expand/goto/delete wiring stay in legacy. 5 tests, 100% cov; browser smoke: bridge live,
  cross-checked run-days vs. a manual reduction, real modal opened for a live booker, `rev` unchanged (23).
  **Scope note (§15): 4.3 extracts pure view *kernels*, not markup shells.** **DONE 2026-08-29.**
- Phase 4.2b — `ui/navigation.ts`: pure next-free scan geometry extracted from the ⏭/⏮ jump code.
  `nextFreeDay(fromIso, today, isFree, horizon=730)` and `prevFreeDay(fromIso, today, isFree)` walk the
  calendar (skipping weekends via `core/dates`) for the first day a machine is bookable; the impurity —
  whether a day is bookable for *that* machine (`!getBooking && !isBlockedM && dayAvailable`) — is
  injected as a predicate (E4). 11 tests, 100% cov; bridged; legacy `nextFreeAfter`/`prevFreeBefore`
  reduced to one-line wrappers so all callers (`gotoNextFree`, `gotoPrevFree`, the `hasBack` flag) are
  unchanged. Everything with a side effect (`jumpToSlot`: scroll/window-rebuild/`paintSel`/`toast`, the
  `nextFreePtr` bookkeeping, `prependWeek`/`ensureOverflow`) stayed in the legacy adapter (E3/E8).
  Browser smoke: bridged fns live and wrapper≡pure cross-checked on a live machine; real ⏭ advanced
  08-31→09-01, ⏮ walked back to 08-31 and never before today; SSE-reconnect console noise only; `rev`
  unchanged (23). **DONE 2026-08-29.**
- Phase 4.2a — `ui/selection.ts`: pure selection geometry extracted from the `Sel`/interaction block.
  `computeSelCells(anchor, focus, visM, visD)` (the anchor↔focus rectangle over the visible grid,
  injected — E4) and `clampIndex(idx, len)` (the arrow-key move/extend clamp, used for both row and
  column). 8 tests, 100% cov; bridged in `app.ts`; legacy's `paintSel` now calls the injected form and
  the keyboard handler uses `clampIndex`. Browser smoke: bridged fns live, a real drag painted 4 `.sel`
  cells + 1 `.kfocus` via `paintSel`, ArrowRight advanced one column, ArrowUp clamped at the top row;
  console clean; `rev` unchanged (23). The DOM side (paint/listeners/autoscroll/week-growth) stays in
  the legacy adapter (E3/E8). **DONE 2026-08-29.**
- Phase 2.4b — Assistant N-of-M solver (11 fns, predicate-injected) extracted to `core/assistant.ts`
  (15 tests, 100% cov); `runAssistant` refactored to call it. Ran the Assistant end-to-end in the
  browser: correct open-run result, core cross-check matches, console clean. **Phase 2 COMPLETE.**
- Phase 2.4a — `core/assistant.ts` pure tree ops (7 fns, 16 tests, 100% cov) extracted + bridged;
  legacy keeps thin `AS_TREE`-binding adapters. Browser-verified incl. real `asAdd`→`asDevs` path.
- Phase 2.3 — `core/weekend.ts` (`sweepWeekends`, 6 tests, 100% cov) extracted + bridged;
  **fixed the `migrating` bug** by deleting the two obsolete file-era migrations and their calls
  (they never ran; server rejects the weekend write with 400). Fresh-tab console now fully clean;
  backend rev unchanged (no write). `missingWeekendBridges` deleted with its only caller.
- Phase 2.2 — `core/machines.ts` + `machines.test.ts` (18 tests, 100% cov) + `shared/types.ts`
  contract seeded; 8 pure predicates removed from `legacy.js`; grid renders from the bridge
  (browser-verified); core coverage still 100%
- Phase 2.1 — `core/dates.ts` + `dates.test.ts` (22 tests, 100% cov); 12 date helpers removed
  from `legacy.js`; coverage 90/85 armed into `verify`; app boots identically (browser-verified)
- Phase 2.0 — `web/js/app.ts` ESM entry + window bridge; `legacy.js` now `defer`, module runs first
- Phase 1.4b — deleted old top-level `public/`; production rebuilt + still serves (Phase 1 done)
- Phase 1.4a — multi-stage Dockerfile; production container serves built frontend (verified :3000)
- Phase 1.3 — `<style>` → `web/css/app.css`; app looks identical (stylesheet loads + applies)
- Phase 1.2 — monolith → classic `web/public/legacy.js`; app byte-identical (all handlers global)
- Phase 1.1 — Vite `web/` root; app loads identically under Vite (`/api` proxied to backend)
- `2582e27` Phase 0.5 — full gate + hard pre-commit enforcement (proven to block red)
- `f99b18e` Phase 0 — locked calibrated bar (90/85), per-phase cadence, legacy quarantine
- `6966723` Phase 0 — quality-gate system, iteration loop, CLAUDE.md
- `ee4c104` Phase 0 — ARCHITECTURE.md + FEATURES.md
- `cc2ab9d` Phase 0 — dockerized TS + Vite + Vitest toolchain
- `789bfec` Baseline — working app as inherited (rollback point)

## Open decisions / notes
- Dev-only npm-audit vulnerabilities (transitive via Vite/Vitest) — no runtime impact;
  revisit at Phase 5 polish.
- `node:sqlite` experimental in Node 22 — confirm the flag/loader story at Phase 6.

## Known bugs

### Open (deferred — preserve for now, fix in a flagged step)
- **Assistant card backgrounds render light in dark mode in automated screenshots, on the
  `phase14-shadcn-preset` fork — unconfirmed whether this is real.** Found via Playwright
  screenshot after the shadcn-preset pivot (2026-09-04). Investigated thoroughly before
  flagging rather than assuming either way: `getComputedStyle` on `.assist-card` reports the
  correct dark `rgb(30,33,38)` (`--app-panel`'s dark value) with the right `data-theme="dark"`
  attribute set; `document.elementsFromPoint` at the card's exact screen coordinates shows no
  covering element at any z-index; reproduced identically after long settle waits, after
  `document.fonts.ready`, and — decisively — in a **real installed Chrome** (`channel:
  'chrome'`), not just Playwright's stripped-down headless-shell binary. Computed-style-correct
  + paint-wrong + reproducible across two browser binaries points at a software-rendering
  (no-GPU/SwiftShader) artifact specific to this sandboxed container's screenshot pipeline
  rather than a real app bug, but that's not proven — needs a real-browser spot-check (open the
  Assistant in dark mode on an actual machine) before this branch is trusted for a merge/deploy
  decision. Deliberately left open rather than declared fixed on ambiguous automated evidence,
  and not chased further at the cost of unbounded additional verification effort.

### Fixed
- **Tailwind's Preflight inflated every `.btn`-classed element app-wide (not just the
  Assistant's)** — FIXED 2026-09-04, same day as 14.1–14.3 shipped, found via direct user
  report ("buttons look weird") against the live production redeploy. Root cause: `web/css/
  tailwind.css`'s `@import 'tailwindcss'` bundles Preflight, whose `button,input,…{line-height:
  inherit}` normalization made every button on every screen inherit `body`'s `line-height:1.4`
  instead of the browser's own default button line-height — toolbar `#btnAssist` measured 45px
  tall instead of its correct 29px (confirmed against a throwaway build of the untouched
  pre-Phase-14 commit `ef7d334`: 29px/78px toolbar, pixel-identical to the fix). A second,
  narrower issue found in the same pass: the Assistant's own "Abbrechen"/"Freie Termine
  suchen" buttons lost their `height:36px` parity with the surrounding date inputs, because
  that was `.assist-actions .btn{height:36px}` in app.css — keyed on the literal `.btn` class
  `<Button>` no longer carries. Fixed both: `tailwind.css` now imports only the `theme`/
  `utilities` layers (skips Preflight entirely — see that file's own comment for the reasoning,
  now also `ARCHITECTURE.md` §19), with `ui/button.tsx`/`ui/input.tsx` supplying their own
  `box-border`/`appearance-none`/`font-[inherit]` resets instead of assuming a global one; the
  two `.assist-actions` buttons get an explicit `h-9` (36px) at their call site rather than in
  app.css, so `<Button>` stays self-contained once app.css is eventually retired. Regression
  tests added (`button.test.tsx`, `input.test.tsx`, `AssistantModal.test.tsx`). Verified two
  ways: `npm run verify` green (1006 tests), and real Playwright DOM measurements — the fixed
  build's toolbar/button dimensions match the pre-Phase-14 baseline **exactly** (not just
  "close"), and the Assistant's action buttons/date inputs are all exactly 36px tall again.
- **Undo's CAS check silently skipped after undoing a booking creation** — FIXED 2026-09-02,
  found by an external code review and verified before fixing (a regression test proved the
  bug first). `offerUndo` (`ui/toast.ts`) forwarded the *original* action's `CellUndo.prev`
  (the state before that action) as the CAS check for the undo-click's own server request.
  Undoing a deletion happened to still be safe (the "book" branch's own independent
  conflict check doesn't consult `prev`), but undoing a *creation* has `prev: null` — which
  the server (`server/mutate.ts`'s `writeCell`) treats as "no CAS check requested", so the
  delete proceeded unconditionally against whatever was actually on the cell, including a
  booking someone else made there since. Fix: `offerUndo` now captures the cell's actual
  current value right before applying the undo, and sends *that* as the CAS check — matching
  how every other write in the app already computes it. Two regression tests in
  `toast.test.ts` (one per undo direction).
- **`machById` cache stale after a machine create/delete** — FIXED 2026-09-02, same review.
  `saveMachine`/`deleteMachine`/`moveMachine` (`core/booking.ts`) mutate `data.machines` IN
  PLACE (`.splice()`/swap) rather than replacing the array, so `machById`'s
  reference-equality cache never rebuilt for them. Traced per-operation: edits and reorders
  were already safe (same object references); only create/delete left a window where
  `machById` returned `undefined`/a stale object until the next full data reload. Fix: a new
  `invalidateMachineLookupCache()` (`ui/machine-lookup.ts`), called from `ui/mutate.ts` on
  the same "no `undo` array" signal that already distinguishes a structural change from a
  booking-cell one — kept out of `core/booking.ts` to preserve its DOM-free purity rule.
- **`wknd` class lost on cell patch** — FIXED post-Phase-7 (2026-09-01), as its own small
  flagged step (not part of the migration itself — the whole point of every Phase 7 slice was
  faithful conservation, so this waited until the migration was done and the code was safe to
  deliberately change). `render()`/`GridBody.tsx` added a `wknd` class to weekend cells; the
  targeted patch path (`refreshCell`, now `ui/cell-patch.ts`) didn't — so a booking write/delete
  on a weekend column silently lost its `wknd` styling until the next full render. Only visible
  when weekends are shown (`mb_weekends==='on'`). Fix: `refreshCell` now computes
  `isWeekend(parseIsoDateString(date))` itself and passes it to `cellClass` on every branch
  (blocked/booked/unavail/free), matching what `GridBody.tsx` already does for the full render.
  5 new regression tests (`cell-patch.test.ts`) covering every branch independently (the bug
  could resurface in any one without the others). Browser-verified: booked, then deleted, a
  weekend cell with weekends shown — `wknd` survived both patches.
- **`migrating` / `migratingMess` undeclared implicit globals** — FIXED in Phase 2.3.
  Root cause: two obsolete one-time client-side Bestands-Migrationen (`migrateWeekends`,
  `migrateMesstechnik`) from the old File-System-Access variant referenced undeclared globals, so
  under `'use strict'` they threw `ReferenceError` at init (uncaught async → non-fatal) and never
  actually ran. Investigation showed merely *declaring* the vars was the wrong fix: it resurrects
  `migrateWeekends`, which then fires a weekend-bridge write the **server rejects with HTTP 400** on
  every load — i.e. it does NOT conserve behavior. The correct, behavior-preserving fix was to
  **remove the two obsolete migrations and their `startUI()` calls** (server data is authoritative
  and already consistent; `migrateMesstechnik` needed a local folder that no longer exists). Result:
  console clean, no write attempted (rev unchanged). Acceptance was integration-level (fresh-tab
  console clean + zero `/api/mutate` + rev stable), since the defect lived in impure obsolete init
  code with no meaningful unit-test surface.
- **Assistant global filter actions and compact selection layout** — FIXED 2026-09-05.
  The search and cancel actions now live in a single right-aligned footer for the complete
  filter zone and remain available as the zone scrolls. The three input cards share a light
  filter-zone surface; selected devices wrap as inline chips, with alternatives grouped in a
  dashed container and the redundant root-level `UND` label removed. The date range is compact,
  shows a calendar icon in each endpoint, and keeps the minimum-days input beside the range.
  Focused Assistant/date-picker tests (46) and the full verification suite pass.
