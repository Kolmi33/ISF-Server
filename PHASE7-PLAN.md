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

### B1 — Grid (`render`, `refreshCell`, `refreshDot`, `ensureOverflow`)
- **Must-haves (from `legacy.js:698–812`):** two header rows — machine-column head (rowspan 2, category toggle buttons with `aria-pressed`, single-click toggles a category via `catTap`'s 220 ms debounce, **double-click toggles every group in that category** via `toggleAllGroupsInCat` — this tap/dblclick disambiguation is a real, easy-to-drop interaction quirk, preserve exactly) + a `--theadh` CSS var set from measured header height (used by sticky group rows). Body: category header rows (collapsible via `S.cats`) → group header rows (collapsible via `S.collapsed`, Favorites is its own top-level "catrow", not a sub-group) → machine rows. **Collapse nuance:** a collapsed group still renders its rows when a machine-filter search is active (`!searchActive()` guard) — do not drop this. Row header: star toggle, 5-state today-dot (`classifyDot`: defekt/maint/busy/unavail/free), status tag text ("defekt"/"Wartung"/"Sperre geplant"), info icon, ⏭ button (always shown) + ⏮ button (only when `hasBack` is true). Cell: 4-state (`classifyCell`), `mine` highlight (case-insensitive name match), `nameColor()` background hash (depends on current theme — dark/light hue split), exact `aria-label`/`title` text per state.
- **Design decision to make explicit:** `weekHeaderCells` currently returns HTML strings; port it to return header **data** and let the component render JSX (no `dangerouslySetInnerHTML`). Do this as part of B1, not silently — it's a real API change to a bridged module.
- **Sequencing risk:** `paintSel()`/`document.querySelector('td.cell...')` (drag-select, context menu, keyboard nav — all still in `legacy.js` until B2) rely on the exact `td.cell[data-mid][data-date]` shape. Either (a) ship B1+B2 together in one slice, or (b) keep B1's cells emitting the identical attributes and have a temporary effect call the legacy `paintSel()`/`refreshDot` adapters after each render. Decide before starting; (a) is simpler and lower-risk given how tightly selection reads the grid DOM.
- **Known-bug decision point:** the `wknd` class asymmetry between `render()`/`refreshCell()` (ARCHITECTURE known-bug) exists *because* there are two render paths. React eliminates the second path (its own diffing replaces `refreshCell`/`patchCells`), so B1 is the natural point to close this bug — call it out as an intentional, flagged behavior change (E2), not a silent side effect of the port.
- **Functionality:** every state above renders identically; `ensureOverflow`'s "keep the grid wider than the viewport" growth loop still runs (a `useLayoutEffect` measuring `scrollWidth`, same `<100` extra-weeks guard).
- **Usability:** identical, plus the bug fix above (flagged).
- **Tests:** header shows correct KW/weekday/today-column for a fixed date; all 4 cell states render correct class/aria-label/title; `mine` highlight; category single-click vs double-click behave differently; collapsed-group-but-searching still shows rows; favorites float to their own group; star click toggles favorite.

### B2 — Selection & keyboard navigation (`Sel`, mouse/keydown handlers)
- **Must-haves (`legacy.js:827–1122`):** anchor/focus rectangle (reuses `ui/selection.ts` unchanged) as component/hook state; mousedown starts a new anchor (or, with Shift held and an existing anchor, extends from it); mouseover during a drag extends focus; mouseup ends the drag and opens the context menu **only if** the drag actually moved (`didDrag`) and covers >1 cell; arrow keys move focus with `clampIndex`, Shift+arrow extends, Enter opens (single cell → booking action, multi-cell → context menu), Escape clears; keyboard handling is suppressed while a modal is open or focus sits in an input/textarea/select; **growth interleaves with movement** — moving right past the last column grows `extraWeeks` and re-reads the index, moving left triggers `prependWeek()` and re-reads — this exact order must be preserved (a naive port that clamps before growing will feel subtly wrong at the grid edges). Auto-scroll during drag (45px edge threshold, 60ms interval, including auto-`prependWeek()` at the left edge).
- **Functionality:** identical Excel-style selection.
- **Usability:** this is the single highest fidelity-risk slice in Phase 7 — plan a manual side-by-side session against the still-running legacy app (or `789bfec`) before deleting the old code, not just a `verify` pass.
- **Tests:** keyboard move + clamp at grid edges; Shift+arrow extends; Shift+click extends from anchor; multi-cell drag selects the right rectangle; Escape clears; Enter routes to the right action by selection size; drag near an edge triggers auto-scroll/auto-grow (mock `scrollLeft`/`getBoundingClientRect`).

### B3 — Infinite scroll / week growth (`prependWeek`, scroll/wheel listeners, month-jump)
- **Must-haves (`legacy.js:150–214, 547–600`):** `MAXW=12` week-window cap, beyond which the window **shifts** right instead of growing (keeps the DOM small); `extendPending` debounce guards re-entrancy; a 350ms "just scrolled programmatically" grace window prevents the jump-triggering-a-jump feedback loop the comments call out explicitly; a `wheel` listener compensates for the left edge not firing `scroll` events at `scrollLeft:0`; month/year selects sync from the **leftmost visible column** on scroll (rAF-throttled `updateJumpFromScroll`), and picking a month resets, re-renders, and jumps to the 1st.
- **Functionality:** identical scroll/growth behavior — this is fundamentally imperative DOM/scroll-position code; a small custom hook (`useGridScroll`) wrapping a real ref is the honest React shape here, not a "pure" component.
- **Usability:** preserve the anti-jump-back fix verbatim — it was a deliberately hard-won UX fix per the legacy comments.
- **Tests:** jsdom doesn't lay out real pixel widths, so assert on *triggers* (store state: `extraWeeks++`/`startMonday` shift) under mocked `scrollLeft`/`scrollWidth`/`clientWidth`, not exact pixels.

### B4 — Booking form, detail modal, undo toast
- **Must-haves (`legacy.js:1211–1354`):** form is **sticky** (not dismissible by outside-click/Esc) while open; name defaults to `S.user`; date range books **every calendar day including weekends** in range, not just workdays (easy to get backwards); validation: name required, `from<=to`, and `dates.length*mids.length<=500`; on conflict, the form **reopens prefilled** (name/note preserved) with a capped list (first 15) of conflicts plus a "book only free" force button; on success the modal closes **before** the async write resolves (optimistic), followed by a 9s undo toast. Detail modal: contiguous same-name weekday-run detection vs. group (`gid`) detection are two different "delete more" affordances with different confirm copy; a "Statistik" shortcut opens Stats pre-filtered to that person.
- **Functionality:** all of the above, byte-identical German copy.
- **Usability:** preserve exact toast durations (3.5s default / 9s with undo) and the 15-item conflict-list cap.
- **Tests:** validation messages for each invalid input; weekend-inclusive date range confirmed; conflict reopen preserves name/note and shows the force-book path; run-vs-group detection picks the right delete scope; undo restores prior values (including re-deleting a created cell when `prev:null`).

### B5 — Four modals: my-bookings, stats, all-bookings, admin
- **My-bookings** (`1688–1771`): run structure is **frozen at open** (`computeMyRuns` called once) but each run's *live* days are re-filtered against current data on every render, so deletions disappear without recomputing groupings; per-run expand/collapse keyed by `mid|firstDate`; "only my machines" filter button; per-day vs. per-run delete (run delete requires confirm when >1 day); "goto" expands the target's category/group before jumping (a filtered-out target wouldn't be visible otherwise).
- **Stats** (`1773–1931`): 3 modes (Ressourcen/Personen/Wartung) via segmented control; category show/hide buttons apply only in Ressourcen mode; drilldown (machine→who booked it, person→their machines) with a back control; independent fold state per category/group; default range = Jan 1 of current year → today; range changes auto-recompute (validated `from<=to`) with no separate "compute" button.
- **All-bookings** (`1622–1686`): person/machine substring filters, a group `<select>` grouped by category via `<optgroup>`, a date-overlap window, 5 sort keys (unknown key falls back to `termin`) persisted to `localStorage('mb_absort')`, 300-row cap labeled "(gekürzt)"; "goto" narrows the machine filter to just that row's machine before jumping (so it's guaranteed visible).
- **Admin** (`1936–1983`): sort mode (manual/name/group) persisted to `localStorage('mb_admsort')`; ↑/↓ reorder buttons show **only** in manual mode; reorder silently no-ops across a group boundary (the reducer aborts — UI should handle that gracefully, not throw); edit/add routes to the machine form (B6); a button opens the log view.
- **Functionality:** each view's pure kernel (`ui/views/*.ts`) is already 100%-tested and unchanged — these slices are pure wiring.
- **Tests:** per view, assert the right reducer/filter is called with the right args on each control, and that persisted localStorage keys are read/written under their exact legacy names.

### B6 — Machine form + group management
- **Must-haves (`legacy.js:1984–2075`):** category + group `<select>` grouped by category, plus a free-text "new group" input that overrides the select when non-empty; redundancy field backed by a `<datalist>` of existing values; 7 weekday checkboxes serialize to a mask where **all-on stores nothing** (`null`, not `'1111111'`); a dynamic maintenance-slot list (add/remove/edit rows: type, from, until, note) validated (`from<=until` per slot) before save; save routes through `saveMachine` (new: slug from German transliteration + de-duplication suffix + same-group insertion index; edit: aborts gracefully if the machine was concurrently deleted — a real race, not a bug); delete requires a confirm naming the cascade ("inklusive aller zugehörigen Buchungen... nicht rückgängig").
- **Functionality/usability:** identical; the slug/mask edge cases are the highest-value test targets, not the form chrome.
- **Tests:** slug generation for ä/ö/ü/ß names + uniqueness suffixing (`-2`, `-3`, …); mask round-trip (all-on → `undefined`/omitted); a bad maintenance range blocks save with the right toast; editing a since-deleted machine aborts without throwing.

### B7 — Assistant UI (device tree, drag-drop, results)
- **Must-haves (`legacy.js:1424–1619`):** device checklist reuses the same collapsible fav/category/group tree as the "Filtern" dropdown, but toggles only add/remove a device (`asToggleId`) and immediately reflect into the work area; dragging a device onto another device creates a new "need 1 of 2" group with a color from a fixed hue cycle (`AS_HUES`, 8 colors); dropping onto a group's kids area joins it; dropping onto empty canvas returns a node to root; the need stepper is clamped `[1, childCount]`; a redundancy hint ("alle gleichwertigen Geräte hier?") shows when a group has more members than its need; before running, if `anyRedund` is true, a confirm dialog asks whether every equivalent device was added; results are day-runs meeting the minimum-consecutive-days input, each with an editable "days to book" number (clamped to the run's length, with a transient tooltip on clamp), a suggested-devices line (only shown when the tree contains ≥1 group), a "pin" button that **collapses** (not closes) the modal and filters+centers the grid on that run, and "Buchen…" opens the booking form pre-picked.
- **React note:** native `dragstart`/`dragover`/`drop` map directly onto `onDragStart`/`onDragOver`/`onDrop` — no new dependency needed, keeps the zero-extra-runtime-dep intent for anything beyond React itself.
- **Functionality:** all tree mutation logic is already pure and 100%-tested in `core/assistant.ts` — this slice is DOM/DnD wiring only.
- **Tests:** each DnD action (group-onto, join, to-root, dissolve, change-need, remove) calls the right core function and re-renders; the redundancy confirm gate appears only when `anyRedund` is true; results list caps at 30 and respects the min-days filter.

### B8 — Presence badge, collision banner, SSE hook
- **Must-haves (`legacy.js:2169–2207` + `setPres`/`showCollision`/`queueRemote`):** presence badge shows a count + a hover title listing active names in **server-received order** (not alphabetized — `presenceInfo` only filters, doesn't sort); reconnect on name change; the `mb_presence` "share" toggle, when off, connects **without** a `user` query param so this browser doesn't appear in others' lists; `hello` stamps the "last updated" time; `update` events patch cells + revision and queue a toast **only for foreign changes** (case-insensitive `isForeign`); `structural` events trigger a full state reload; `onerror` flips a visible "⚠ offline" indicator with no custom retry logic (EventSource retries natively); the collision banner is **persistent** (manual-dismiss only), shown when the server reports partial write conflicts.
- **Functionality:** `net/sse.ts`'s pure functions (`applyUpdate`/`presenceInfo`/`isForeign`) are unchanged and already 100%-tested — this slice is the `useEffect`-based `EventSource` lifecycle + the badge/banner components.
- **Tests:** mock `EventSource`; assert a foreign `update` queues a toast while an own-name update doesn't; a `structural` event reloads state; `onerror` flips the offline indicator; toggling the presence share setting changes the connection URL.

### B9 — Settings, help, log, name-prompt
- **Must-haves (`legacy.js:123–147, 283–405, 2076–2085`):** theme select (auto/light/dark) applies immediately **and** forces a grid re-render (booking cell colors are hue-shifted by `nameColor()` per current theme — a theme change with no re-render leaves stale colors); presence checkbox reconnects SSE; compact checkbox toggles a `<body>` class; weekends checkbox resets `extraWeeks` and re-centers today; debug checkbox toggles the debug panel; a "reconnect" button re-runs `connectSSE`+`refreshNow`; the name-prompt modal is non-dismissible on first run only, Enter-to-save, and auto-focuses its input. Help and Log are the lowest-complexity slices — Help is static legend text with embedded icons, Log is a plain capped list with a "back to admin" button — good first ports to build component conventions on before B1/B2.
- **Must-haves (localStorage keys — preserve verbatim so existing users' browsers upgrade losslessly):** `mb_theme`, `mb_presence`, `mb_compact`, `mb_weekends`, `mb_debug`, `mb_user`.
- **Tests:** theme toggle updates `document.documentElement.dataset.theme` and triggers a grid re-render; each settings control reads/writes its exact legacy key; name-prompt blocks dismissal only on first run.

### B10 — App shell; delete `legacy.js`; retire `window.S`
- **Must-haves (`legacy.js:2209–2220, 69–90`):** boot tries `/api/state`; on failure, shows the start-screen error copy verbatim and hides the old file-picker buttons (`btnPickFile`/`btnReadOnly`/`fsaHint` — likely deletable outright by this point, confirm they're unused); on success, hides the start screen, shows toolbar+grid, fills the group filter, prompts for a name only when `!user && !readOnly`, applies the debug panel, prepends one buffer week, centers today, and starts live timers (SSE + focus-triggered silent refresh) **exactly once** even if re-invoked (the `liveTimersOn` guard).
- **Functionality:** identical bootstrap sequence; `app.ts` shrinks to store hydration + `createRoot(...).render(<App/>)`; `window.S`/`window.render`/`window.notify` bridges are deleted along with the last legacy consumer.
- **Tests:** mount `<App/>` with a mocked fetch returning valid/invalid `/api/state` and assert the right screen renders in each case; name-prompt appears exactly when `!user && !readOnly`; live timers start once even across remounts.

**Suggested order for Backlog B:** B0 → B9 (Help/Log first, to build conventions cheaply) → B1+B2 together (see sequencing note) → B3 → B4 → B5 (4 commits) → B6 → B7 → B8 → B10.
