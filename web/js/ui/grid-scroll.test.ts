// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { AppState } from '../../../shared/types.ts';
import { mondayOfDate } from '../core/dates.ts';
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
  it('allows growth under the cap', () => {
    expect(canStillGrowWindow(0, false)).toBe(true);
    expect(canStillGrowWindow(11, false)).toBe(true);
  });
  it('stops growth at the cap unless a drag is in progress', () => {
    expect(canStillGrowWindow(12, false)).toBe(false);
    expect(canStillGrowWindow(12, true)).toBe(true);
  });
});

describe('isNearRightEdge / isNearLeftEdge', () => {
  it('is near the right edge within 250px of the end', () => {
    expect(isNearRightEdge(750, 250, 1000)).toBe(true); // 750+250 > 1000-250
    expect(isNearRightEdge(400, 250, 1000)).toBe(false);
  });
  it('is near the left edge within 150px of the start', () => {
    expect(isNearLeftEdge(100)).toBe(true);
    expect(isNearLeftEdge(150)).toBe(false);
    expect(isNearLeftEdge(200)).toBe(false);
  });
});

describe('isScrollingLeft', () => {
  it('is true for a plain negative horizontal delta', () => {
    expect(isScrollingLeft(-10, 0, false)).toBe(true);
  });
  it('is true for a shift-modified negative vertical delta (the horizontal-scroll convention)', () => {
    expect(isScrollingLeft(0, -10, true)).toBe(true);
  });
  it('is false for a negative vertical delta without shift', () => {
    expect(isScrollingLeft(0, -10, false)).toBe(false);
  });
  it('is false when scrolling right or down', () => {
    expect(isScrollingLeft(10, 0, false)).toBe(false);
    expect(isScrollingLeft(0, 10, true)).toBe(false);
  });
});

describe('needsOverflowGrowth', () => {
  it('needs growth when under the 100-week ceiling and not yet wider than the viewport', () => {
    expect(needsOverflowGrowth(5, 800, 800)).toBe(true); // exactly equal
    expect(needsOverflowGrowth(5, 850, 800)).toBe(true); // within the 60px slack
  });
  it('does not need growth once wider than the viewport, or past the ceiling', () => {
    expect(needsOverflowGrowth(5, 900, 800)).toBe(false);
    expect(needsOverflowGrowth(100, 500, 800)).toBe(false);
  });
});

describe('computeWeekPixelWidth', () => {
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
  it('picks the first column whose right edge extends past the left edge', () => {
    expect(pickVisibleDateColumn(columns, 100)).toBe('2021-01-05');
  });
  it('picks the last column once scrolled past every one of them', () => {
    expect(pickVisibleDateColumn(columns, 999)).toBe('2021-01-06');
  });
  it('is null for an empty column list', () => {
    expect(pickVisibleDateColumn([], 0)).toBeNull();
  });
});

describe('daysPerWeek', () => {
  beforeEach(() => localStorage.clear());
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
            <td class="cell" data-mid="m1" data-date="2021-01-04"></td>
            <td class="cell" data-mid="m1" data-date="2021-01-05"></td>
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
  window.S = {
    startMonday: new Date('2021-01-04T00:00:00Z'),
    extraWeeks: 0,
    data: { machines: [], bookings: {} },
  } as unknown as AppState;
  window.notify = vi.fn();
  window.render = vi.fn();
}

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
  it('moves startMonday back a week and grows extraWeeks, notifying once', () => {
    prependWeek();
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2020-12-28');
    expect(window.S.extraWeeks).toBe(1);
    expect(window.notify).toHaveBeenCalledOnce();
  });

  it('is re-entrancy-guarded: a second call within the debounce window is a no-op', () => {
    prependWeek();
    prependWeek();
    expect(window.S.extraWeeks).toBe(1); // not 2 — the second call returned immediately
  });

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

  it('grows extraWeeks when scrolled near the right edge and still under the window cap', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    wrap.scrollLeft = 900; // 900+800 > 1000-250
    fireScroll();
    expect(window.S.extraWeeks).toBe(1);
    expect(window.notify).toHaveBeenCalledOnce();
  });

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

  it('prepends a week when scrolled near the left edge', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 2000, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    wrap.scrollLeft = 50; // near the left edge, and nowhere near the right one
    fireScroll();
    expect(window.S.extraWeeks).toBe(1);
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2020-12-28');
  });

  it('does nothing in the middle of the scroll range', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 2000, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    wrap.scrollLeft = 500;
    fireScroll();
    expect(window.notify).not.toHaveBeenCalled();
  });

  it('ignores growth for a short window after a programmatic scroll (no snap-back)', () => {
    centerColumn('2021-01-04'); // sets lastProgrammaticScrollAt = now
    document.getElementById('gridWrap')!.scrollLeft = 50; // would otherwise prepend
    fireScroll();
    expect(window.notify).not.toHaveBeenCalled();
  });

  it('stops growing once the absolute 150-extra-week ceiling is reached', () => {
    window.S.extraWeeks = 150;
    document.getElementById('gridWrap')!.scrollLeft = 50;
    fireScroll();
    expect(window.notify).not.toHaveBeenCalled();
  });
});

describe('the wheel listener at the left edge', () => {
  it('prepends a week when scrolling left while already at scrollLeft 0', () => {
    document.getElementById('gridWrap')!.scrollLeft = 0;
    document
      .getElementById('gridWrap')!
      .dispatchEvent(new WheelEvent('wheel', { deltaX: -10, deltaY: 0 }));
    expect(window.S.extraWeeks).toBe(1);
  });

  it('does nothing when not at the left edge', () => {
    document.getElementById('gridWrap')!.scrollLeft = 50;
    document
      .getElementById('gridWrap')!
      .dispatchEvent(new WheelEvent('wheel', { deltaX: -10, deltaY: 0 }));
    expect(window.notify).not.toHaveBeenCalled();
  });
});

describe('ensureOverflow', () => {
  it('grows extraWeeks and calls render() directly when narrower than the viewport', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    ensureOverflow();
    expect(window.S.extraWeeks).toBe(1);
    expect(window.render).toHaveBeenCalledOnce();
  });

  it('does nothing once already wider than the viewport', () => {
    const wrap = document.getElementById('gridWrap')!;
    Object.defineProperty(wrap, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 800, configurable: true });
    ensureOverflow();
    expect(window.render).not.toHaveBeenCalled();
  });

  it('does nothing while the grid is hidden (before the first data load)', () => {
    document.getElementById('gridWrap')!.style.display = 'none';
    ensureOverflow();
    expect(window.render).not.toHaveBeenCalled();
  });
});

describe('centerColumn / centerToday / gotoDate', () => {
  it('centerColumn scrolls the named date to the middle of the wrapper', () => {
    centerColumn('2021-01-04');
    // jsdom reports 0 for every layout metric, so this mostly proves it doesn't throw and
    // reads the right cell — the real centering math is browser-verified (E5).
    expect(document.getElementById('gridWrap')!.scrollLeft).toBe(0);
  });

  it('centerColumn is a no-op for a date with no rendered cell', () => {
    expect(() => centerColumn('1999-01-01')).not.toThrow();
  });

  it('centerToday defers to centerColumn on the next frame', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    expect(() => centerToday()).not.toThrow();
  });

  it('gotoDate scrolls (on the next frame) without throwing', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    expect(() => gotoDate('2021-01-04')).not.toThrow();
  });
});

describe('syncJumpControls', () => {
  it('sets the month/year controls from the week-block currently at the grid start', () => {
    window.S.startMonday = new Date('2021-01-25T00:00:00Z'); // Monday; +3 days = Thursday Jan 28
    syncJumpControls();
    expect((document.getElementById('jumpMonth') as HTMLSelectElement).value).toBe('0'); // January
    expect((document.getElementById('jumpYear') as HTMLInputElement).value).toBe('21');
  });
});

describe('the month/year jump controls (change event)', () => {
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
    expect(window.notify).toHaveBeenCalled();
  });

  it('treats a four-digit year as-is rather than as a two-digit offset from 2000', () => {
    (document.getElementById('jumpMonth') as HTMLSelectElement).value = '0';
    (document.getElementById('jumpYear') as HTMLInputElement).value = '1999';
    document.getElementById('jumpYear')!.dispatchEvent(new Event('change'));
    // Jan 1 1999 was a Friday, so the Monday of its week falls in the preceding year —
    // proves 1999 was read as a real four-digit year, not "20" + "99" or similar.
    expect(window.S.startMonday.getUTCFullYear()).toBe(1998);
    expect(window.S.startMonday.getUTCMonth()).toBe(11); // December
  });

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
  it('Heute resets the view and jumps to the current week', () => {
    document.getElementById('btnToday')!.click();
    expect(window.S.extraWeeks).toBe(1); // resetView() zeroes it, then prependWeek() grows it back
    expect(window.notify).toHaveBeenCalled();
  });

  it('◀ moves startMonday back a week', () => {
    document.getElementById('btnPrev')!.click();
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2020-12-28');
    expect(window.notify).toHaveBeenCalledOnce();
  });

  it('▶ moves startMonday forward a week', () => {
    document.getElementById('btnNext')!.click();
    expect(window.S.startMonday.toISOString().slice(0, 10)).toBe('2021-01-11');
    expect(window.notify).toHaveBeenCalledOnce();
  });
});

describe('resetView', () => {
  it('zeroes extraWeeks and scrolls back to the start', () => {
    window.S.extraWeeks = 5;
    document.getElementById('gridWrap')!.scrollLeft = 200;
    resetView();
    expect(window.S.extraWeeks).toBe(0);
    expect(document.getElementById('gridWrap')!.scrollLeft).toBe(0);
  });
});
