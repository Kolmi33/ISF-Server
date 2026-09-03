// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { AppState } from '../../../shared/types.ts';
import { mondayOfDate } from '../../../shared/dates.ts';
import { store } from '../store-instance.ts';
import { registerGridRenderTrigger } from './grid-render-bridge.ts';
import {
  canStillGrowWindow,
  centerColumn,
  centerToday,
  computeWeekPixelWidth,
  daysPerWeek,
  ensureOverflow,
  gotoDate,
  initGridScroll,
  isNearLeftEdge,
  isNearRightEdge,
  isScrollingLeft,
  needsOverflowGrowth,
  pickVisibleDateColumn,
  prependWeek,
  resetView,
  syncJumpControls,
} from './grid-scroll.ts';

describe('canStillGrowWindow', () => {
  // What: the auto-grow-window feature can still add more weeks while under its cap.
  // How: checks a fresh window (0) and one just below the cap (11) both allow growth.
  it('allows growth under the cap', () => {
    expect(canStillGrowWindow(0, false)).toBe(true);
    expect(canStillGrowWindow(11, false)).toBe(true);
  });
  // What: at the cap, growth normally stops — UNLESS a drag (e.g. a marquee selection) is in
  // progress, in which case it's allowed anyway so the grid doesn't cut off mid-drag.
  // How: checks the cap value (12) refuses growth without a drag, but allows it with one.
  it('stops growth at the cap unless a drag is in progress', () => {
    expect(canStillGrowWindow(12, false)).toBe(false);
    expect(canStillGrowWindow(12, true)).toBe(true);
  });
});

describe('isNearRightEdge / isNearLeftEdge', () => {
  // What: "near the right edge" means the visible right boundary is within 250px of the
  // content's actual end.
  // How: checks a scroll position that's within the 250px threshold and one that isn't.
  it('is near the right edge within 250px of the end', () => {
    expect(isNearRightEdge(750, 250, 1000)).toBe(true); // 750+250 > 1000-250
    expect(isNearRightEdge(400, 250, 1000)).toBe(false);
  });
  // What: "near the left edge" means within 150px of scrollLeft 0 — checked as a strict
  // less-than, so exactly 150px does NOT count as near.
  // How: checks 100px (near), and both 150px and 200px (not near, including the boundary itself).
  it('is near the left edge within 150px of the start', () => {
    expect(isNearLeftEdge(100)).toBe(true);
    expect(isNearLeftEdge(150)).toBe(false);
    expect(isNearLeftEdge(200)).toBe(false);
  });
});

describe('isScrollingLeft', () => {
  // What: a plain negative horizontal wheel delta is scrolling left.
  // How: checks a negative deltaX with no shift key.
  it('is true for a plain negative horizontal delta', () => {
    expect(isScrollingLeft(-10, 0, false)).toBe(true);
  });
  // What: holding shift while scrolling vertically is the standard convention for horizontal
  // scroll on a mouse wheel — a negative vertical delta WITH shift also counts as scrolling left.
  // How: checks a negative deltaY with shiftKey:true.
  it('is true for a shift-modified negative vertical delta (the horizontal-scroll convention)', () => {
    expect(isScrollingLeft(0, -10, true)).toBe(true);
  });
  // What: without shift, a negative vertical delta is just normal vertical scrolling, not
  // "scrolling left".
  // How: checks a negative deltaY with shiftKey:false.
  it('is false for a negative vertical delta without shift', () => {
    expect(isScrollingLeft(0, -10, false)).toBe(false);
  });
  // What: a positive delta in either axis is never "scrolling left".
  // How: checks a positive deltaX and a positive shift-modified deltaY.
  it('is false when scrolling right or down', () => {
    expect(isScrollingLeft(10, 0, false)).toBe(false);
    expect(isScrollingLeft(0, 10, true)).toBe(false);
  });
});

describe('needsOverflowGrowth', () => {
  // What: the grid needs more weeks appended when its content isn't yet wider than the
  // viewport (with a small slack margin) AND it hasn't hit the absolute week ceiling yet.
  // How: checks content exactly as wide as the viewport (needs growth to create scroll room)
  // and content just 50px wider (still within the 60px slack, so still needs growth).
  it('needs growth when under the 100-week ceiling and not yet wider than the viewport', () => {
    expect(needsOverflowGrowth(5, 800, 800)).toBe(true); // exactly equal
    expect(needsOverflowGrowth(5, 850, 800)).toBe(true); // within the 60px slack
  });
  // What: growth stops once the content is genuinely wider than the viewport, or once the
  // week count has passed its ceiling regardless of width.
  // How: checks content well past the slack margin, and a week count past the ceiling with a
  // narrow width that would otherwise need growth.
  it('does not need growth once wider than the viewport, or past the ceiling', () => {
    expect(needsOverflowGrowth(5, 900, 800)).toBe(false);
    expect(needsOverflowGrowth(100, 500, 800)).toBe(false);
  });
});

describe('computeWeekPixelWidth', () => {
  // What: a week's total pixel width is (cell width + 1px border) per day, plus a fixed 9px
  // gap column between weeks.
  // How: checks the formula against both a 5-day and a 7-day week at the same cell width.
  it('is (cellWidth+1) per day, plus a 9px gap column', () => {
    expect(computeWeekPixelWidth(99, 5)).toBe(100 * 5 + 9);
    expect(computeWeekPixelWidth(99, 7)).toBe(100 * 7 + 9);
  });
});

describe('pickVisibleDateColumn', () => {
  const columns = [
    { rightEdge: 50, date: '2021-01-04' },
    { rightEdge: 150, date: '2021-01-05' },
    { rightEdge: 250, date: '2021-01-06' },
  ];
  // What: given the current scroll position, picks the first column whose right edge is
  // still ahead of it — i.e. the first column actually visible at the left of the viewport.
  // How: scrolls to a position past the first column's edge but before the second's, and
  // checks the second column's date is picked.
  it('picks the first column whose right edge extends past the left edge', () => {
    expect(pickVisibleDateColumn(columns, 100)).toBe('2021-01-05');
  });
  // What: scrolled past every column's edge, the function falls back to the very last column
  // rather than returning nothing.
  // How: scrolls far past all three columns' edges and checks the last one's date is picked.
  it('picks the last column once scrolled past every one of them', () => {
    expect(pickVisibleDateColumn(columns, 999)).toBe('2021-01-06');
  });
  // What: with no columns at all, there's nothing to pick — returns null, not a crash.
  it('is null for an empty column list', () => {
    expect(pickVisibleDateColumn([], 0)).toBeNull();
  });
});

describe('daysPerWeek', () => {
  beforeEach(() => localStorage.clear());
  // What: the grid shows 5 days (workweek) by default, or 7 once the "show weekends" setting
  // is turned on.
  // How: checks the default with nothing in localStorage, then sets the weekends flag and
  // checks it switches to 7.
  it('is 5 by default and 7 once weekends are on', () => {
    expect(daysPerWeek()).toBe(5);
    localStorage.setItem('mb_weekends', 'on');
    expect(daysPerWeek()).toBe(7);
  });
});

// ---- DOM-facing behavior ------------------------------------------------------------------

function buildDom(): void {
  document.body.innerHTML = `
    <div id="gridWrap" style="width:0">
      <table id="grid">
        <thead>
          <tr>
            <th data-date="2021-01-04"></th>
            <th data-date="2021-01-05"></th>
            <th data-date="2021-01-06"></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="cell" data-machine-id="m1" data-date="2021-01-04"></td>
            <td class="cell" data-machine-id="m1" data-date="2021-01-05"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <select id="jumpMonth"><option value="0">Jan</option><option value="1">Feb</option></select>
    <input id="jumpYear">
    <button id="btnToday"></button>
    <button id="btnPrev"></button>
    <button id="btnNext"></button>`;
}

function stubWindowGlobals(): void {
  // grid-scroll.ts now reads/writes state via the real `store` singleton — store.set merges
  // onto that same shared object, and window.S is kept aliased to it (as app.ts does in
  // production) so every existing window.S.* read/write below keeps working unchanged.
  store.set({
    startMonday: new Date('2021-01-04T00:00:00Z'),
    extraWeeks: 0,
    data: { machines: [], bookings: {} },
  } as unknown as Partial<AppState>);
  window.S = store.state;
}

// store.notify is what grid-scroll.ts now calls (directly, or via store.set); spied once here
// rather than per-test since vi.clearAllMocks() (below) already resets its call history each
// test without needing to re-wrap it.
const notifySpy = vi.spyOn(store, 'notify');

// Simulates the mounted Grid component's render-trigger registration (`Grid.tsx`'s own mount
// effect, normally) — registered once in `beforeAll` below, same "stable reference, call
// history cleared per test by vi.clearAllMocks()" shape as `notifySpy` above.
const renderTrigger = vi.fn();

// `prependWeek`'s and the scroll handler's re-entrancy guard (`extendPending`, module-private)
// is cleared by a real `setTimeout`. Fake timers run for the whole file so that debounce is
// deterministic — each test flushes any timer a previous test left pending before it starts,
// rather than racing real wall-clock time between `it()` blocks.
// `handleGridWrapScroll` also guards against firing within 350ms of this module's own last
// programmatic scroll (`performance.now()`-based) — vitest's fake timers don't fake
// `performance.now()`, and consecutive tests can genuinely run faster than 350ms of real wall
// time apart, so a timestamp set by one test would otherwise still "count" in the next one.
// Stubbed here to a fake clock this file fully controls instead.
let fakeNow = 0;

beforeAll(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => fakeNow);
  buildDom();
  stubWindowGlobals();
  initGridScroll();
  registerGridRenderTrigger(renderTrigger);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(1000); // flush any debounce timer left pending by the previous test
  fakeNow += 10_000; // always comfortably past the 350ms recent-programmatic-scroll guard
  stubWindowGlobals();
  document.getElementById('gridWrap')!.scrollLeft = 0;
  document.getElementById('gridWrap')!.style.display = '';
  vi.clearAllMocks();
});

describe('prependWeek', () => {
  // What: prepending a week moves the grid's start date back 7 days and grows the extra-weeks
  // counter, triggering exactly one repaint.
  // How: calls prependWeek() once and checks the new startMonday, the extraWeeks count, and
  // that notify fired once.
  it('moves startMonday back a week and grows extraWeeks, notifying once', () => {
    prependWeek();
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2020-12-28');
    expect(window.S.extraWeeks).toBe(1);
    expect(notifySpy).toHaveBeenCalledOnce();
  });

  // What: calling prependWeek twice in quick succession only actually prepends once — the
  // second call within the debounce window returns immediately, guarding against the scroll
  // handler firing it repeatedly for one continuous scroll gesture.
  // How: calls prependWeek twice back-to-back (no time advance) and checks extraWeeks only grew by 1.
  it('is re-entrancy-guarded: a second call within the debounce window is a no-op', () => {
    prependWeek();
    prependWeek();
    expect(window.S.extraWeeks).toBe(1); // not 2 — the second call returned immediately
  });

  // What: once the debounce window has actually elapsed, a genuinely new prepend call is allowed.
  // How: prepends once, advances the fake clock past the debounce window, prepends again, and
  // checks extraWeeks grew a second time.
  it('allows another prepend once the debounce window has elapsed', () => {
    prependWeek();
    vi.advanceTimersByTime(80);
    prependWeek();
    expect(window.S.extraWeeks).toBe(2);
  });
});

describe('handleGridWrapScroll (via a real scroll event)', () => {
  function fireScroll(): void {
    document.getElementById('gridWrap')!.dispatchEvent(new Event('scroll'));
  }

  // What: scrolling near the right edge, while still under the week-window cap, grows the
  // window (adds more weeks) and repaints.
  // How: sets up scroll metrics that put the viewport near the right edge, fires a real
  // scroll event, and checks extraWeeks grew and notify fired once.
  it('grows extraWeeks when scrolled near the right edge and still under the window cap', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    wrap.scrollLeft = 900; // 900+800 > 1000-250
    fireScroll();
    expect(window.S.extraWeeks).toBe(1);
    expect(notifySpy).toHaveBeenCalledOnce();
  });

  // What: once the week-window cap is reached, scrolling near the right edge no longer grows
  // the window (adds weeks) — instead it SHIFTS the whole window forward by a week, keeping
  // the total week count fixed.
  // How: sets extraWeeks to the cap, scrolls near the right edge, and checks extraWeeks stayed
  // the same while startMonday advanced by 7 days.
  it('shifts the window forward instead of growing once past the week-window cap', () => {
    window.S.extraWeeks = 12; // at MAX_GROWN_WEEKS
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    wrap.scrollLeft = 900;
    fireScroll();
    expect(window.S.extraWeeks).toBe(12); // unchanged — shifted, not grown
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2021-01-11'); // +7 days
  });

  // What: scrolling near the left edge (with plenty of room on the right) prepends a week,
  // the mirror of the right-edge growth behavior.
  // How: sets up scroll metrics near the left edge only, fires a scroll event, and checks
  // both extraWeeks grew and startMonday moved back a week.
  it('prepends a week when scrolled near the left edge', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 2000, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    wrap.scrollLeft = 50; // near the left edge, and nowhere near the right one
    fireScroll();
    expect(window.S.extraWeeks).toBe(1);
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2020-12-28');
  });

  // What: scrolling in the middle of the range (neither edge) does nothing at all.
  // How: sets scrollLeft to a middle value, fires a scroll event, and checks notify never fired.
  it('does nothing in the middle of the scroll range', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 2000, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    wrap.scrollLeft = 500;
    fireScroll();
    expect(notifySpy).not.toHaveBeenCalled();
  });

  // What: right after code itself scrolls the grid (e.g. centering on a date), an immediately
  // following scroll event is ignored for a short window — otherwise the programmatic scroll
  // could be misread as the user scrolling near an edge and trigger an unwanted growth/snap.
  // How: calls centerColumn (a programmatic scroll) to set the "just scrolled" timestamp, then
  // fires a scroll event that would normally prepend, and checks nothing happened.
  it('ignores growth for a short window after a programmatic scroll (no snap-back)', () => {
    centerColumn('2021-01-04'); // sets lastProgrammaticScrollAt = now
    document.getElementById('gridWrap')!.scrollLeft = 50; // would otherwise prepend
    fireScroll();
    expect(notifySpy).not.toHaveBeenCalled();
  });

  // What: even at the left edge (which would normally prepend), growth stops entirely once
  // the absolute 150-extra-week ceiling is reached — an outer safety limit beyond the
  // 12-week "grow vs shift" cap tested earlier.
  // How: sets extraWeeks to 150, scrolls near the left edge, fires a scroll event, and checks
  // nothing happened.
  it('stops growing once the absolute 150-extra-week ceiling is reached', () => {
    window.S.extraWeeks = 150;
    document.getElementById('gridWrap')!.scrollLeft = 50;
    fireScroll();
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

describe('the wheel listener at the left edge', () => {
  // What: a horizontal wheel-scroll-left gesture while already at the very start (scrollLeft
  // 0) prepends a week — a mouse-wheel-specific trigger distinct from the scroll-event-based
  // edge detection tested above (a trackpad/scrollbar drag never reaches scrollLeft 0 exactly
  // while still scrolling left, but a wheel tick easily does).
  // How: sets scrollLeft to 0, dispatches a wheel event with a negative deltaX, and checks
  // extraWeeks grew.
  it('prepends a week when scrolling left while already at scrollLeft 0', () => {
    document.getElementById('gridWrap')!.scrollLeft = 0;
    document
      .getElementById('gridWrap')!
      .dispatchEvent(new WheelEvent('wheel', { deltaX: -10, deltaY: 0 }));
    expect(window.S.extraWeeks).toBe(1);
  });

  // What: the same wheel gesture does nothing if the grid isn't actually scrolled all the
  // way to the left already.
  // How: sets scrollLeft to a nonzero value, dispatches the same left-scroll wheel event, and
  // checks notify never fired.
  it('does nothing when not at the left edge', () => {
    document.getElementById('gridWrap')!.scrollLeft = 50;
    document
      .getElementById('gridWrap')!
      .dispatchEvent(new WheelEvent('wheel', { deltaX: -10, deltaY: 0 }));
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

describe('ensureOverflow', () => {
  // What: right after data loads (or the window resizes), if the rendered grid isn't yet
  // wide enough to fill the viewport, ensureOverflow grows the week window and triggers a
  // DIRECT render (not the debounced notify path) to close the gap immediately.
  // How: sets scroll metrics narrower than the viewport, calls ensureOverflow(), and checks
  // extraWeeks grew and the render trigger fired once.
  it('grows extraWeeks and calls render() directly when narrower than the viewport', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    ensureOverflow();
    expect(window.S.extraWeeks).toBe(1);
    expect(renderTrigger).toHaveBeenCalledOnce();
  });

  // What: once the grid is already wider than the viewport, ensureOverflow has nothing to do.
  // How: sets scroll metrics wider than the viewport, calls ensureOverflow(), and checks the
  // render trigger was never called.
  it('does nothing once already wider than the viewport', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    ensureOverflow();
    expect(renderTrigger).not.toHaveBeenCalled();
  });

  // What: before the first data load, the grid wrapper is hidden (display:none) and
  // ensureOverflow correctly skips its work rather than measuring a hidden, meaningless layout.
  // How: hides the wrapper element, calls ensureOverflow(), and checks the render trigger
  // never fired.
  it('does nothing while the grid is hidden (before the first data load)', () => {
    document.getElementById('gridWrap')!.style.display = 'none';
    ensureOverflow();
    expect(renderTrigger).not.toHaveBeenCalled();
  });
});

describe('centerColumn / centerToday / gotoDate', () => {
  // What: centerColumn finds the named date's column and scrolls it to the middle of the wrapper.
  // How: calls centerColumn on a known rendered date; since jsdom reports 0 for every layout
  // metric (no real geometry to measure), this mostly proves it doesn't throw and finds the
  // right cell rather than checking real centering math (that's browser-verified, E5).
  it('centerColumn scrolls the named date to the middle of the wrapper', () => {
    centerColumn('2021-01-04');
    // jsdom reports 0 for every layout metric, so this mostly proves it doesn't throw and
    // reads the right cell — the real centering math is browser-verified (E5).
    expect(document.getElementById('gridWrap')!.scrollLeft).toBe(0);
  });

  // What: a date with no rendered cell (not currently in the visible grid) is a safe no-op.
  // How: calls centerColumn with a date far outside the fixture's rendered range.
  it('centerColumn is a no-op for a date with no rendered cell', () => {
    expect(() => centerColumn('1999-01-01')).not.toThrow();
  });

  // What: centerToday is a thin wrapper that defers to centerColumn, scheduled for the next
  // animation frame (so it runs after any pending layout/render settles).
  // How: stubs requestAnimationFrame to run its callback synchronously and checks calling
  // centerToday() doesn't throw.
  it('centerToday defers to centerColumn on the next frame', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    expect(() => centerToday()).not.toThrow();
  });

  // What: gotoDate scrolls to an arbitrary date, also deferred to the next animation frame.
  // How: stubs requestAnimationFrame the same way and checks calling gotoDate() doesn't throw.
  it('gotoDate scrolls (on the next frame) without throwing', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    expect(() => gotoDate('2021-01-04')).not.toThrow();
  });
});

describe('syncJumpControls', () => {
  // What: the month/year jump dropdown+input are kept in sync with whichever week block the
  // grid is currently scrolled to (read from S.startMonday, offset a few days to land
  // reliably within the intended month).
  // How: sets a known startMonday, calls syncJumpControls(), and checks both controls'
  // values match that date's month/year.
  it('sets the month/year controls from the week-block currently at the grid start', () => {
    window.S.startMonday = new Date('2021-01-25T00:00:00Z'); // Monday; +3 days = Thursday Jan 28
    syncJumpControls();
    expect((document.getElementById('jumpMonth') as HTMLSelectElement).value).toBe('0'); // January
    expect((document.getElementById('jumpYear') as HTMLInputElement).value).toBe('21');
  });
});

describe('the month/year jump controls (change event)', () => {
  // What: pins a specific, easy-to-miss legacy-faithful side effect: choosing a month/year
  // computes that month's target date, then calls prependWeek() as a scroll-buffer step —
  // and prependWeek() itself shifts S.startMonday back another 7 days. The real scroll target
  // is handled separately by gotoDate() (browser-verified), so S.startMonday legitimately
  // ends up one week earlier than the jump target itself.
  // How: selects February 2021 via the month dropdown's change event and checks startMonday
  // landed one week before what a naive "first Monday of February" calculation would give,
  // with extraWeeks reflecting resetView() zeroing it then prependWeek() growing it back to 1.
  it('jumping to a month scrolls there, one week further back than the target itself', () => {
    // Faithful to legacy: jumpToMonth() computes the target month's first Monday, then calls
    // prependWeek() as a scroll-buffer step — which itself shifts S.startMonday back another
    // 7 days. gotoDate() (browser-verified, E5) is what actually scrolls to the real target;
    // S.startMonday ending up one week earlier is the correct, if easy-to-miss, side effect.
    (document.getElementById('jumpMonth') as HTMLSelectElement).value = '1'; // February
    (document.getElementById('jumpYear') as HTMLInputElement).value = '21';
    document.getElementById('jumpMonth')!.dispatchEvent(new Event('change'));
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2021-01-25');
    expect(window.S.extraWeeks).toBe(1); // resetView() zeroes it, then prependWeek() grows it back
    expect(notifySpy).toHaveBeenCalled();
  });

  // What: a full four-digit year typed into the year field is read as that literal year, not
  // misinterpreted as a two-digit shorthand (e.g. "99" meaning 1999).
  // How: types the literal year 1999 and checks the resulting startMonday's year/month —
  // since Jan 1 1999 was a Friday, that week's Monday actually falls in December 1998, which
  // only happens if 1999 was parsed as a real four-digit year and not some other encoding.
  it('treats a four-digit year as-is rather than as a two-digit offset from 2000', () => {
    (document.getElementById('jumpMonth') as HTMLSelectElement).value = '0';
    (document.getElementById('jumpYear') as HTMLInputElement).value = '1999';
    document.getElementById('jumpYear')!.dispatchEvent(new Event('change'));
    // Jan 1 1999 was a Friday, so the Monday of its week falls in the preceding year —
    // proves 1999 was read as a real four-digit year, not "20" + "99" or similar.
    expect(window.S.startMonday.getUTCFullYear()).toBe(1998);
    expect(window.S.startMonday.getUTCMonth()).toBe(11); // December
  });

  // What: a non-numeric year field value falls back to using the actual current year,
  // rather than producing NaN or throwing.
  // How: types a non-numeric string into the year field, computes what the current-year
  // fallback SHOULD produce (independently, using the same Jan-1st→Monday transform the code
  // under test uses — since Jan 1st doesn't always fall on a Monday, the expected result can
  // itself land in the preceding year), and checks the actual result matches that computation.
  it('falls back to the current year when the year field is not a number', () => {
    (document.getElementById('jumpMonth') as HTMLSelectElement).value = '0';
    (document.getElementById('jumpYear') as HTMLInputElement).value = 'abc';
    // Read at the same instant as the code under test, then run the same Jan-1st→Monday
    // transformation it does — Jan 1st doesn't necessarily land on a Monday itself, so the
    // result can fall in the preceding year (exactly the case this test happened to hit).
    const expectedMonday = mondayOfDate(new Date(Date.UTC(new Date().getFullYear(), 0, 1)));
    document.getElementById('jumpMonth')!.dispatchEvent(new Event('change'));
    expect(window.S.startMonday.getUTCFullYear()).toBe(expectedMonday.getUTCFullYear());
  });
});

describe('the Heute/◀/▶ toolbar buttons', () => {
  // What: the "Heute" (today) button resets the view to the current week, same
  // zero-then-regrow extraWeeks behavior as the month/year jump.
  // How: clicks the button and checks extraWeeks ended at 1 (reset to 0, then prependWeek's
  // scroll-buffer step grew it back) and that a repaint was triggered.
  it('Heute resets the view and jumps to the current week', () => {
    document.getElementById('btnToday')!.click();
    expect(window.S.extraWeeks).toBe(1); // resetView() zeroes it, then prependWeek() grows it back
    expect(notifySpy).toHaveBeenCalled();
  });

  // What: the ◀ (previous) button steps the grid one week earlier.
  // How: clicks the button and checks startMonday moved back exactly 7 days, with one notify.
  it('◀ moves startMonday back a week', () => {
    document.getElementById('btnPrev')!.click();
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2020-12-28');
    expect(notifySpy).toHaveBeenCalledOnce();
  });

  // What: the ▶ (next) button steps the grid one week later.
  // How: clicks the button and checks startMonday moved forward exactly 7 days, with one notify.
  it('▶ moves startMonday forward a week', () => {
    document.getElementById('btnNext')!.click();
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2021-01-11');
    expect(notifySpy).toHaveBeenCalledOnce();
  });
});

describe('resetView', () => {
  // What: resetView clears the grown week-window state and scrolls back to the start —
  // the shared "go back to a clean baseline" step both Heute and the month/year jump build on.
  // How: sets a nonzero extraWeeks and scroll position, calls resetView(), and checks both
  // reset to zero.
  it('zeroes extraWeeks and scrolls back to the start', () => {
    window.S.extraWeeks = 5;
    document.getElementById('gridWrap')!.scrollLeft = 200;
    resetView();
    expect(window.S.extraWeeks).toBe(0);
    expect(document.getElementById('gridWrap')!.scrollLeft).toBe(0);
  });
});
