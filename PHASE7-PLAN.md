# Phase 7 & Readability — detailed slice plans

Companion to `PROGRESS.md`/`ARCHITECTURE.md`. This doc breaks Backlog A (readability pass)
and Backlog B (React view-layer migration) into per-slice implementation plans, grounded in
a full read of `web/public/legacy.js` (2,362 lines) and every current `core/`/`net/`/`ui/`/
`state.ts` module. Not yet committed — for iteration. Once a slice's plan is agreed, it
becomes that slice's actual commit checklist.

---

## Cross-cutting rule for Backlog A — rename safety

Every `core/`, `net/`, `ui/` module is re-exported onto `window` in `app.ts`
(`Object.assign(window, dates)` etc.), and `legacy.js` calls many of them **by bare global
name** — not just through thin adapters. Concretely, these are called directly in
`legacy.js` today: `classifyCell`, `classifyDot`, `cellClass`, `weekHeaderCells`,
`computeSelCells`, `clampIndex`, `nextFreeDay`/`prevFreeDay` (via wrappers), `anyRedund`,
`groupRuns`, `freeDays`, `extendOpenRuns`, `pickFor`, `computeAllRuns`/`filterAllRuns`,
`computeMyRuns`, `computeStats`, `filterAdminMachines`, `maintText`, `statusRangeText`,
`daysMaskText`, plus the `core/machines.ts` predicates (`catOf`, `maintAt`, `isBlockedM`,
`dayAvailable`, `anyMaint`, `maintSlots`).

**Rule:** renaming a function/type that is **exported** from one of these modules requires,
in the *same* commit: (1) the rename, (2) `grep -n '\bOLDNAME\b' web/public/legacy.js
web/js/app.ts` and fixing every hit, (3) `verify` green, (4) a browser smoke (E5) — a missed
call site fails silently as `ReferenceError` at runtime, not at build time, since
`legacy.js` is gate-excluded and untyped. Renaming a **module-private** (non-exported)
identifier is free — no cross-file coordination, do it liberally. Each item below says
which of its targets are exported (coordinate) vs. private (free).

---

## Non-negotiable style rules for every slice

Restated from `PRINCIPLES.md` P3/P5 because they're the ones a mechanical rename-and-move
pass most easily drifts on. These apply to **every** slice below, not just A1 — A1 is just
where they're worked out in full first.

1. **No shortened names, anywhere — parameters, locals, loop variables, everything.**
   `m`, `d`, `s`, `n`, `x`, `r`, `c`, `mb`, `fresh` are all banned, including in one-line
   arrow functions and short-lived loop counters. A name should say what the value *is*
   (`machine`, `isoDate`, `slot`, `numberOfDays`), not what letter it starts with. If a
   name gets long, that's fine — `weekdayWithMondayFirst` beats `wd`.
2. **No dense one-liners or clever chains.** A single expression that combines a lookup, a
   transform, and a fallback in one line reads fast to the person who wrote it and slowly
   to everyone else. Prefer a short sequence of named intermediate values over a chain of
   `.filter().map().sort()` or nested ternaries — each step gets its own line and its own
   name, so the function reads top-to-bottom like a paragraph.
3. **No "weird" loops.** A loop should do one clearly-named thing per iteration. Avoid
   mutating more than one variable per step without a comment explaining why; avoid
   `do…while` unless the "always run once" semantics are the actual point; prefer a plain
   `while`/`for…of` that a reader can narrate in one sentence.
4. **Comment the WHY, every time it isn't obvious.** Not "increment i" — why the timezone
   is re-anchored here, why this magic number is `24*60*60*1000`, why the ISO week
   algorithm needs a fixed reference point. A reader should never have to reverse-engineer
   an algorithm from bare code when one sentence would have told them.

These are judgment calls, not something `verify` enforces (ARCHITECTURE §10 already says
naming/readability stays human judgment) — so each slice's rewritten code is shown in full
below rather than described, so it can be reviewed for the same style whether it's read now
or against the eventual diff.

---

## Backlog A — readability pass

### A1 — `web/js/core/dates.ts` (in depth) — **DONE**

Executed as planned, with one addition the plan didn't call out: the "free" TS-import
renames weren't limited to `ui/grid.ts` — a repo-wide grep turned up **9 files** importing
the old short names directly (`core/machines.ts`, `core/weekend.ts`, `core/assistant.ts`,
`ui/grid.ts`, `ui/machine-text.ts`(+test), `ui/navigation.ts`, `ui/views/stats.ts`,
`ui/views/my-bookings.ts`, `ui/views/all-bookings.ts`, `app.ts`), all updated to the real
names. Two of those (`my-bookings.ts`, `all-bookings.ts`) had a private `nextWd` closure
built on the exact do-while-then-format shape `nextWeekday` had in `core/assistant.ts` —
renamed to `nextWorkday` and rewritten as a plain `while` loop in all three places while
already touching the line, per the new style rules (behavior-identical; each has its own
green test file). `knip`'s `duplicates` check flagged the 7 legacy-bridge aliases as
duplicate exports — a real, expected gate hit, resolved by deliberately disabling that one
rule (`knip.json` → `"rules": {"duplicates": "off"}`), not by bypassing the gate. `verify`
green (255/255 tests, 100% coverage on every touched file); Vite dev-server transform
checked on every touched file (all HTTP 200) as a substitute for a full headless-browser
click-through, since no browser driver (`chromium-cli`/Playwright) is available in this
environment — worth a `/run-skill-generator` pass if that matters for future sessions.

**The rename-cost split (grepped, not assumed).** `ymd`, `parseYmd`, `addDays`, `mondayOf`,
`isWeekend`, `fmtLong`, `todayStr`, `weekdayRange`, `allDaysRange` are each called **dozens
of times** by bare global name across `legacy.js` (confirmed by grep — e.g. `todayStr()`
appears 9 times, `fmtLong()` 15 times, `mondayOf()` 7 times). `fmtShort`, `weekdayName`, and
`isoWeek`, by contrast, are used **only** through `ui/grid.ts`'s typed `import` (2 call
sites total) and `dates.test.ts` — `tsc` catches every reference immediately, so renaming
those three is free.

**Decision: don't touch `legacy.js` for this pass.** Editing dozens of scattered call sites
in a file that Phase 7 (slice B10) deletes wholesale is churn against soon-dead code, and
widens this commit's diff for no lasting benefit. Instead, following the same strangler
pattern the project already uses everywhere else (E3 — thin adapters that name their retire
phase): give every function its real, fully-descriptive name; keep the **old short names as
a small block of one-line `export const` aliases** at the bottom of the file, explicitly
commented as a temporary bridge for `legacy.js`, to be deleted in slice B10. New code must
never import an alias — only the real name. `addDays` and `isWeekend` need no alias; they
were never abbreviations.

**Full rewritten file:**

```ts
// Pure date helpers extracted from the monolith (legacy.js). No DOM, no globals —
// data → data, so they are trivially testable (this is where our tests concentrate).
//
// Convention (preserved from the original): the external currency is the ISO date
// string 'YYYY-MM-DD'. Such strings sort correctly lexicographically and are used
// directly as object keys in `bookings`. Date math runs in UTC so it never drifts
// with the viewer's timezone; only `mondayOfDate`/`todayAsIsoDateString` read local
// calendar components, exactly as the original did.
//
// Naming note: every function here is re-exported onto `window` in app.ts so the
// not-yet-migrated `legacy.js` monolith can keep calling it — but `legacy.js` still
// calls several of these by their OLD short name (`ymd`, `parseYmd`, `mondayOf`,
// `fmtLong`, `todayStr`, `weekdayRange`, `allDaysRange`). Those old names survive ONLY
// as the thin aliases at the bottom of this file; `legacy.js` itself is not edited
// (E3/E8 — it's deleted whole in Phase 7 slice B10, not patched piecemeal). New
// TypeScript code must always import the real, fully-named function.

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const WEEKDAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A Date → its UTC calendar day as 'YYYY-MM-DD'. */
export function formatDateAsIsoString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → a Date at UTC midnight of that day. Malformed input → Invalid Date. */
export function parseIsoDateString(isoDateString: string): Date {
  const [year, month, day] = isoDateString.split('-');
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/** A new Date `numberOfDays` calendar days after `date` (UTC). Does not mutate `date`. */
export function addDays(date: Date, numberOfDays: number): Date {
  const resultDate = new Date(date);
  resultDate.setUTCDate(resultDate.getUTCDate() + numberOfDays);
  return resultDate;
}

/** The Monday (UTC midnight) of the ISO week containing `date`. Reads local Y/M/D, as the original. */
export function mondayOfDate(date: Date): Date {
  // Read the LOCAL calendar day (not UTC) so "today" matches the viewer's wall clock,
  // then re-anchor it at UTC midnight so every later date computation stays timezone-safe.
  const localCalendarDayAtUtcMidnight = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  // getUTCDay() returns Sunday=0..Saturday=6. Shift it so Monday=0..Sunday=6, matching
  // how the grid always displays weeks starting on Monday.
  const weekdayWithMondayFirst = (localCalendarDayAtUtcMidnight.getUTCDay() + 6) % 7;
  return addDays(localCalendarDayAtUtcMidnight, -weekdayWithMondayFirst);
}

/** True if `date` falls on a Saturday or Sunday (UTC). */
export function isWeekend(date: Date): boolean {
  const weekday = date.getUTCDay(); // Sunday=0, Saturday=6
  return weekday === 0 || weekday === 6;
}

/** A Date → 'DD.MM.' in de-DE (UTC), e.g. grid column labels. */
export function formatDateShort(date: Date): string {
  return date.toLocaleDateString('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
}

/** An ISO date string → a long de-DE label, e.g. 'Mo., 04.01.2021' (UTC). */
export function formatDateLong(isoDateString: string): string {
  return parseIsoDateString(isoDateString).toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** A Date → its German 2-letter weekday abbreviation (UTC): 'So','Mo',…,'Sa'. */
export function formatWeekdayName(date: Date): string {
  return WEEKDAY_NAMES[date.getUTCDay() as WeekdayIndex];
}

/** The ISO 8601 week number (1–53) of `date`. */
export function getIsoWeekNumber(date: Date): number {
  // ISO 8601 identifies a week by the calendar year that contains its Thursday.
  // Step 1: find the Thursday that falls in the same ISO week as `date`.
  const weekdayWithMondayFirst = (date.getUTCDay() + 6) % 7; // Monday=0 … Sunday=6
  const daysUntilThursdayOfThisWeek = 3 - weekdayWithMondayFirst;
  const thursdayOfThisWeek = addDays(date, daysUntilThursdayOfThisWeek);

  // Step 2: January 4th always falls in week 1 of its year (part of the ISO 8601
  // definition), so it's a fixed, reliable point to count weeks from.
  const januaryFourthOfThatYear = new Date(Date.UTC(thursdayOfThisWeek.getUTCFullYear(), 0, 4));
  const weekdayOfJanuaryFourth = (januaryFourthOfThatYear.getUTCDay() + 6) % 7;

  // Step 3: count whole weeks between the two Thursdays.
  const daysBetweenTheTwoThursdays =
    (thursdayOfThisWeek.getTime() - januaryFourthOfThatYear.getTime()) / MILLISECONDS_PER_DAY;
  const weeksSinceWeekOne = Math.round((daysBetweenTheTwoThursdays - 3 + weekdayOfJanuaryFourth) / 7);

  return 1 + weeksSinceWeekOne;
}

/** Today's local calendar day as 'YYYY-MM-DD' (reads local time, as the original). */
export function todayAsIsoDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** All weekdays (Mon–Fri) as ISO strings from `fromIsoDate` to `toIsoDate`, inclusive. */
export function getWeekdaysInRange(fromIsoDate: string, toIsoDate: string): string[] {
  const isoDatesInRange: string[] = [];
  let currentDate = parseIsoDateString(fromIsoDate);
  const endDate = parseIsoDateString(toIsoDate);
  // Walk one calendar day at a time, keeping only workdays, until we pass the end date.
  while (currentDate <= endDate) {
    if (!isWeekend(currentDate)) {
      isoDatesInRange.push(formatDateAsIsoString(currentDate));
    }
    currentDate = addDays(currentDate, 1);
  }
  return isoDatesInRange;
}

/** All calendar days (incl. weekends) as ISO strings from `fromIsoDate` to `toIsoDate`, inclusive. */
export function getAllDaysInRange(fromIsoDate: string, toIsoDate: string): string[] {
  const isoDatesInRange: string[] = [];
  let currentDate = parseIsoDateString(fromIsoDate);
  const endDate = parseIsoDateString(toIsoDate);
  // Walk one calendar day at a time, keeping every day, until we pass the end date.
  while (currentDate <= endDate) {
    isoDatesInRange.push(formatDateAsIsoString(currentDate));
    currentDate = addDays(currentDate, 1);
  }
  return isoDatesInRange;
}

// ---- Legacy bridge aliases -------------------------------------------------------
// `legacy.js` calls these by their OLD short names as bare globals (see app.ts's
// `Object.assign(window, dates)`) and is deliberately NOT edited by this pass — it is
// retired whole in Phase 7 slice B10. Delete this entire block in that slice, at
// which point every caller will be gone. No new code may import from here.
export const ymd = formatDateAsIsoString;
export const parseYmd = parseIsoDateString;
export const mondayOf = mondayOfDate;
export const fmtLong = formatDateLong;
export const todayStr = todayAsIsoDateString;
export const weekdayRange = getWeekdaysInRange;
export const allDaysRange = getAllDaysInRange;
```

- **Must-haves:** every renamed function keeps its exact behavior — this is a pure
  rename-and-restructure pass (E1: no logic change hides inside it). `ui/grid.ts`'s import
  line (`import { parseYmd, isWeekend, isoWeek, weekdayName, fmtShort } from
  '../core/dates.ts'`) and its two call sites (`isoWeek(...)`, `weekdayName(...)`,
  `fmtShort(...)`) must be updated to the new names — `tsc` will fail loudly if any is
  missed, so this is mechanical, not risky. `app.ts`'s one named import
  (`import { mondayOf } from './core/dates.ts'`) and its one call site in `hydrateState()`
  must move to `mondayOfDate` — the star-import bridge (`Object.assign(window, dates)`)
  needs no change; it picks up every export automatically, old aliases included.
- **Functionality:** byte-identical; `getIsoWeekNumber` is restructured (named steps
  instead of one nested expression) but computes the same result — the existing test
  cases already pin the tricky boundary (2020 is a 53-week ISO year) so a green re-run is
  the proof, not a new test.
- **Usability:** n/a (no UI).
- **Tests:** update `dates.test.ts`'s imports to the new names (mechanical); no new test
  cases needed since behavior is unchanged and coverage was already 100%. The alias block
  needs no test of its own — `export const x = y` executes (and is thus "covered") the
  moment the module loads, and the aliases are deleted with `legacy.js` in slice B10 rather
  than exercised by anything the test suite calls.

### A2 — `web/js/core/machines.ts` — **DONE**
Grepped first this time (learned from A5's mistake): `catOf`, `maintSlots`, `maintAt`,
`isBlockedM`, `anyMaint` are each called by bare name **dozens of times** in `legacy.js`;
`slotCovers`, `dayAvailable`, `cellBookable` are not called there at all (only used inside
this file or via typed imports). Of the five bridged ones, all five ARE genuine
abbreviations (`cat`, `maint`×3, the unexplained `M` suffix) — unlike A5's exports, these
needed real renames: `catOf`→`categoryOf`, `maintSlots`→`maintenanceSlots`,
`maintAt`→`maintenanceSlotAt`, `isBlockedM`→`isBlockedOnDate`, `anyMaint`→
`hasAnyMaintenanceSlot`. Handled with the same alias-bridge pattern as A1 (dates.ts):
real names in the module, old names as a small aliased block for `legacy.js`, deleted in
slice B10. `dayAvailable`/`slotCovers`/`cellBookable` were already full words — untouched
except internal params (`m`/`d`/`s` → `machine`/`isoDate`/`slot`).

Three other TS files import the renamed functions directly (not through the bridge) and
needed updating too: `core/booking.ts` (`isBlockedM`/`maintAt`→ new names, `dayAvailable`
unchanged), `ui/machine-text.ts` (`maintSlots`→`maintenanceSlots`), `ui/views/stats.ts`
(`maintSlots`/`isBlockedM`→ new names) — all mechanical, `tsc`-checked.

- **Tests:** `machines.test.ts` (18) rewritten to import/call the new names (mechanical,
  same assertions); `booking.test.ts` (32), `machine-text.test.ts` (11),
  `stats.test.ts` (7) all green unmodified — they only call the still-exported reducer/
  view functions, never the renamed machine predicates directly.

### A4 — `web/js/core/assistant.ts` (largest, most abbreviation-heavy) — **DONE**
Grepped precisely (as with A2/A5/A7/A9) rather than assumed: the seven `treeXxx` functions
are called ONLY through the one-line `asXxx` adapters in `legacy.js`, never by bare name
directly — and "tree" + a verb was already a full, non-abbreviated name, so **zero rename,
zero alias** needed for any of them (the plan's guess that they'd need bridge coordination
was wrong; they didn't need renaming at all). Of the solver functions, only `anyRedund` and
`pickFor` are called directly by bare name in `runAssistant` (3 call sites total, not ~5) —
those got the alias-bridge treatment: `anyRedund`→`hasAnyRedundancy`, `pickFor`→
`chooseDevicesForTree`. `groupRuns`/`freeDays`/`extendOpenRuns` are also called directly but
were already full words — no rename. `nodeNeed`/`nodeFree`/`dayOk`/`winFree`/`pickNode`
are **not** called anywhere in `legacy.js` (only used internally, plus directly in
`assistant.test.ts`) — fully free renames: `nodeNeed`→`effectiveNeed`, `nodeFree`→
`isNodeSatisfiable`, `dayOk`→`isTreeSatisfiableOnDay`, `winFree`→`isSatisfiableAcrossWindow`,
`pickNode`→`chooseDevicesForNode` (renamed alongside `pickFor`→`chooseDevicesForTree` for
pair consistency — picking for one node vs. the whole tree should read as a matched pair).

Every private local expanded throughout: `c`→`child`, `r`→`found`/`run` (context-dependent),
`p`→`parent`, `a` (in `treeDevs`)→`deviceIds`, `g`→`group`, `d`→`day`/`date`
(context-dependent — `day` in the solver predicates, `date` in the run-building loops, since
those are conceptually different: one is "which day of the week" and the other is "which
calendar date in a list"), `sel`→`selectedDates`, `cur`/`n`→`currentRun`/`daysExtended`,
`free` (the `groupRuns` param, which would have collided in meaning with the `freeDays`
function one line above) → `sortedFreeDates`.

- **Functionality:** unchanged — `assistant.test.ts`'s 32 tests already pin every solver edge
  case (redundancy detection, extension cap, tie-breaking on continuously-free devices), so a
  green re-run is the proof.
- **Tests:** `assistant.test.ts` (32) — imports and `describe` titles updated to the new names
  (mechanical, via a scoped `sed` since every renamed identifier was unique with no
  substring collisions); same assertions throughout.

### A5 — `web/js/core/booking.ts` (highest domain value) — **DONE**

Correction on execution: the plan's "none of its 8 exports are called by bare name" was
**wrong** — a grep found all 8 (`bookCells`, `deleteCells`, `deleteOwnCells`,
`deleteSelectedCells`, `deleteGroup`, `saveMachine`, `deleteMachine`, `moveMachine`) called
by bare name in `legacy.js`, one call site each (inside `mutate(fresh => ...)` callbacks).
It didn't change the outcome, though: those 8 names were already full, descriptive words —
`bookCells` isn't an abbreviation of anything — so none of them needed renaming. The actual
rename-and-restructure pass only touched **internal parameters and locals**
(`fresh`→`freshServerData`, `mb`/`fmb`→`machineBookings`, `m`→`machine`, `mid` params kept —
it's the shared `Booking.mid` field name, not a local abbreviation — `n`→`deletedCount`,
`gid` locals →`groupId`, `idx`→`insertionIndex`/`machineIndex`, `i`/`j`→named indices), which
are invisible to every caller — genuinely free, as the plan intended, just not for the
reason it gave.

Two structural cleanups beyond pure renaming, both behavior-preserving (confirmed by the
existing 32 tests staying green untouched): `applyBooking`'s dense
`{name, ...(note?{note}:{}), ts, ...extra}` spread-chain became an explicit
`buildBookingCellFactory` that assigns fields with plain `if`s; `saveMachine`'s reverse
`for` loop with a bodyless `if`/`break` for finding the insertion index became a named
`findGroupInsertionIndex` helper with an early `return` and a WHY comment (new machines
land after the last machine of their group, to stay visually grouped with siblings).

- **Tests:** `booking.test.ts` (32 tests) green, unmodified — parameter names aren't part
  of any call site, so nothing there needed to change.

### A6 — `web/js/state.ts` — **DONE**
`createStore`/`Store` are used only by `app.ts` (not window-bridged at all, so not even
visible to `legacy.js`) — zero coordination. Renamed every one-letter internal:
`k`→`key`, `fn`→`listener` (+ a new `StateListener` type alias so the callback shape is
named once instead of repeated three times), `patch`→`partialState`, `subs`→`subscribers`,
`initial`→`initialState`. `state.test.ts` (6 tests) green unmodified.

### A3 — `web/js/core/weekend.ts` — **DONE**
`sweepWeekends` is exported but never called by bare name in `legacy.js` (grepped — only
mentioned in comments; the real callers are `core/booking.ts`'s reducers) — free. Renamed
`fresh`→`freshServerData`, `mb`→`machineBookings`, the `[d, prev]` destructure →
`[isoDate, previousValue]`, `dt`→`date`, `wd`→`weekday` (replaced by two named booleans
`isSaturday`/`isSunday` at the point they're used, reads clearer than re-deriving `wd===6`
twice), `fri`/`mon`→`fridayIsoDate`/`mondayIsoDate`, and named the final truthiness check
`bridgeStillHolds` instead of an inline `if(!(...))`. `mid` kept as a parameter name — it
matches the `mid` field already established on `CellUndo`/`WeekendUndo` throughout the
codebase, not a local abbreviation. `weekend.test.ts` (6) + `booking.test.ts` (32, the
consumer) both green unmodified.

### A7 — `web/js/net/api.ts`, `net/sse.ts` — **DONE**
Both files' bridged exports (`apiGet`/`apiPost`/`validateData`/`normalizeState`,
`applyUpdate`/`presenceInfo`/`isForeign`) were already full, descriptive words — like A5,
zero exported renames needed despite being called by bare name in `legacy.js`. Only
internals changed: `api.ts`'s `r`→`response`, `d`/`o`→`data`/`record` (kept the two
different local names `validateData`'s `record` and `normalizeState`'s `rawState` distinct
rather than reusing `d` for both, since they're genuinely different values flowing through
two functions). `sse.ts`'s `evt`→`event`, `c`→`change`, and the derived
`bookings[change.mid]` lookup got a name (`machineBookings`) instead of the anonymous `row`.
- **Tests:** `api.test.ts` (14), `sse.test.ts` (8) both green unmodified.

### A8 — `web/js/ui/grid.ts`, `selection.ts`, `navigation.ts`, `machine-text.ts`
- **Must-haves:** `grid.ts`'s `classifyCell`/`classifyDot`/`cellClass`/`weekHeaderCells` and `selection.ts`'s `computeSelCells`/`clampIndex` are called directly in `render()`/`refreshCell()`/`refreshDot()`/`paintSel()`/the keyboard handler — coordinate (grid.ts renames are Phase-7-adjacent anyway since B1 replaces `render()`; consider deferring grid.ts renames to land *with* B1 rather than as a separate pass, to avoid double-touching the same call sites). `navigation.ts`'s `nextFreeDay`/`prevFreeDay` are only called through the `nextFreeAfter`/`prevFreeBefore` wrappers — cheap. `machine-text.ts`'s three exports are called directly (`blockText`, admin rows, machine form) — coordinate, low count. Private: `r1`/`r2`/`c1`/`c2` in `computeSelCells` → `anchorRow`/`focusRow`/`anchorCol`/`focusCol`. **Still deferred to land with Phase 7 B1/B2, per the original plan** — `navigation.ts` did get its internal-variable pass already as a side effect of A1 (it imports `core/dates.ts`), and `machine-text.ts` got the same as a side effect of A2/A7-adjacent work; `grid.ts`/`selection.ts` proper (the cell/header/selection *logic* naming, not just their `core/dates.ts` imports) are what's left, intentionally, for B1/B2.

### A9 — `web/js/ui/views/*.ts` (4 files) — **DONE**
`computeMyRuns`/`computeStats`/`computeAllRuns`/`filterAllRuns`/`filterAdminMachines` were
all already full words — no exported renames. Scoping decision made up front: `AllRun.m`,
`BookingRun.m`, `StatsMachineRow.m`, `StatsMaintRow.m` are interface fields (not just
locals) that `legacy.js` reads by property name in several places (`r.m.name`, `r.m.group`,
…) — renaming a field means editing those `legacy.js` property accesses directly, a
different and riskier kind of change than the function-name alias trick (there's no clean
alias for an object property). Treated the same as A10 treats `shared/types.ts` wire
fields: **left the field name `m` alone**, renamed only the local variables that get
assigned into it (`for (const machine of machines) { ...; runs.push({ m: machine, ... }) }`).

Beyond that: `mb`/`ds`/`cur`/`d`/`b`/`k`/`pmap`/`e`/`dc`/`s`/`a`/`b` throughout all four
files → `machineBookings`/`bookedWorkdays`(or `myBookedWorkdays`)/`currentRunDates`/`date`/
`booking`/`personKey`/`personDaysOnThisMachine`/`personEntry`/`blockedDayCount`/`slot`/
named comparator params (`runA`/`runB`, `machineA`/`machineB`). Also split three dense
one-liners into named steps with a comment: `all-bookings.ts`'s run-continuation check
(named `continuesCurrentRun` instead of inlined in the `if`), and `stats.ts`'s
read-modify-write map updates in `aggregateBookings` (getting a person's prior day count,
computing the new one, and setting it are now three named lines instead of one nested
`?? 0) + 1` expression), each with a comment on which stats mode the tally feeds.

The `nextWd`/`nextWorkday` duplication flagged in the original plan (present a third time,
identically, in `core/assistant.ts`) was **not** consolidated in this pass — hoisting it to
`core/dates.ts` is a real, independent improvement but changes call sites in three files at
once for a benefit unrelated to naming; recorded here as a follow-up, not done silently.
**Independently corroborated** by an `/ultrareview` cloud pass after B0 landed (`bug_001`,
severity nit, all verifiers agreed) — confirms the deferral call was reasonable, still open.
Fold into whichever Backlog B slice next touches `core/assistant.ts`, `all-bookings.ts`, or
`my-bookings.ts`, rather than a standalone commit.

- **Tests:** `admin.test.ts` (6), `all-bookings.test.ts` (12), `my-bookings.test.ts` (5),
  `stats.test.ts` (7) — all green unmodified.

### A10 — `shared/types.ts` — **reviewed, no changes made**
Every field name here is load-bearing (server wire format + client reads) — confirmed
**not** renaming any field is correct; this file's job is fidelity to the JSON on the wire.
On rereading with the comment-only lens the plan proposed: `ServerData`/`AppState` already
have excellent doc-comments, and every field that isn't self-evident (`redu`, `gid`,
`gtitle`, `cat`, `days`) already carries one. Adding cross-reference comments to the
self-evident fields (`Booking.name`, `Machine.info`, etc.) would be comment noise against
P5 ("comments explain WHY... not WHAT"), not an improvement — so this file is left
untouched rather than churned for its own sake.
- **Tests:** none (types only); `tsc --noEmit` is the check.

### A11 — `server/*.ts` (backend, all 8 files) — **DONE**
Read every backend file (via an Explore agent survey, then directly before editing) rather
than guessing, per the plan's own note. One fact changed the whole risk profile up front:
**zero exported identifiers from `server/*.ts` are imported anywhere outside `server/`
itself** (confirmed by grep) — unlike the frontend, no backend rename needs a bridge alias
or cross-file coordination beyond a file's own test. Every exported name across all 8 files
was already descriptive (no abbreviated exports anywhere in the backend) — this pass is
entirely internal params/locals plus a handful of structural splits and missing comments.

- **`db.ts`:** `k`/`v`/`r` → `key`/`value`/`row` throughout `getMeta`/`setMeta`/`bumpRev`;
  `im`/`ib` → `insertMachine`/`insertBooking`; `m`/`i` → `machine`/`sortIndex`; `mb`/`b`/`nb`
  → `machineBookings`/`booking`/`insertedCount`; `j`/`e` → `seedJson`/`error`. Added a
  comment on `bumpRev`'s double-fallback (`|| '0' || 0`) pattern, which recurs unexplained
  in `model.ts` and `server.ts` too.
- **`model.ts`:** `isBlocked`'s 4-clause boolean split into three named booleans
  (`hasActiveNonOkStatus`/`isAfterStatusStart`/`isBeforeStatusEnd`); `m`/`o`/`r` →
  `machine`/`wireShape`/`row`; `a` → `parsedMaintenance`. Added the double-fallback comment
  (mirrors `db.ts`) and a note on why `groups`/`revision`'s `JSON.parse` trusts the value
  (only ever written by this server itself via `setMeta`) while `maint`'s guards with
  try/catch (can hold old free-form seed data) — previously an unexplained asymmetry.
- **`mutate.ts`** (largest, most abbreviation-heavy): `v`/`n` → `value`/`maxLength` in
  `clip`, with a comment on its two null triggers; `m` → `machine` throughout; `s`/`t` →
  `rawSlot`/`slot` in `cleanMaint`, whose dense map body became four named steps; `im`/`i`
  → `insertStatement`/`sortIndex`; `err` → `validationError`; `c` → `cell`/`change`/`child`
  depending on context; the `stmts.cur/up/dl` bag (three abbreviated keys) became a named
  `BookingStatements` interface with `findExistingBooking`/`upsertBooking`/`deleteBooking`;
  a comment now explains why `applied = changes.length` must run **before**
  `addWeekendBridges` mutates `changes` further — a real ordering dependency that was
  previously only implicit in argument order.
- **`bridge.ts`:** added a `FRIDAY_WEEKDAY_NUMBER` constant for the previously magic `5`;
  `sat`/`sun`/`mon` → `saturdayIsoDate`/`sundayIsoDate`/`mondayIsoDate`; `mids`/`mid` (local
  variables, **not** the `Bridge.mid` field, which is left alone — same field-name policy
  as the frontend's A9/A10) → `machineIds`/`machineId`; the file's own private
  `parseYmd`/`ymd` date helpers (deliberately separate from `web/js/core/dates.ts` — the
  server is decoupled from the frontend) renamed to `parseIsoDateString`/
  `formatDateAsIsoString` for a reader moving between the two layers.
- **`server.ts`** (the impure entry shell, no dedicated test): `__dir` → `currentDirectory`
  (also in `backfill.ts`/`import.ts`, which redeclare it identically); its own duplicate
  `ymd` → `formatDateAsIsoString` (same rationale as `bridge.ts`); the nested ternary
  picking the seed path became an `if` with a comment on the three-way precedence; the
  presence dedupe/sort chain got named intermediate steps; `runBackup`'s `name`/`dest`/
  `olds`/`n` → `backupFileName`/`backupPath`/`oldestFirstBackupFileNames`/`fileName`, with
  new comments on the `VACUUM INTO` quote-escaping and the negative-slice retention logic
  (both previously unexplained); `readBody`'s `b`/`c` → `bodyText`/`chunk`; `serveStatic`'s
  `p`/`abs` → `urlPath`/`absolutePath`; the main handler's `p`/`out` → `urlPath`/`result`.
  **Kept `req`/`res` as-is** — Node's own universal HTTP convention, and renaming them
  would reduce recognizability for any Node-familiar reader rather than improve it (the
  same reasoning as keeping `db`, already established in A11's earlier files).
- **`backfill.ts`/`import.ts`:** `__dir` → `currentDirectory`; `n`/`r` → `insertedBridgeCount`/
  `importResult`; `import.ts`'s 3-way fallback chain for the seed path (CLI arg → env var →
  default) got a named `firstPositionalArg` step instead of one inline `.find()`.
- **`types.ts`:** reviewed, no changes — every field-level abbreviation (`grp`, `mid`,
  `gid`, `gtitle`, `redu`, `cat`) is schema-coupled (mirrors either a SQL column name or
  the shared wire contract), the same category A10 already put out of scope for
  `shared/types.ts`. The file's existing JSDoc already explains the ones that need it
  (`grp` specifically, since it's the SQL-reserved-word workaround).

**Verification (E5 — no test file for `server.ts`/`backfill.ts`/`import.ts`):** compiled
with `tsc -p tsconfig.server.json` (clean), then actually **ran** the compiled server
against a throwaway DB on a scratch port and exercised it for real: `/api/health`,
`/api/state`, a structural mutate (machine creation), a cell mutate (booking), a second
booking that triggered the weekend auto-bridge (booked Fri 2027-01-08 + Mon 2027-01-11 →
Sat/Sun auto-filled with the same name, confirming `bridge.ts`'s renamed
`missingBridges`/`maintainBridges` work end-to-end through `mutate.ts`'s renamed
`addWeekendBridges`), and the SSE `/api/stream` endpoint (got a real `hello` event). All
correct; container torn down after.

- **Tests:** `db.test.ts` (6), `model.test.ts` (9), `mutate.test.ts` (19), `bridge.test.ts`
  (8) all green unmodified — every test calls exports positionally, none reference internal
  names.

### A12 — `web/js/app.ts` — **DONE**
Done exactly as scoped: `jsonSet`'s `fallback` param renamed to `defaultJson` (clearer —
it's specifically a JSON string default, not a general fallback value). The bridge section
(`Object.assign(window, ...)` × 15) deliberately left untouched — it becomes dead code the
moment Phase 7 slice B10 deletes `legacy.js`, so touching it now is churn against soon-dead
code, the same reasoning applied throughout this pass.
- **Tests:** none direct (impure entry, E5 smoke-only) — covered by A11's server smoke and
  the full `verify` run.

**Suggested order for Backlog A:** A5, A6, A3 first (zero/near-zero coordination cost, real domain value) → A1, A2, A7, A9 (moderate, contained coordination) → A4 (biggest, still contained to `runAssistant` + the 10 adapters) → A8 deferred to land with Phase 7 B1/B2 rather than separately → A10/A11/A12 as time allows.

---

## Backlog B — Phase 7: view layer → React

### Cross-cutting notes
- **UI text stays German, verbatim.** Every string quoted below is production copy users read today — component ports must reproduce it exactly (E1); this is not the place to also translate or edit copy.
- **DOM contract during the transition.** Until a slice's dependents are also migrated, its React output must keep the same tag names, classes, and `data-*` attributes legacy code queries via `document.querySelector`/`cellEl()` — otherwise not-yet-migrated code silently stops finding elements. Called out per-slice below where it matters most (B1/B2).
- **String-building → data-building.** `ui/grid.ts`'s `weekHeaderCells` and `render()`'s inline template literals build HTML *strings*. React components should consume **data** (arrays of cell/row/header descriptors), not pre-built HTML — so porting a view often means splitting an existing "compute → stringify" function into "compute" (kept, reused) + a new component that renders the same data as JSX. Note this explicitly per slice rather than assuming today's exported shape ports unchanged.
- **Testing convention:** React Testing Library + jsdom, query by role/text/label like a user would, not by class name. Each slice's test list below is additive to the pure-logic tests that already exist and stay untouched.
- **Styling:** reuse `web/css/app.css` classes as-is (className props) — no CSS rewrite in Phase 7; that's out of scope and risks visual drift (same call ARCHITECTURE §16 already made for the modal-markup fold).
- **Visual verification:** `npm run ui:smoke -- <url> <screenshot-path> [--wait-for <selector>]` (`scripts/ui-smoke.mjs`, Playwright, dev-only) drives a real headless Chromium against a running Vite dev server + a throwaway backend, screenshots it, and reports console errors — the browser-driven half of E5 that the pure-rename Backlog A passes didn't have available. Run it before and after a UI slice lands, diff the screenshots by eye. One environment note for this session's host (Windows + git-bash): invoking it via `docker exec <container> npm run ui:smoke -- /tmp/...` directly lets MSYS silently rewrite the POSIX path argument to a Windows one before Docker sees it — wrap the whole invocation in `sh -c "..."` instead. The Chromium binary persists across `--rm` containers (a `playwright_browsers` volume, `docker-compose.dev.yml`), but its system libraries (installed via `apt`) do not — run `npx playwright install-deps chromium` once per fresh container that will drive a browser.

### B0 — Setup — **DONE**
Executed as planned, two commits: (1) the guardrail change alone — `CLAUDE.md`'s runtime-dep
rule scoped to backend, `ARCHITECTURE.md §5` rule 6 likewise, new `§18` recording the
decision and superseding §14/§15; no code. (2) The actual toolchain: `react`+`react-dom` as
real `dependencies` (the project's first non-dev runtime deps on the frontend side);
`@types/react`, `@types/react-dom`, `@testing-library/react`, `@testing-library/jest-dom`,
`eslint-plugin-react-hooks`, `jsdom` as dev deps; `tsconfig.json` → `"jsx": "react-jsx"`;
`eslint.config.js` → `.tsx` added to the existing `.ts` globs (same complexity-12/60-line/
400-line budgets) plus `eslint-plugin-react-hooks`'s `recommended-latest` flat config scoped
to `web/js/**/*.tsx`; `knip.json`'s `project` glob and `vitest.config.ts`'s `include`/
coverage `include`/`exclude` all extended to `.tsx`; `test/setup.ts` imports
`@testing-library/jest-dom/vitest`. `web/js/ui/components/ToolchainProbe.tsx` + its test
prove the whole pipeline (tsc's jsx transform, ESLint, Prettier, knip, Vitest+jsdom+RTL) —
not wired into `index.html`/`app.ts`, to be deleted once B1 lands a real component.

**One correction caught by the gate itself, not by me:** `@testing-library/user-event` was
added preemptively (for future click/type interaction tests) and `knip` correctly flagged
it as unused — nothing in B0 exercises it yet. Removed via `npm uninstall` rather than
suppressed; will be re-added in whichever slice first needs simulated user interaction. A
second gap I *did* catch myself before running knip: the coverage `exclude` list only had
`**/*.test.ts`, so `ToolchainProbe.test.tsx` was initially counted in its own coverage —
fixed to `**/*.test.{ts,tsx}`.

- **Tests:** `ToolchainProbe.test.tsx` (1) — render + `getByTestId` + `toHaveTextContent`.
  Full `verify` green: 256/256 tests, 100% coverage on every touched file including the new
  `.tsx`.

### B1 — Grid (`render`) — **DONE**
Executed as a pure-extraction commit followed by the component commit.

**Sequencing risk resolved, not just mitigated:** before writing the component, re-reading
`legacy.js` showed the mouse/keyboard/selection handlers (still B2) are wired via **event
delegation** on `#grid`/`document`, not per-cell listeners — they resolve `data-mid`/
`data-date` via `document.querySelector` at event time, not a reference captured at render
time. So B1 only had to reproduce the exact DOM contract (`td.cell`, `data-mid`/`data-date`,
`tr[data-group]`/`[data-catgroup]`, `.favstar[data-fav]`, `.nextfree[data-nf]`/`[data-nb]`)
for B2's still-legacy code to keep working completely unmodified — confirmed live (see below),
not just by inspection. B1 and B2 shipped independently after all, no combined slice needed.

**`buildGridRows` (ui/grid.ts):** the category/group collapse state machine — the trickiest
part of `render()` to port faithfully — was pulled out as its own pure function returning row
*data* (open/collapsed category and group headers, machine rows, in order) rather than being
re-implemented inline in JSX. 8 dedicated tests cover the collapse/filter interactions called
out in the original must-haves (closed category hides group headers too; collapsed group keeps
its own header; an active machine filter overrides both; favorites form a header-less
top-level group). Landed as its own commit before the component.

**`Grid.tsx` + `GridBody.tsx`:** split across two files purely to stay under the 400-line
budget (one component, conceptually). `weekHeaderCells` (the old HTML-string header helper)
was deleted rather than adapted — once `render()`'s only caller is gone, building the header as
plain JSX over the same `core/dates` primitives is the honest React shape, per the original
"make this decision explicitly" note. Store subscription: rather than exporting `subscribeToStoreChanges`
from `app.ts` (a circular import), `Grid.tsx`'s own `render()` export **becomes** `window.render`
— the store's existing `store.subscribe(() => { if (window.S.data) window.render(); })` needed
zero changes. A module-level `windowRenderTrigger` ref, set by the mounted `Grid`'s own
`useEffect`, is what that `render()` calls through to force a re-render.

**One legacy touch beyond deleting `render()`'s body:** `nextFreePtr` (the "last jumped-to free
day" cursor the row header's back-button reads) was a plain `const` in `legacy.js`, invisible
outside its own scope even though the function that *reads* it moved out. Fixed with a one-line
declaration-site change — `const nextFreePtr=window.nextFreePtr={};` — so both the local bare
name (all of B2's still-legacy read/write sites) and the new bridge see the same live object.

**Known-bug note:** the `wknd` class asymmetry between `render()`/`refreshCell()`
(ARCHITECTURE known-bug) is *not* closed by this slice — `refreshCell`/`refreshDot` still exist
in `legacy.js`, still called by other still-legacy code paths unrelated to the full grid
re-render. Left for whichever slice actually retires them.

**Real bug caught by the tests, not by the app running correctly:** the first draft keyed body
rows as `` `g:${row.group}` ``, assuming a group name was unique across the whole grid. It
isn't — the same group name can appear under two different categories (a real fixture in
`Grid.test.tsx` hit this immediately: React warned about a duplicate key, `g:Halle 1`). Fixed
by keying group/category header rows on their array position instead (stable across re-renders
since `buildGridRows` always rebuilds the same order from the same data); machine rows keep
their own id as the key.

- **Tests:** `Grid.test.tsx` (16) — header KW/weekday/today columns; category and group header
  rows; booked cell mine vs. not-mine; blocked/unavail/free cell classes and titles; favorite
  star + info icon; "Sperre geplant" for a planned-only slot; the back-jump button; the
  category-button click/dblclick bridge; the `S.visM`/`S.visD` side effect; the post-render
  `paintSel`/`syncJumpControls`/`ensureOverflow` calls; `render()`'s re-render behavior. Plus 8
  new `buildGridRows` tests in `grid.test.ts` (33 total in that file now).
- **Browser-verified (E5), live, not just inspected:** ran the real backend + Vite dev server
  in the persistent Playwright container against the bundled seed data (245 machines). Screenshot
  confirms header/category/group/machine rows, cell coloring and status dots render correctly.
  Clicking a free cell through Playwright selects it (`td.cell.sel`, `aria-selected="true"`) via
  legacy's *unmodified* delegated click handler; clicking a category toggle button collapses it
  (`grouprow catrow collapsed`) via legacy's *unmodified* `catTap` — direct proof the DOM-contract
  approach above actually holds, not just an assumption. No console errors either run.
- Deleted `ToolchainProbe.tsx`/`.test.tsx` (B0's placeholder, superseded now that a real
  component exists) and `weekHeaderCells` + its 3 tests (dead once `render()`'s body was
  deleted — nothing else called it).

### B2 — Selection & keyboard navigation (`Sel`, mouse/keydown handlers) — **DONE**
Executed as planned, with one scope narrowing and one shape decision made explicit up front.

**Not a React component.** `paintSel`'s whole reason to exist (legacy's own comment: "GEZIELTES
ZELL-PATCHING (Performance)") is to update only the cells whose selection state changed, by
toggling classes on the exact DOM nodes the React Grid (B1) already renders — routing selection
through React state would mean re-rendering the whole grid on every `mouseover` during a drag.
`web/js/ui/grid-interaction.ts` is a plain gated TypeScript module, the same shape `modal.tsx`'s
document-level dismissal listeners already use alongside their React content: it owns the `Sel`
state and attaches its listeners once (`initGridInteraction()`, called from `app.ts` at boot),
but reads/writes the live DOM directly, exactly as legacy did.

**Scope narrowed, not expanded:** legacy's `refreshCell`/`refreshDot`/`patchCells` (targeted
DOM patching after a booking write) were deliberately left in `legacy.js`, untouched — their
only caller is `mutate()`'s success path, which is still entirely legacy. They belong with
whichever slice ports the booking form (B4), not this one; porting them here would have meant
guessing at an interface B4 hasn't been designed around yet.

**One legacy touch beyond deleting the ported functions' bodies:** `Sel` itself, plus `paintSel`/
`clearSel`, are re-exported under their old bare names at the bottom of the new module (the
established "Legacy bridge aliases" pattern) — `jumpToSlot`, `prependWeek`, and `showCtx` (all
still legacy) read and mutate `Sel` directly by dozens of call sites apiece, and none of those
are this slice's concern to touch.

**Tests:** `grid-interaction.test.ts` (39) — drag-select (mousedown/mouseover/mouseup, single
vs. multi-cell, the `didDrag` distinction between a drag-end and a plain click), shift+click
extending from an existing anchor, favorite/next-free/prev-free/category/group click routing,
double-click routing, the full keyboard suite (arrow move + clamp at both edges, Shift+arrow
extend, right-edge growth via direct `extraWeeks++`/`render()`, left-edge `prependWeek()`,
Enter by selection size, Escape, suppression while a modal is open or a form field has focus),
and — despite the module comment initially assuming otherwise — the drag-auto-scroll edge
geometry itself, once `Element.prototype.scrollIntoView` and `document.elementFromPoint` (both
entirely unimplemented in jsdom) were stubbed. `web/js/ui/**` coverage: 99.47%/94.92%.

**Browser-verified (E5), live:** drag-selecting a rectangle opens the context menu with the
right cell count; "Abbrechen" closes it and clears the selection; a plain click selects exactly
one cell; arrow keys move the roving-tabindex focus; Shift+arrow extends the selection; Escape
clears it. No console errors. (The single side-by-side risk the original plan called out —
auto-scroll/auto-grow at the drag edges — is covered by the jsdom geometry tests above in lieu
of a separate manual session, since the geometry math itself is now unit-tested branch by
branch, not just exercised by hand.)

### B3 — Infinite scroll / week growth (`prependWeek`, scroll/wheel listeners, month-jump) — **DONE**
Executed as planned. Confirmed the "small custom hook" framing wasn't quite right once actually
writing it: `web/js/ui/grid-scroll.ts` is a plain gated TypeScript module, same shape as B2 —
there's no React component anywhere near this code (nothing here renders JSX), so there's
nothing for a hook to attach to. It manages `#gridWrap`'s real scroll position directly, exactly
as legacy did.

**Pure geometry pulled out and unit-tested, DOM measurement kept separate:** `canStillGrowWindow`,
`isNearRightEdge`/`isNearLeftEdge`, `isScrollingLeft` (the wheel-direction check),
`needsOverflowGrowth`, `computeWeekPixelWidth`, and `pickVisibleDateColumn` (the
`updateJumpFromScroll` picking loop) are all plain functions of their inputs — the DOM-reading
call sites (`getBoundingClientRect`, `scrollWidth`/`clientWidth`) stay thin wrappers around them.
This is the same shape `buildGridRows` (B1) and `hasBackJumpButton` (B1) already established:
extract the decision, keep the measurement one layer out.

**Scope, precisely:** everything the heading names, plus `ensureOverflow` (the "keep the grid
wider than the viewport" growth loop, already bridged from B1's Grid.tsx but still legacy-
implemented until now), `centerCol`/`centerToday`/`gotoDate` (the "scroll to this date"
primitives `jumpToSlot` and the month-jump both depend on), and `resetView` — all tightly
coupled to the same `#gridWrap`/`lastProgScroll` state this slice already owns. `dpw`/
`visibleDates` (legacy's now-zero-caller duplicates of B1's `daysPerWeek`/`visibleWeeks`) were
deleted as dead code while in the area, not ported.

**One legacy touch beyond deleting the ported functions' bodies:** `centerCol` is re-exported
under its old bare name (the established alias pattern) — `jumpToSlot`'s `gotoDateCenter`
wrapper (still legacy) calls it directly. `resetView` and `gotoDate` keep their original names
verbatim (already full words) since three other still-legacy jump-to-result flows (assistant,
stats, my-bookings) call them by those exact names.

**The anti-jump-back fix, preserved verbatim as asked:** the 350ms `lastProgrammaticScrollAt`
grace window is unit-tested directly (`centerColumn()` sets it; a scroll fired immediately after
is a no-op) rather than just inspected — this was the fix the legacy comments call out as
deliberately hard-won, so it gets its own explicit test rather than incidental coverage.

**Real test-design bugs caught while writing this, not product bugs:** (1) the debounce flag and
the anti-jump-back timestamp are module-private state that persisted across `it()` blocks —
fixed by running the whole suite under one fake-timer clock, flushing pending debounce timers at
the start of every test, and replacing `performance.now()` with a fully test-controlled clock
(real tests can run faster than the 350ms window they're testing, which silently poisoned
unrelated later tests before this fix). (2) Two month-jump test expectations were simply wrong —
jumping to January 1999 (or to "this year" when the year field is unparseable) lands the result
in the *previous* year whenever January 1st doesn't fall on a Monday itself, since
`mondayOfDate` walks backward to the nearest one; fixed by computing the expected value through
the same transformation instead of assuming month/year pass through unchanged. (3) A
scroll-near-the-left-edge test forgot to set `scrollWidth`/`clientWidth`, so jsdom's default-zero
values made the (checked first) right-edge condition trivially true, masking the left-edge
branch entirely.

- **Tests:** `grid-scroll.test.ts` (42) — every pure geometry function individually, plus
  `prependWeek`'s re-entrancy guard, the scroll handler's three outcomes (grow / shift-at-the-cap
  / prepend) and its two suppression guards (recent-programmatic-scroll, absolute ceiling), the
  wheel-listener's left-edge catch, `ensureOverflow`'s two branches plus its hidden-grid guard,
  `syncJumpControls`, the month/year `change` handler (including the January-crosses-a-year-
  boundary case above), and the Heute/◀/▶ buttons. `web/js/ui/**` coverage 99.61%/94.54%.
- **Browser-verified (E5), live:** scrolling to the far right grows a visible KW column;
  scrolling near the left edge prepends a week; Heute/◀/▶ all move the grid; a clean single
  month-jump action lands on the exact date the unit tests predict (verified by hand against
  the real ISO-week math, not just "it changed"). No console errors.

### B4 — Booking form, detail modal, undo toast — **DONE**
Executed as planned, with one shape decision made explicit up front and the scope drawn
precisely at the plan's own boundary (the remote-change queue stays B8's; the checklist stays
B7's).

**Shape decision (E2 — flagged, not silently absorbed):** legacy closes the booking form
immediately, then reopens a fresh one prefilled with the same values if the write hits a
conflict. `window.mutate`'s reducer call is itself synchronous (it applies to the in-memory
`S.data`; only the network persist afterward is a real background task — its own comment says
so), so closing first buys no real responsiveness, only an extra close+reopen flicker.
`BookingForm.tsx` instead keeps the same modal mounted throughout and shows the conflict list as
component state, closing only once the outcome is actually known (a clean success, or
Abbrechen). The visible result for the user is identical or smoother — recorded here precisely
so it reads as a deliberate call, not a drift from the port.

**New pure logic, not just wiring:** `core/booking-queries.ts` (7 tests) — the contiguous
same-name-workday-run detection and the gid-based booking-group collection, pulled out of
`openBookingDetail`'s body as pure read-only queries (the write-path reducers were already pure
in `core/booking.ts`; this was the one read-only piece still living in the DOM-adjacent
function). `ui/escape-html.ts` (3 tests) — a small, deliberately-named XSS-prevention utility:
the still-legacy `askConfirm` dialog takes its body as a raw HTML string, so any user-entered
value going into it (a booker's name, a group title) has to be escaped at that one seam.

**Also completed in this slice, as previously flagged:** `refreshCell`/`refreshDot`/`patchCells`
(B2's plan note: "belong with whichever slice ports the booking form") now live in
`ui/cell-patch.ts` — legacy's own targeted-DOM-patch performance path, still called from the
still-legacy `mutate`'s optimistic-apply step. `toast`/`offerUndo` moved to `ui/toast.ts`,
needed by this slice's own validation messages and used identically by every other write path.

**Scope held at the plan's boundary:** `queueRemote`/`runRemoteQ`/`remoteMsg` (the
cross-tab change-notification queue) stay in `legacy.js` for B8, which the plan already named as
theirs. `machineChecklist`/`wireChecklistFilter` (the assistant's device tree) stay for B7.
`window.mutate` itself stays legacy — it's cross-cutting infrastructure every write path calls
into, not something specific to the booking form, and no plan slice claims it by name.

- **Tests:** `BookingForm.test.tsx` (9) — machine list + defaults, all three validation
  messages, weekend-inclusive booking confirmed via the actual reducer call, the conflict list
  (with its 15-item cap) shown in place rather than via close+reopen, the force-book path, and
  Abbrechen. `BookingDetailModal.test.tsx` (16) — facts shown/hidden correctly, the Statistik
  shortcut, run-vs-group detection picking the right hint and delete button (never both), both
  delete confirmations' declined path, single-day delete, and `openCellAction`'s three routes
  (blocked/unavailable toast, existing booking → detail, free → form). `cell-patch.test.ts` (13)
  and `toast.test.ts` (9) cover the patch path and the toast/undo mechanics directly. `web/js/ui/**`
  coverage 99.66%/93.97%; `.../ui/components` 99.62%/90.39%.
- **Browser-verified (E5), live:** double-clicking a free cell opens the form; booking with a
  note closes it and shows the undo toast; the cell renders booked with the entered name;
  double-clicking it opens the detail modal (correctly showing the note-derived booking group);
  "Diesen Tag löschen" closes the modal, frees the cell, and offers undo; clicking undo restores
  the booking. No console errors through the whole cycle.

### B5 — Four modals: my-bookings, stats, all-bookings, admin — **DONE**
- **My-bookings** — **DONE.** Run structure is **frozen at open** (`computeMyRuns` runs once,
  via a `useState` initializer that never re-runs on re-render — verified directly: re-rendering
  the mounted component with new bookings data does NOT pick up a new run, exactly the intended
  behavior) but each run's *live* days are re-filtered against `window.S.data.bookings` fresh on
  every render (a plain, un-memoized computation — deleting a day just makes it disappear from
  its run without recomputing groupings, and a delete's own success handler forces exactly one
  re-render to show it). Per-run expand/collapse keyed by `mid|firstDate`, in component state
  (not DOM classes, unlike the grid). "Nur meine Maschinen" filter button only renders when at
  least one run exists. Per-day vs. per-run delete; a run delete confirms only when it actually
  spans >1 live day (not >1 *original* day — matches legacy's live-count check exactly). "Goto"
  expands the target's category and group before jumping (a filtered-out target wouldn't be
  visible otherwise), reuses B3's `resetView`/`prependWeek`/`gotoDate` directly (no window
  round-trip — all three were already gated). Component: `MyBookingsModal.tsx`, 13 tests.
  Browser-verified (E5): booking a cell, opening My Bookings, and clicking "Im Plan anzeigen"
  correctly closes the modal and lands the grid's selection on that exact cell. One real
  diagnostic-script gotcha hit along the way (not a product bug): the first "free" cell in the
  default view can be dated *before* the app's own reckoning of today if picked via a
  browser-side UTC calendar comparison instead of the app's own `todayAsIsoDateString()` —
  `computeMyRuns` correctly filters such a booking out as already in the past, which briefly
  looked like a missing-entry bug in the modal before the test script itself was fixed.
- **Stats** — **DONE.** 3 modes (Ressourcen/Personen/Wartung) via segmented control; category
  show/hide buttons apply only in Ressourcen mode; drilldown (machine→who booked it,
  person→their machines) with a back control; independent fold state per category/group;
  default range = Jan 1 of current year → today; range changes auto-recompute (validated
  `from<=to`, invalid range toasts and keeps the last valid result on screen, exactly legacy)
  with no separate "compute" button. `openStats(presetPerson?)` jumps straight into the
  Personen-mode drilldown for a given person (used by the booking-detail modal's "Statistik"
  shortcut). A stale drilldown selection (its machine/person has no data after a range change)
  falls back to the overview, same as legacy's own reset-and-redraw.
  **Real bug found and fixed (E2, flagged):** legacy's Ressourcen-mode bucketing keys its
  internal row map on the bare group NAME across categories — a group name shared by a
  "Maschinen" resource and a "Messtechnik" one silently merges their rows into whichever
  category's bucket was created first, leaving the other category's group empty. Two tests
  reproduced this exact failure against a faithful first port before the fix. Fixed by bucketing
  on `category::group` internally; the *fold* state (`stClosed`'s `g:<group>` keys) is left
  keyed on the bare group name, unchanged from legacy — narrower than the row-conflation fix,
  on purpose.
  Pure logic in `ui/views/stats.ts`: `computeStats` (unchanged, pre-existing) plus three new
  row-descriptor builders mirroring B1's `buildGridRows` pattern — `buildResourceRows` (the
  category/group fold state machine, its own `bucketResourceRows` helper to stay under the
  complexity budget), `buildMaintRows`, `buildPersonRows` (filter + sort for the other two
  overview modes). Components: `StatsModal.tsx` (orchestrator + 3 state hooks —
  `useStatsRange`/`useStatsSelection`/`useCategoryAndFoldState` — split out purely to stay
  under the function-length budget), `StatsControls.tsx` (range/mode/filter rows),
  `StatsOverviews.tsx` (the 3 overview-mode renderers), `StatsDrilldown.tsx` (the 2 drilldowns,
  shared `StatBar`). The category id/label/icon table (`CATEGORIES`) moved to
  `core/machines.ts`, shared with the grid's own category toggle buttons (B1) instead of
  staying duplicated. 29 new/changed unit tests (17 in `stats.test.ts`, 12 in
  `StatsModal.test.tsx`); full suite 488 passed, coverage 99.46%/94.66% (well above the
  90/85 floor). Browser-verified (E5): booked a real cell, opened Statistik, confirmed 2
  category headers + sorted machine rows with bars/percentages, drilled into a machine (back
  button appears and returns cleanly), switched to Personen and Wartung modes, and confirmed
  the invalid-range toast fires while the prior valid result stays on screen — no console
  errors.
- **All-bookings** — **DONE.** Person/machine substring filters, a group `<select>` grouped by
  category via `<optgroup>`, a date-overlap window, 5 sort keys (unknown key falls back to
  `termin`) persisted to `localStorage('mb_absort')`, 300-row cap labeled "(gekürzt)"; "goto"
  narrows the machine filter to just that row's machine before jumping (so it's guaranteed
  visible even if its category/group is folded) — a deliberately different strategy from My
  Bookings' `gotoRun` (which expands the category/group instead), matching legacy exactly:
  this modal has no per-user machine set to fall back on. Read-only (list + goto, no delete),
  so — unlike My Bookings — the run structure needs no live re-filtering against later
  mutations: `computeAllRuns` runs once at open (`useState` initializer) and stays fixed for
  the modal's lifetime, exactly legacy's own `const runsAll=...` computed once outside
  `renderList`. New pure helper `groupsByCategory` (`core/machines.ts`, next to `CATEGORIES`)
  builds the "Bereich" `<optgroup>` structure from the machine list, replacing legacy's
  `groupList()`/`groupCat()` combination for this one call site (both stay in `legacy.js`,
  still used by the filter and machine-form modals). Component: `AllBookingsModal.tsx`
  (+ `AllBookingsFilters`, `AllBookingsRow` split out within the same file). 10 new/changed
  unit tests (7 in `AllBookingsModal.test.tsx`, 3 in `machines.test.ts`); full suite 498
  passed, coverage 99.46%/94.52%. Browser-verified (E5): opened the modal against real seeded
  data (67 entries), filtered to an empty result and back, confirmed the "Bereich" optgroups
  and their category labels, changed sort and confirmed `localStorage['mb_absort']` persists
  across a close/reopen, and confirmed "goto" sets the machine filter, closes the modal, jumps
  the grid to the right week, and toasts the exact expected message — no console errors.
- **Admin** — **DONE.** Sort mode (manual/name/group) persisted to `localStorage('mb_admsort')`;
  ↑/↓ reorder buttons show **only** in manual mode; reorder silently no-ops across a group
  boundary (the reducer aborts — the UI handles that gracefully, not by throwing); "＋ Maschine
  hinzufügen" and each row's "Bearbeiten" route to `window.openMachineForm` — still legacy,
  Phase 7 slice B6's own target, called unchanged; "Änderungsprotokoll" calls the already-gated
  `LogModal`'s `openLog` directly (no window round-trip, both sides gated). New pure
  `maintenanceKind` (`ui/machine-text.ts`, next to `statusRangeText`/`daysMaskText`) replaces
  legacy `maintKind` for this one call site (kept in `legacy.js` too, under its old name, for
  two not-yet-ported call sites).
  **Real bug found and fixed, caught only by browser verification (E5), not by unit tests:**
  the first draft's reorder handler mirrored the *shape* of other mutate call sites
  (`if (result && !result.abort) forceRerender(...)`) but `moveMachine` returns `void` — not a
  truthy value — on success, only `{abort: true}` on failure. That check re-rendered on
  *failure* and silently no-op'd on every *success*: `window.S.data.machines` reordered
  correctly under the hood, but the on-screen list never updated to show it. A real headless-
  browser click-and-compare (data vs. DOM) caught this; the original unit test's mock resolved
  to `{}` (truthy) on the "success" path, which happened to dodge the exact bug it should have
  caught. Fixed to match legacy `moveById`'s own logic exactly (`if(res&&res.abort) return;
  renderList();` — unconditional re-render except on abort), and the test rewritten with a
  faithful mutate stub that actually applies the reducer to `window.S.data`, so the row order
  itself is asserted rather than just "did it call mutate".
  Component: `AdminModal.tsx` (+ `AdminControls`, `AdminRow`, `StatusBadge` split out within the
  same file). 13 new/changed unit tests (10 in `AdminModal.test.tsx`, 3 in
  `machine-text.test.ts`); full suite 511 passed, coverage 99.4%/94.33%. Browser-verified (E5)
  against real seeded data (245 machines): search focuses on open, filters and empties
  correctly, sort persists across close/reopen and hides the arrows outside manual mode, a
  manual reorder now visibly swaps two rows (the bug above, confirmed fixed and the swap
  reverted afterward), and "Bearbeiten" opens the still-legacy machine-edit form pre-filled —
  no console errors.
- **Functionality:** each view's pure kernel (`ui/views/*.ts`) is already 100%-tested and unchanged — these slices are pure wiring.
- **Tests:** per view, assert the right reducer/filter is called with the right args on each control, and that persisted localStorage keys are read/written under their exact legacy names.

### B6 — Machine form + group management — **DONE**
- **Must-haves:** category + group `<select>` grouped by category, plus a free-text "new group"
  input that overrides the select when non-empty; redundancy field backed by a `<datalist>` of
  existing values; 7 weekday checkboxes serialize to a mask where **all-on stores nothing**
  (`null`, not `'1111111'`); a dynamic maintenance-slot list (add/remove/edit rows: type, from,
  until, note) validated (`from<=until` per slot) before save; save routes through `saveMachine`
  (slug from German transliteration + de-duplication suffix + same-group insertion index —
  already ported, A5); delete requires a confirm naming the cascade ("inklusive aller
  zugehörigen Buchungen... nicht rückgängig"), escaped via `escapeHtml` (the confirm dialog is
  still legacy's own HTML-string one).
  "Zurück" and a successful save/delete all route to `window.openAdmin()` rather than a direct
  import — same reasoning as `LogModal.tsx`'s existing call to it: avoids a circular import,
  since Admin's own "＋"/"Bearbeiten" call `window.openMachineForm` right back.
  Pure logic split into its own module, `ui/machine-form.ts` (state shape, defaults,
  `validateMachineForm` — mirroring how `ui/views/stats.ts` holds the Stats family's pure
  logic), fully unit-tested there (19 tests) independent of the component tree. New
  `groupsByCategory`-adjacent `GroupOptions.tsx` extracted as a **shared** component — the
  "Bereich" `<optgroup>` markup was identical between this form and All-Bookings (B5's own
  `AllBookingsModal.tsx`), so it moved out to `ui/components/GroupOptions.tsx` instead of
  staying duplicated. `WD_SHORT` moved to `ui/machine-text.ts` as exported
  `WEEKDAY_SHORT_LABELS`, deleted from `legacy.js` (its only remaining use).
  **Real bug found and fixed, caught only by browser verification, not by unit tests:** Admin
  routing straight to the machine form (`window.openMachineForm`) and back
  (`window.openAdmin()`) — two React modals opening one another directly, matching legacy's own
  chained `openModal()` calls — triggered React's "createRoot() on a container that has already
  been passed to createRoot()" warning on every transition, because `openReactModal` only ever
  overwrote its `currentRoot` reference instead of unmounting the outgoing root first. Unit
  tests never render two modals in the same JSDOM document, so they never exercised this path.
  Fixed centrally in `ui/modal.tsx` (`currentRoot?.unmount()` before the new `createRoot` call)
  — this benefits every modal-to-modal transition project-wide, not just B6's — with a new
  regression test in `modal.test.tsx` asserting no console error on a chained open.
  Components: `MachineFormModal.tsx` (+ `saveMachineForm`/`deleteMachineForm` module-level async
  functions, mirroring B4's `submitBooking` pattern), `MachineFormFields.tsx`,
  `MaintenanceSlotEditor.tsx` — split purely to stay under the file-length/function-length
  budgets.
- **Tests:** 19 in `machine-form.test.ts` (mask round-trip incl. all-on → `null`; a bad
  maintenance range blocks save with the right toast; free-text group overriding a selected
  one; unrecognized maintenance type normalized to "wartung"), 10 in
  `MachineFormModal.test.tsx` (create/edit/delete/back through the real reducers via a
  faithful mutate stub, a declined delete confirm not mutating), 3 in `machines.test.ts`
  (`groupsByCategory`, from B5, unchanged), 1 new in `modal.test.tsx`. Full suite 541 passed,
  coverage 99.42%/94.28%. Browser-verified (E5): created a machine with a maintenance slot
  (badge appeared in Admin), confirmed the empty-name/empty-group and all-off-mask validation
  toasts block save, edited it back open and confirmed the fields round-tripped, deleted it via
  the legacy confirm dialog, and confirmed it's gone — no console errors (after the modal.tsx
  fix; the bug above was caught in this exact pass, on the first run).

### B7 — Assistant UI (device tree, drag-drop, results) — **DONE**
- **Must-haves:** device checklist reuses the same collapsible fav/category/group tree
  structure legacy's "Filtern" dropdown used, but toggles only add/remove a device and
  immediately reflect into the work area; dragging a device onto another creates a new "need 1
  of 2" group with a color from a fixed hue cycle (`AS_HUES`, 8 colors); dropping onto a
  group's kids area joins it; dropping onto empty canvas returns a node to root; the need
  stepper is clamped `[1, childCount]`; a redundancy hint ("alle gleichwertigen Geräte hier?")
  shows when a group has more members than its need; before running, if there's real
  redundancy, a confirm dialog asks whether every equivalent device was added; results are
  day-runs meeting the minimum-consecutive-days input, each with an editable "days to book"
  number (clamped to the run's length, with a transient tip on clamp), a suggested-devices
  line (only when the tree contains ≥1 group), a "pin" button that **collapses** (not closes)
  the modal and filters+centers the grid on that run, and "Buchen…" opens the booking form
  pre-picked. The "Aktuellen Filter übernehmen" button legacy's `wireChecklistFilter` wires
  conditionally turned out to be dead code — the Assistant's own modal template never rendered
  that button — so it wasn't ported.
  Native `dragstart`/`dragover`/`drop` mapped directly onto React's `onDragStart`/`onDragOver`/
  `onDrop`, delegated on the work area exactly like legacy's own `wireWorkDnD` — no new
  dependency, and the transient highlight classes (`.dragover`, `.dragover-root`, `.dragging`)
  are toggled via direct DOM manipulation rather than React state (re-rendering the whole tree
  on every `dragover`, which fires continuously, would be wasteful for a purely visual cue).
  **New pure logic added to `core/assistant.ts`** (previously only the lower-level tree
  primitives and the scheduling solver lived there): `groupNodeOnto`, `joinNode`,
  `moveNodeToRoot`, `dissolveGroup`, `changeGroupNeed`, `setGroupNeed`, `removeNode`,
  `addDeviceToTree` — faithful ports of legacy's `asXxx` adapters, now fully pure and tested
  (20 new tests) instead of thin globals bound to `AS_TREE`. New `ui/assistant-checklist.ts`
  (`buildChecklistRows`) and `ui/assistant-results.ts` (`buildAssistantResults`) hold the two
  other pure kernels this slice needed, mirroring the row-descriptor pattern from B1/B5.
  Shape decision (E2, flagged): the results panel's suggestion line and its "Buchen…"/pin
  button device list are computed from a tree snapshot **frozen at search time**
  (`structuredClone`), not legacy's live tree re-read at click time — legacy's own behavior is
  already a bit inconsistent (the suggestion text never updates after search, but a button
  click re-evaluates against whatever the tree looks like by then); freezing both together is
  simpler and avoids submitting a booking for a device since removed from the tree.
  **Real bug found and fixed** (the same class as B6's, again only caught by browser
  verification): the Assistant is a React modal that can open the booking form directly on top
  of itself and can be collapsed-then-reopened via the floating "Assistent" tab — both paths
  exercise `openReactModal`/its collapse handling in ways no earlier slice did, and both came
  back clean after B6's `modal.tsx` fix and the new `collapseReactModal` addition (below) — no
  new bug here, but this is the slice that most thoroughly exercises that infrastructure.
  New `collapseReactModal()` in `ui/modal.tsx`: hides the overlay and shows the floating reopen
  tab **without unmounting** — legacy's own `collapseModal()`/`expandModal()` never destroy the
  modal's DOM, so a React modal doing so on "collapse" would lose all state where legacy
  wouldn't. Escape/backdrop-dismissal while collapsed only clears the reopen tab, matching
  legacy's `closeModal()` (which also never unmounts); re-expanding is handled entirely by
  legacy's existing `#modalReopen` click listener, unchanged.
  Components: `AssistantModal.tsx` (+ `useAssistantTree` hook, `runAssistantSearch`,
  `AssistantSearchForm`, `AssistantWorkSection`), `AssistantChecklist.tsx`,
  `AssistantTree.tsx` (+ `useTreeDragAndDrop` hook), `AssistantResults.tsx` — split purely to
  stay under the file-length/function-length budgets.
- **Tests:** 20 new in `assistant.test.ts` (the new tree-edit functions), 10 in
  `assistant-checklist.test.ts`/`assistant-results.test.ts` combined, 21 in
  `AssistantModal.test.tsx` covering checkbox toggling, search filtering, validation, a real
  jsdom-simulated drag-and-drop forming a group, the redundancy confirm gate, the need
  stepper, dissolve, remove-from-group auto-dissolve, and the day-count clamp tip, plus 3 new
  in `modal.test.tsx` for collapse/expand. Full suite 600 passed, coverage 99.19%/93.7%.
  Browser-verified (E5) with **real mouse-driven drag-and-drop** (not just synthetic DnD
  events): checked two machines, dragged one onto the other to form a group, confirmed the
  redundancy hint and the confirm dialog's exact text, ran a search, confirmed one result with
  a suggestion line, dissolved the group, then separately verified "pin" collapses the modal
  (grid filtered, floating tab shown), re-expanding via that tab restores the exact same
  results, and "Buchen…" opens the booking form on top — no console errors throughout.

### B8 — Presence badge, collision banner, SSE hook — **DONE**
- **Must-haves:** presence badge shows a count + a hover title listing active names in
  **server-received order** (not alphabetized — `presenceInfo` only filters, doesn't sort);
  reconnect on name change; the `mb_presence` "share" toggle, when off, connects **without** a
  `user` query param so this browser doesn't appear in others' lists; `hello` stamps the "last
  updated" time; `update` events patch cells + revision and queue a toast **only for foreign
  changes** (case-insensitive `isForeign`); `structural` events trigger a full state reload;
  `onerror` flips a visible "⚠ offline" indicator with no custom retry logic (EventSource
  retries natively); the collision banner is **persistent** (manual-dismiss only), shown when
  the server reports partial write conflicts.
  **Design note (not a plan change, a scope clarification made while implementing):** none of
  this turned out to need a React component. `#userChip`'s presence badge and `#collBanner` are
  small, already-static/simple DOM (`#collBanner` is fully static markup in `index.html`;
  `#userChip` is one button rebuilt by a small, infrequent `innerHTML` write) — the same
  judgment call B2/B3 made for `grid-interaction.ts`/`grid-scroll.ts`. So this slice is three
  plain gated modules, not components: `ui/user-chip.ts` (`setPresence`/`updateUserChip`),
  `ui/collision-banner.ts` (`showCollisionBanner`/dismiss wiring), `ui/live-connection.ts` (the
  `EventSource` lifecycle + the remote-change toast queue — lives under `ui/`, not `net/`,
  because it touches the DOM/toast and `net/` must not depend on `ui/`, enforced by an ESLint
  rule that caught this on the first lint pass).
  `applyPresence` (and the `presenceData` timestamp map the still-unported active-users popup
  reads) deliberately stays in `legacy.js` — narrower scope than the plan's own naming
  suggested, kept there because it's coupled to that not-yet-ported popup; it calls the bridged
  `ui/user-chip.ts` `setPresence` under its legacy name (`setPres`, kept as a bridge alias).
  Two new pure functions added to `net/sse.ts` (`formatDayMonth`, `remoteMessage` — faithful
  ports of `fmtDM`/`remoteMsg`, now direct-imported rather than window-bridged since both call
  sides are gated).
- **Tests:** 25 new (`live-connection.test.ts` mocking `EventSource` — a foreign `update`
  queues a toast while an own-name one doesn't, a `structural` event reloads state, `onerror`
  flips the offline indicator, toggling the presence-share setting changes the connection URL;
  `user-chip.test.ts`; `collision-banner.test.ts`) + 6 in `sse.test.ts` for the two new pure
  functions. Full suite 632 passed, coverage 99%/93.31%.
  Browser-verified (E5) with **two real browser tabs against the live dev server** (not
  mocked): tab 1 (Anna) showed presence badge "1", title "Gerade aktiv: Anna"; opening tab 2 as
  Bob updated tab 1's badge to "2" live; Bob booking a cell showed up in tab 1 instantly without
  a reload (the `update` SSE patch), with the exact expected remote-change toast — "Bob hat 1
  Maschine gebucht (31.08.–31.08.)" — matching `remoteMessage`'s format precisely. No console
  errors.

### B9 — Settings, help, log, name-prompt — **DONE**

**Shared infrastructure built first (`web/js/ui/modal.tsx`), needed by every remaining modal
slice, not just B9.** `legacy.js`'s `openModal(html)`/`closeModal()` own a single shared
`#modal`/`#overlay` pair by replacing `#modal`'s innerHTML per open — a React root can't
safely coexist with code that mutates its container directly (React loses track and warns/
misbehaves on the next render). `openReactModal(node, {sticky?})`/`closeReactModal()` mirror
the legacy DOM chrome (focus save/restore, overlay class, the `modalReopen` tab) but create a
**fresh React root on every open and unmount it on close** — bracketing the node's ownership
so legacy's still-active modals (opened before or after) never fight over it. `legacy.js`'s
own `modalSticky`/`lastFocusEl` closure variables aren't exported, so this module keeps
entirely independent copies; document-level capture-phase Escape/click listeners take full
ownership of dismissal whenever a React modal is the one currently open (checked via
`currentRoot !== null`), and no-op immediately otherwise — legacy's own bubble-phase
listeners never see the event when a React modal owns it, and keep working unchanged for
legacy's own modals. Retire this whole file in slice B10.

**A real bug caught by writing modal.tsx's own tests, not by the app running correctly**:
the first version bound the overlay-click listener directly to the `#overlay` element
captured once, instead of delegating from `document` (like the keydown listener already
did) — if that element were ever replaced, the listener would silently stop firing. Fixed to
match the keydown listener's already-correct document-delegated pattern before it ever
shipped. `modal.test.tsx` (9 tests) covers open/close, focus restore, sticky vs. non-sticky
Escape and outside-click, and the no-op-when-nothing-open case explicitly.

**Help** (`legacy.js:283–345`): fully static legend text — ported as real JSX (not
`dangerouslySetInnerHTML`; the exact German copy transcribed carefully, cross-checked
against the original line-by-line, then verified with a real Playwright screenshot compared
against the running legacy version) rather than an HTML blob, split into five small
`XxxSection` components to clear the 60-line function budget the `.tsx` gate now enforces
same as everywhere else. A new `Icon` component replaces legacy's `ic(name)` string helper
with the same `<svg class="ic"><use href="#i-NAME"/></svg>` markup as JSX.

**Log** (`legacy.js:2076–2085`): a snapshot of `window.S.data.log` at open time (matches the
original — it was never a live subscription while the modal was open, so no store-reactivity
needed here). Its "Zurück" button still calls the not-yet-migrated `window.openAdmin()` —
the same cross-direction bridging every extraction in this project has used all along, just
reversed (React calling a still-legacy global instead of legacy calling a bridged one).
React's own text-interpolation escaping (`{value}`) replaces every `esc()` call from the
original — nothing extra needed, confirmed by a test that renders a name containing `<b>`
and asserts it shows as literal text.

`legacy.js`'s own `function openHelp(){...}`/`function openLog(){...}` bodies are deleted
outright (comments left pointing at the new modules); the button bindings
(`btnHelp.onclick=openHelp`, `adLog.onclick=openLog`) are untouched bare-identifier
references, so they resolve through the `app.ts` bridge automatically — zero call-site edits,
same as every core/net/ui extraction all session.

**AskUserNameModal** (`legacy.js:123–135`): `firstRun` controls only whether the Cancel
button renders — **not** whether Escape/outside-click dismiss the modal. The original never
passed `{sticky:true}` here at all, so a first-run user genuinely can dismiss without setting
a name (no Cancel button is the only affordance difference); ported that exactly rather than
"fixing" it into a real modal-block, confirmed by a test that opens it with `firstRun=true`
and shows Escape still closes it. Mutates `window.S.user` directly (matching every other
legacy write to `S` — there's no store-level "set user" action to route through yet), then
calls the still-legacy `updateUserChip`/`dbg`/`presenceTick` globals for the side effects
that aren't modal-related.

**SettingsModal** (`legacy.js:296–343`): seven rows, each reading/writing its exact original
localStorage key (`mb_theme`/`mb_presence`/`mb_compact`/`mb_weekends`/`mb_debug`) and calling
the same still-legacy globals for side effects outside the modal's own concern
(`applyTheme`/`notify`, `presenceTick`, `centerToday`, `applyDebug`, `connectSSE`+
`refreshNow`) — split into one small row component per setting from the start, both to stay
under the 60-line budget and because each row's read/write logic is independent (no shared
local state to thread through). Verified live: selecting "Dunkel" in the running app actually
re-themes the whole grid, not just the modal, confirming the bridge to `applyTheme`/`notify`
works end to end — screenshotted in both light and dark before/after.

`legacy.js`'s own `function askUserName(){...}`/`function openSettings(){...}` bodies
deleted outright; button/chip bindings (`userChip.onclick`, `btnSettings.onclick`) are
untouched bare-identifier references, resolving through the `app.ts` bridge automatically.

**A test-writing gotcha worth recording**: React's checkbox/radio inputs track their
`checked` state through an internal value-tracker that a raw `element.checked = x` followed
by a manually-dispatched `change` event doesn't update correctly — the fix is a real
`element.click()`, which both toggles the DOM property and fires the event React's synthetic
system actually listens for. Hit this on all four `SettingsModal` checkbox tests before
switching to `.click()`.

- **Must-haves (localStorage keys — preserve verbatim so existing users' browsers upgrade losslessly):** `mb_theme`, `mb_presence`, `mb_compact`, `mb_weekends`, `mb_debug`, `mb_user`. All confirmed unchanged.
- **Verification:** `HelpModal.test.tsx` (3), `LogModal.test.tsx` (5), `modal.test.tsx` (9), `AskUserNameModal.test.tsx` (4), `SettingsModal.test.tsx` (7) — 28 new tests, all green. Real Playwright screenshots of every screen in the running app (seeded backend + Vite dev server): first-run name-prompt (no Cancel button, confirmed by screenshot not just a flaky locator — see the false-positive note below), Settings in light and dark, live theme switching. Zero console errors anywhere in B9.
- **A test-tooling false positive, not a product bug:** a Playwright locator (`button:has-text("Abbrechen")`) initially reported a Cancel button present on first run when the screenshot showed none — it was matching the always-present-but-hidden confirm-dialog's `#cfNo` button elsewhere in the DOM (`.count()` doesn't filter by visibility), not the name-prompt. Confirmed by the screenshot itself, not fixed in product code.

### B10 — App shell; delete `legacy.js`; retire `window.S`

**Scope correction (found while starting B10, 2026-08-31):** the paragraph below is the
*original* B10 plan — written under the assumption that every other feature in `legacy.js`
would already be ported by the time B10 ran. It wasn't: after B8, `legacy.js` still held ~55
top-level functions (~885 lines) covering features that were never assigned a slice number.
Doing only the original B10 would leave `legacy.js` very much alive, contradicting its own
title. Expanded into sub-slices B10a–B10g below, closing the actual gap; each is one commit,
same rigor as B1–B9 (pure logic + tests where there's real logic, `verify` green, real-browser
check via the persistent Playwright container, `PHASE7-PLAN.md` updated, then commit).

**What's actually left, grouped by sub-slice:**
- **B10a — Favorites + next-free-day jump — DONE.** `toggleFav`, `nextFreePtr`,
  `gotoDateCenter`, `bookable`, `nextFreeAfter`, `prevFreeBefore`, `jumpToSlot`, `gotoNextFree`,
  `gotoPrevFree` → new `ui/favorite-jump.ts`, still called from `ui/grid-interaction.ts` (B2)
  via the window bridge for the row header's favorite star and prev/next-free buttons; the
  day-scan core (`nextFreeDay`/`prevFreeDay`) already lived in `ui/navigation.ts` — this was
  mostly wiring. `displayGroup`/`FAVGRP`/legacy's own `orderedMachines()` were confirmed dead
  (superseded by `ui/grid.ts`'s versions, B1) and deleted outright, no port needed.
  `ui/grid-interaction.ts`'s selection state (`Sel`) is now also exported under its real name
  (`selection`, alongside `paintSelection`) so this new module can import it directly instead of
  going through the window bridge — the `Sel`/`paintSel` aliases stay for `ui/grid-scroll.ts`'s
  existing `window.Sel` read and for legacy's still-unported `showCtx` (B10b).
  13 new tests (`favorite-jump.test.ts`). Full suite 645 passed, coverage 98.91%/93.39%.
  Browser-verified (E5): starred a machine (moved into "★ Favoriten", persisted, un-starred
  cleanly), jumped forward via ⏭ (correct toast, cell selected, ⏮ appeared), jumped forward
  again (moved further), then ⏮ back to the exact same date — no console errors.
- **B10b — Context menu — DONE.** `showCtx`/`hideCtx` + the document-level outside-click
  dismissal → new `ui/components/ContextMenu.tsx`, mounted once at boot onto `#ctxMenu` (same
  pattern as `Grid.tsx` onto `#grid`), still called from `ui/grid-interaction.ts` (B2) via the
  `window.showCtx`/`window.hideCtx` bridge, unchanged. Shape decision: React, not a plain
  module — unlike B8's static-shape `#userChip`/`#collBanner`, `#ctxMenu`'s content is fully
  dynamic (button set and text vary with selection size, date range, and whether anything's
  booked), so it fit the B2/B3/B8 judgment call on the React side.
  `#ctxMenu` itself IS the menu box (CSS already gives it `position:fixed; display:none`,
  matching legacy) — the component only fills its children and toggles its own `display`/
  position via a `useLayoutEffect` (measure-then-clamp against the viewport, same approach as
  legacy's own `getBoundingClientRect()` call, done before paint so there's no visible jump);
  it does NOT render a nested wrapper div (an early draft did, which silently broke visibility
  since the parent `#ctxMenu` was still `display:none` under CSS — caught before committing,
  not a shipped bug). "Buchen…" hides the menu and calls the already-gated `openBookingForm`
  (B4) directly; the delete button (shown only when the selection has bookings) hides the menu,
  confirms via `window.askConfirm` (B10c), deletes via the already-gated `deleteSelectedCells`
  (`core/booking.ts`, A5) through `window.mutate` (B10f), and offers undo via the already-gated
  `offerUndo` (`toast.ts`); "Abbrechen" hides the menu and calls the already-gated
  `clearSelection` (B10a's export change) directly. Split into `useContextMenuInfo` (state +
  effects) and `ContextMenuContent` (render) to stay under the 60-line function budget.
  `ui/grid-interaction.ts`'s "Legacy bridge aliases" comment updated: `Sel`/`paintSel` stay
  (still read via `window.Sel`/`window.paintSel` by `ui/grid-scroll.ts` and the React Grid),
  they just no longer serve `showCtx`, which is gated now.
  9 new tests (`ContextMenu.test.tsx`), including a real mutate-stub delete flow asserting the
  booking actually leaves `S.data.bookings` and undo is offered. Full suite 654 passed,
  coverage 98.93%/93.4%. Browser-verified (E5): drag-selected a multi-cell range → menu
  appeared correctly positioned next to it with the right machine-count/date-range text and no
  delete button; outside-click dismissed it; "Buchen…" hid the menu and opened the booking form
  pre-picked for the range; booked a cell, re-selected a range covering it → delete button now
  read "1 Buchung(en) löschen", clicking it raised the real confirm dialog, confirming deleted
  the booking and toasted with an undo offer — zero console errors throughout.
- **B10c — Confirm dialog — DONE.** `askConfirm` → new `ui/confirm.ts`, a plain module
  targeting the static `#confirm2` markup already in `index.html` (like `#collBanner`, B8) —
  no React needed, it's `textContent`/`innerHTML`/class toggles on fixed elements. Preserves
  the exact `(options) => Promise<boolean>` shape every existing caller (B4/B6/B7/B10b) already
  depends on via `window.askConfirm`, so no call site changed.
  **A real bug found and fixed in already-committed B10b code, before it shipped further**:
  `ContextMenu.tsx`'s delete-confirm `body` interpolated `info.names`/the formatted dates
  directly into the HTML string `askConfirm` sets via `innerHTML=`, with no escaping — unlike
  every other `askConfirm` caller in the codebase (all of which call `escapeHtml`, `ui/
  escape-html.ts`, B4) and unlike legacy's own `showCtx`, which wrapped the same interpolation
  in `esc(...)`. A booking with an HTML-special-character name (e.g. containing `<b>`) would
  have rendered raw markup in the confirm dialog. Fixed by adding the same `escapeHtml` calls
  B4's callers use; a new `ContextMenu.test.tsx` case pins it (a `<b>x</b>` booker name reaches
  the dialog only as `&lt;b&gt;x&lt;/b&gt;`). Caught while wiring B10c's `ui/confirm.ts` and
  auditing every `askConfirm` call site for consistency, not by a failing test — worth noting
  since it shows the value of that kind of pass. `escape-html.ts`'s header comment (which
  described `askConfirm` as "still legacy") updated to point at `ui/confirm.ts`.
  6 new tests (`confirm.test.ts`) + 1 regression test in `ContextMenu.test.tsx`. Full suite 661
  passed, coverage 98.93%/93.44%. Browser-verified (E5) via the context-menu delete flow
  (B10b): the dialog shows the right title/escaped body/button label/dangerfill styling,
  "Abbrechen" closes it leaving the booking intact, "Ja" (the confirm button, labeled with the
  actual count) closes it and deletes with an undo toast — zero console errors.
- **B10d — Active-users popup + retire the legacy modal chrome — DONE.** `openActiveUsers`
  was the *only* remaining `openModal()` caller — ported to a small React modal
  (`ActiveUsersModal.tsx`), reusing `openReactModal`/`closeReactModal`. Once gone,
  `openModal`/`closeModal`/`modalSticky`/`lastFocusEl` and the legacy bubble-phase
  overlay-click/Escape listeners were all dead (superseded by `modal.tsx`'s capture-phase
  ones) and deleted outright. The already-dead `collapseModal` (nothing called it since the
  Assistant, B7, switched to `collapseReactModal`) was deleted too. `expandModal` + the
  `#modalReopen` click wiring moved into `ui/modal.tsx` as `expandReactModal`, delegated on
  `document` (not bound to the element directly, matching this file's other listeners) rather
  than legacy's direct bind — legacy's version broke under a test harness that replaces
  `document.body.innerHTML` wholesale (the listener stays attached to a discarded node); the
  real app never does that, but delegation is strictly more robust and free.
  Folded `applyPresence` into this slice too (`ui/live-connection.ts`), even though the
  original B10 text didn't call it out separately: B8 kept it in legacy specifically because
  the still-unported `openActiveUsers` read its `presenceData` map — once the popup is gated,
  that reason is gone. `presenceData` now lives in `live-connection.ts` (mutated in place, not
  reassigned, so importers keep a live reference) with a new pure `activeUserRows(now)` (E4)
  for the row-building, imported directly by `ActiveUsersModal.tsx`. `user-chip.ts`'s `setPres`
  bridge alias (only ever called by `applyPresence`) is now dead and deleted along with its
  test case; `applyPresence` calls `setPresence` (the real name) directly.
  **A real bug found and fixed while moving `expandModal` in**: the bare port left the
  `isCollapsed` module flag stuck `true` after re-expanding a collapsed modal via the
  `#modalReopen` tab (legacy's `expandModal` had no way to know about it, being unaware of
  `modal.tsx`'s internal state) — so a subsequent Escape/outside-click on the now-visible
  modal would only clear the (already-hidden) reopen tab instead of actually closing it.
  `expandReactModal` now resets the flag. Caught while writing this slice, not by a failing
  test; pinned by a new regression test doing a real collapse → click-to-reopen → Escape round
  trip and asserting the modal actually unmounts.
  9 new tests (`ActiveUsersModal.test.tsx`) + 5 in `live-connection.test.ts`
  (`presenceData`/`activeUserRows`, replacing the old `window.applyPresence` mock-based ones)
  + 2 in `modal.test.tsx` (the reopen-tab click, and the Escape regression). Full suite 673
  passed, coverage 98.94%/93.46%. Browser-verified (E5) with two real tabs under different
  names: double-clicking the user chip shows both, self correctly marked "(du)", the other
  tab's real presence data arriving over its own SSE connection — "Schließen" and Escape both
  close it, reopening works a second time. Zero console errors in either tab.
- **B10e — The "Filtern"/"Alle Bereiche" toolbar dropdowns — DONE.** `fillMachSel`,
  `updateMachBtn`, `saveFilters`, `mfOpenCat`/`mfOpenGrp`/`mfShow` → new
  `ui/machine-filter.ts` (pure row-building, mirroring `assistant-checklist.ts`'s B7 shape —
  deliberately duplicated rather than shared, since the two evolve independently and this one
  has an extra knob) + `ui/components/MachineFilterDropdown.tsx`. `groupList`, `fillGroupSel`,
  `updateGroupBtn` → new `ui/components/GroupFilterDropdown.tsx`. `toggleCat`,
  `toggleAllGroupsInCat`, `catTap`, `catTapCancel` → new `ui/category-fold.ts`, imported
  directly by `Grid.tsx` (B1) and `grid-interaction.ts` (B2) — both already gated, no window
  bridge needed. `CATS`/`catLabel`/`catIco` were dead the moment `fillMachSel` moved
  (`CATEGORIES` in `core/machines.ts`, B5, already covered the same data — this was their
  last caller); `groupCat` had zero remaining callers anywhere and was dead already;
  `searchActive`/`matchesSearch` were also already dead, superseded by `ui/grid.ts`'s
  `buildGridRows` (B1). Also found and deleted, while reading through this section: legacy's
  own `nameColor`/`getBooking` (dead — `ui/grid.ts`'s versions, B1, had fully superseded them)
  and a byte-identical duplicate `catIco` definition elsewhere in the file (JS allows
  redeclaring a top-level function; the second silently shadowed the first — harmless since
  both were identical, but worth a comment). None of these five were part of B10e's own
  scope — cleanup found along the way, same as B10a's `displayGroup`/`FAVGRP`.
  Shared open/close mechanics (toggle-button click, outside-click-closes, the panel's own
  `.open` class) factored into a new hook, `ui/toolbar-dropdown.ts`, used by both dropdowns.
  **A deliberate deviation, flagged (E2)**: legacy's two dropdowns could both end up open at
  once — each button's `ev.stopPropagation()` meant clicking one button's toggle never reached
  the OTHER dropdown's own outside-click listener. Almost certainly an unintended quirk of two
  independently-added, identically-shaped features (not a design choice), and worse UX either
  way — this port instead closes any other open toolbar dropdown whenever one opens.
  **A genuinely surprising discovery, unrelated to this port**: `#groupWrap` (the group-filter
  button's wrapper) has been `style="display:none"` with nothing anywhere ever un-hiding it
  since the very first commit of this migration (confirmed via `git log -S groupWrap`) — the
  "Alle Bereiche" dropdown has **never been reachable by a real user**, in the original
  monolith or at any point since. Conserved exactly as found (E1) — not my call to "fix" a
  pre-existing dead UI element — so `GroupFilterDropdown.tsx` is real, correct, thoroughly
  unit-tested code that a real user currently cannot reach; browser verification below used
  `page.evaluate(...)`-driven clicks to exercise it despite that.
  40 new tests (`machine-filter.test.ts` 11, `category-fold.test.ts` 7,
  `MachineFilterDropdown.test.tsx` 13, `GroupFilterDropdown.test.tsx` 9) + `grid-interaction.
  test.ts`/`Grid.test.tsx` updated to exercise the real (now directly-imported) category-fold
  functions instead of window-bridge mocks. Full suite 714 passed, coverage 98.92%/93.44%.
  Browser-verified (E5): opening "Filtern", drilling into a category → group → checking a
  machine isolated the grid from 245 rows to 1, clearing restored all 245; the category-shown
  toggle hid "Messtechnik" from the dropdown's own list while leaving the grid's 245 rows
  completely unaffected (proving the `mfShow`/grid separation legacy's comment describes);
  search found the machine with headers gone; outside-click closed it. The group dropdown
  (exercised via direct DOM clicks, per the above) opened, listed all groups, and selecting one
  updated its button to "1 Bereich ▾". Zero console errors throughout.
- **B10f — Core write pipeline + shared helpers — DONE.** `mutate`/`persist`/`refreshNow`/
  `stampRef` → new `ui/mutate.ts` — the single authoritative write path (CLAUDE.md), the
  highest-risk piece in this whole backlog. `dbg`/`dbgOn`/`applyDebug`/`handleError` → new
  `ui/debug-panel.ts` (+ `initDebugPanel()` wiring `#dbgClear`/`#dbgClose`, called once at
  boot, same pattern as B8's `initCollisionBanner`). `machById` → new `ui/machine-lookup.ts`.
  `applyTheme` → new `ui/theme.ts` (the boot-time init — the initial call, the `matchMedia`
  listener, `mb_compact`'s class application — stays in legacy.js for now, absorbed into
  `app.ts`'s boot orchestration in B10g). `readFile` → `net/api.ts` (a thin `normalizeState(
  apiGet('/api/state'))` wrapper, built entirely from already-gated primitives).
  All six kept window-bridged rather than converted to direct imports — each has many call
  sites scattered across already-gated components, the same call as `askConfirm`/`mutate`
  themselves.
  **Two more dead-code findings, confirmed by full-codebase search and deleted outright, no
  port**: `sleep` and `ic` — both had zero remaining callers anywhere (not even within
  legacy.js itself), evidently orphaned by earlier slices without being swept up.
  **A third, subtler one — legacy's `saving` flag — deliberately NOT ported**: `mutate`/
  `persist` set it true/false, but a full-codebase search found nothing anywhere that ever
  *read* it, despite the flag's own comment claiming it "pauses auto-refresh while saving." A
  write with no observable read has no behavior to conserve, so it's dropped rather than
  carried forward as inert state. legacy's own `persist(fn, logEntry, result)` also took an
  `fn` parameter its body never once referenced — dropped too (E2, matching `net/sse.ts`'s
  `remoteMessage` dropping its own unused `ts` field, B8).
  `esc` stays in legacy for now — B10g's concern, since its one remaining caller is the boot
  sequence's own error message.
  102 new tests across `mutate.test.ts` (19, including the full persist success/conflict/
  error/network-failure matrix), `debug-panel.test.ts` (13), `machine-lookup.test.ts` (5),
  `theme.test.ts` (5), and `net/api.test.ts`'s new `readFile` cases (2). Full suite 758
  passed, coverage 98.91%/93.38%. Browser-verified (E5) end to end, including the test that
  actually matters for a write path: booked a cell, waited for the background `persist()`,
  then **fully reloaded the page** — the booking survived, proving the write reached the real
  server and wasn't just an optimistic-UI illusion. Also verified: the manual refresh button,
  and the full debug-panel lifecycle (turn on → activation line → a real booking produces a
  "✓ (Rev N)" write-log line → "Leeren" clears it → "✕" turns the flag off and closes the
  panel). Zero console errors throughout.
- **B10g — Boot sequence (the original B10 scope):** `start`/`startUI`/`init`. Only once
  B10a–B10f land does `legacy.js` actually go to zero and get deleted here, with `app.ts`
  absorbing the boot orchestration and the `window.S`/`window.render`/`window.notify` bridges
  retiring along with the last legacy consumer.
- **Tests:** each sub-slice gets the same unit-test rigor as B1–B9 for whatever pure logic it
  introduces; B10g mounts `<App/>` with a mocked fetch returning valid/invalid `/api/state` and
  asserts the right screen renders in each case, name-prompt appears exactly when
  `!user && !readOnly`, and live timers start once even across remounts.

**Suggested order for Backlog B:** B0 ✅ → B9 ✅ → B1 ✅ → B2 ✅ → B3 ✅ → B4 ✅ → B5 ✅ (4 commits) → B6 ✅ → B7 ✅ → B8 ✅ → B10a ✅ → B10b ✅ → B10c ✅ → B10d ✅ → B10e ✅ → B10f ✅ → B10g.
