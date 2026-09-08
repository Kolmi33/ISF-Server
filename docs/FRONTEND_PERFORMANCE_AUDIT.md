# Frontend performance audit

Audit date: 2026-09-07

Dataset used for scale checks: 245 machines, 11,294 booking cells, 548 future booking cells, and 16 groups in `buchungen.json`.

Implementation status: P1-P7 are implemented in this change. P8-P10 received bounded mitigations without changing the grid DOM contract. P11-P14 remain explicitly benchmark-first because their complete solutions would change rendering architecture or visual behavior.

### Browser and algorithm measurements

- Production startup entry: 648.73 KB / 206.32 KB gzip before feature splitting; 384.56 KB / 129.73 KB gzip after it (40.7% raw and 37.1% gzip reduction).
- A production Chromium run with the repository dataset rendered 3,675 grid cells initially. Sustained horizontal growth reached 17,150 cells under the old 12-extra-week cap; steady scrolling averaged 18.41 ms/frame, peaked at 45.3 ms, and exceeded 20 ms on 10 of 90 sampled frames.
- The normal retained-week cap is reduced from 12 extra weeks to 6 (9,800 machine/date cells at the current dataset size). Infinite navigation still shifts the bounded window, and active drag selection retains its existing exemption.
- Repeating the same sustained-navigation sample after the cap change reduced the steady-scroll average from 18.41 to 17.11 ms/frame and the maximum from 45.3 to 38.3 ms. The count of frames over 20 ms remained 10/90, so deeper grid work remains a profiling-led follow-up rather than a claimed complete fix.
- On synthetic grouped bookings at repository scale, 10 summary calculations fell from 852.33 ms to 18.26 ms while returning the same group count (about 47x for that kernel).

These headless Chromium numbers are comparative diagnostics, not a substitute for profiling on the deployment machines and displays.

## Confirmed problems

### P1 — Selection repaint repeats work for the whole selection on every pointer transition

- **Severity:** High
- **Location:** `web/js/ui/grid-interaction.ts`, `paintSelection`, `handleGridMouseOver`, and drag auto-scroll
- **Problem:** Each newly hovered cell recomputes the selection rectangle, queries the document once per selected cell, removes all existing selection/focus classes, and then reapplies every class and ARIA attribute. A large drag therefore repeatedly updates the whole selected area even though only its edge changed.
- **Performance impact:** Dragging across a large grid produces increasing query-selector and DOM-mutation work on every `mouseover` event. The cost grows with selection area and competes directly with pointer handling and scrolling.
- **Recommended solution:** Retain the currently painted element map and apply a keyed delta: remove cells no longer selected, add only newly selected cells, and update focus only when it changes. Rebuild the cache only after React replaces grid DOM nodes.
- **Risk:** Medium. Selection classes, focus, ARIA state, grid re-renders, and patched cells must remain synchronized.

### P2 — “My bookings” summary repeatedly scans the entire booking database per grouped run

- **Severity:** High
- **Location:** `web/js/ui/views/my-bookings.ts`, `computeMyBookingsSummary`; `web/js/core/bookings.ts`, `findBookingGroup`
- **Problem:** Every grouped run calls `findBookingGroup`, which scans all machines and all booking dates. The summary is recomputed on every modal render, including filter typing and row expansion.
- **Performance impact:** Work is approximately grouped-runs × all-bookings. With 11,294 booking cells, ordinary local state changes can repeatedly traverse the same database many times and make the modal feel slow.
- **Recommended solution:** Collect the relevant group IDs first, scan bookings once to build their distinct machine membership, then calculate the group count. Memoize modal derivations only where their inputs are unchanged.
- **Risk:** Low. The group-count semantics require regression tests, especially titled single-machine bookings versus real multi-machine groups.

### P3 — Grid cells parse the same ISO dates thousands of times per full render

- **Severity:** High
- **Location:** `web/js/ui/components/GridBody.tsx`, `GridCell`; `web/js/core/machines.ts`, `isMachineAvailableOnWeekday`
- **Problem:** Each machine × date cell parses its ISO date once for weekend status and often again for weekday availability. The weekday is identical for every machine in a column and is already implicit in the Monday-based week array.
- **Performance impact:** The initial two-week, weekday-only grid creates about 2,450 cells for the current 245-machine dataset before headers; the normal grown window can reach 17,150 cells. Repeated string splitting and `Date` allocation adds avoidable render-time garbage and CPU.
- **Recommended solution:** Pass the week-relative weekday index and weekend flag down with each date column and evaluate the machine day mask without reparsing the date.
- **Risk:** Low. Weekend-enabled mode and Monday-first mask indexing need tests.

### P4 — Statistics dashboard aggregation reruns for unrelated modal state

- **Severity:** Medium
- **Location:** `web/js/ui/components/StatsModal.tsx`, `StatsModal`; `web/js/ui/views/stats.ts`, `computeCategoryDashboard`
- **Problem:** The category dashboard walks category rows and computes counts for every date on every modal render, even when only the resource-name filter, a fold state, breadcrumb selection, or drilldown changes.
- **Performance impact:** A full-year range is roughly 245 × 260 date checks for work whose inputs did not change. Typing into the filter can synchronously repeat it for every keystroke.
- **Recommended solution:** Memoize the dashboard on the aggregation object and active category, and memoize filtered overview rows on the exact state that affects them.
- **Risk:** Low to medium. Booking data is mutated in place elsewhere, so memoization must remain scoped to the modal's frozen/explicitly recomputed aggregation lifecycle.

### P5 — Future-booking run construction sorts timestamps repeatedly

- **Severity:** Medium
- **Location:** `web/js/ui/views/all-bookings.ts`, `computeAllRuns`; `web/js/ui/views/my-bookings.ts`, `computeMyRuns`
- **Problem:** For every discovered run, timestamps are mapped, filtered, and sorted solely to obtain the minimum timestamp.
- **Performance impact:** Opening booking list windows allocates several temporary arrays and performs O(run length × log run length) work where a single linear minimum scan is sufficient.
- **Recommended solution:** Compute the earliest non-empty timestamp in one pass.
- **Risk:** Low. Empty timestamps and lexical ISO timestamp ordering must remain unchanged.

### P6 — Main entry eagerly loads feature windows and their heavy dependencies

- **Severity:** Medium
- **Location:** `web/js/app.ts` and the modal import graph
- **Problem:** The entry point statically imports Assistant, Statistics, Admin, All Bookings, My Bookings, Help, and Active Users. This pulls modal-only calendars, drag-and-drop, date utilities, icons, and view code into startup evaluation even when those windows are never opened.
- **Performance impact:** More JavaScript must be downloaded, parsed, compiled, and evaluated before the main calendar is interactive. The Assistant path alone includes `@dnd-kit`, `react-day-picker`, and date-fns UI code.
- **Recommended solution:** Dynamically import independent feature windows at their interaction boundary, and start loading on hover/focus so pointer users normally pay no click-time delay.
- **Risk:** Medium. First activation without prior hover/focus becomes asynchronous and errors need a safe fallback. Shared dependencies may still remain in the entry chunk through other static paths.

### P7 — Row hover applies CSS `filter` to every date cell in the row

- **Severity:** Medium
- **Location:** `web/css/app.css`, grid row hover rules
- **Problem:** Hovering a machine row applies `filter: brightness(...)` to each cell. Filter effects are more expensive to paint/composite than a simple color overlay and may create extra layers.
- **Performance impact:** Pointer movement while scrolling repeatedly invalidates an entire wide row, especially costly near the 14-week normal window.
- **Recommended solution:** Preserve each booking's background color and use a non-filter color overlay/background layer for row hover. Verify both light and dark themes visually.
- **Risk:** Medium. The overlay must preserve booking colors, today/weekend states, text contrast, and merged-block appearance.

## Likely problems

### P8 — Whole-grid React reconciliation is the unit of change for navigation and structure

- **Severity:** High
- **Location:** `web/js/app.ts` store subscription; `web/js/ui/components/Grid.tsx`; `web/js/ui/grid-scroll.ts`
- **Problem:** Any notified state change rebuilds the full grid view model and reconciles all visible rows/cells. Adding or sliding one week also recreates all week arrays and row props.
- **Performance impact:** Before mitigation, the normal 12-extra-week cap rendered about 17,150 machine/date cells plus headers. A one-week scroll-boundary change still revisits the entire table.
- **Recommended solution:** The retained cap is reduced to 6 extra weeks (about 9,800 cells at current scale). Continue by profiling React commit time on target hardware, then consider stable week subtrees/column models and narrower store invalidation. Keep targeted cell patching for small booking writes.
- **Risk:** High. Selection, sticky headers, booking-block merging, and imperative DOM patching all rely on the current DOM contract.

### P9 — Grid post-commit effect always performs layout and DOM reconciliation work

- **Severity:** Medium
- **Location:** `web/js/ui/components/Grid.tsx`, un-dependency-scoped effect
- **Problem:** Every grid commit reads header height, writes a root CSS variable, repaints selection, synchronizes controls, and schedules overflow measurement whether the relevant geometry changed or not.
- **Performance impact:** It can force style/layout work immediately after an already expensive table commit and schedules another render when overflow is insufficient.
- **Recommended solution:** Separate geometry effects from selection restoration and key each to the state that actually affects it. Avoid writing `--theadh` when the measured value is unchanged.
- **Risk:** Medium. Incorrect dependencies could leave sticky offsets, selection, or overflow stale.

### P10 — Small cell mutations still recompute booking-block geometry for the entire visible grid

- **Severity:** Medium
- **Location:** `web/js/ui/cell-patch.ts`, `currentVisibleSegments` and `patchCells`
- **Problem:** Targeted DOM patching avoids a React commit, but it computes merge segments for every visible week and row even when one booking day changed.
- **Performance impact:** The pure calculation remains proportional to all visible cells and is noticeable at a grown window, although it is cheaper than replacing the DOM.
- **Recommended solution:** Compute only affected visible weeks and refresh affected block neighbors/rows. Benchmark before changing because merge correctness spans adjacent rows.
- **Risk:** High. A local change can alter horizontal and vertical merged-block boundaries and the single displayed name cell.

## Benchmark-first improvements

### P11 — No row/column virtualization for the calendar grid

- **Severity:** Potentially High
- **Location:** `web/js/ui/components/Grid.tsx` and `GridBody.tsx`
- **Problem:** Every visible machine and every date in the retained week window exists in the DOM.
- **Performance impact:** DOM size, sticky-position calculations, style resolution, and paint cost still approach ten thousand cells at the new normal cap.
- **Recommended solution:** Profile layout/paint and React commit time on representative hardware. If DOM cost dominates after the targeted fixes, prototype vertical row virtualization first; column virtualization is substantially harder because selection and booking-block merging cross boundaries.
- **Risk:** Critical. Virtualization can change accessibility, keyboard navigation, drag selection, sticky group headers, scroll anchoring, and booking block visuals.

### P12 — Dragging may grow the calendar far beyond its normal DOM cap

- **Severity:** Potentially High
- **Location:** `web/js/ui/grid-scroll.ts`, `canStillGrowWindow`
- **Problem:** The normal window stops growing after 12 extra weeks, but active drag selection is exempt up to the absolute 150-week ceiling.
- **Performance impact:** A sustained drag can create roughly 184,000 weekday cells for the current machine count, which is likely to stall or exhaust a tab.
- **Recommended solution:** Measure real drag behavior, then use a bounded logical selection model that can retain offscreen endpoints while the rendered window slides.
- **Risk:** High. Simply removing the exemption would lose the drag anchor under the existing visible-index selection model.

### P13 — Modal result lists render up to 300 rich rows without virtualization

- **Severity:** Potentially Medium
- **Location:** `web/js/ui/components/AllBookingsModal.tsx` and related booking/statistics lists
- **Problem:** The All Bookings cap still permits 300 card rows, each with nested controls and icons.
- **Performance impact:** Opening and filtering can produce a sizable DOM/commit, but 300 simple rows may still be acceptable on target hardware.
- **Recommended solution:** Measure modal commit and scroll frame times before adding virtualization. Prefer pagination or a lower incremental-render batch if accessibility and dynamic row heights make virtualization costly.
- **Risk:** Medium to high. Virtualized scroll areas can affect keyboard access, search expectations, sizing, and visual continuity.

### P14 — Per-cell multi-layer inset shadows may increase paint cost

- **Severity:** Potentially Medium
- **Location:** `web/css/app.css`, `td.cell`
- **Problem:** Every cell composes seven inset shadow layers for hairline grid, weekend tint, and booking accents.
- **Performance impact:** Large tables may spend significant time painting shadows while scrolling, but the exact browser/GPU cost must be profiled and the shadows implement required sub-pixel and merged-border behavior.
- **Recommended solution:** Use browser paint profiling before changing. If dominant, test a reduced-layer approach at device-pixel-aware widths while preserving merge semantics.
- **Risk:** High. This is load-bearing visual behavior and previous border implementations visibly regressed.

## Findings that do not currently justify changes

- Scroll-driven month-control synchronization is already animation-frame throttled.
- Grid, document, modal, and dropdown listeners are delegated or installed once; there is no evidence of per-row/per-cell listener proliferation.
- SSE booking updates already use targeted cell patching rather than full React grid renders.
- Existing Assistant catalog memoization is tied to a genuinely expensive filter and stable catalog input.
- A blanket addition of `React.memo`, `useMemo`, or `useCallback` would not help the dominant grid path while week arrays and booking geometry are recreated; stable data boundaries must come first.
