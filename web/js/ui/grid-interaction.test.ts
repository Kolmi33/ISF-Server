// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import type { AppState } from '../../../shared/types.ts';
import { store } from '../store-instance.ts';
import {
  initGridInteraction,
  paintSelection,
  clearSelection,
  selection,
  type GridInteractionHandlers,
} from './grid-interaction.ts';
import { registerGridRenderTrigger } from './grid-render-bridge.ts';

// `initGridInteraction` now takes its higher-level actions as an injected
// `GridInteractionHandlers` struct (F8 cleanup, ARCHITECTURE_AUDIT.md) rather than reaching
// for `window.*` — built once here (module scope, matching the real one-time-at-boot call in
// `beforeAll` below) and cleared between tests rather than reassigned, since the reference
// itself is captured once by `initGridInteraction`.
const handlers: GridInteractionHandlers = {
  showCtx: vi.fn(),
  hideCtx: vi.fn(),
  toggleFav: vi.fn(),
  gotoPrevFree: vi.fn(),
  gotoNextFree: vi.fn(),
  openCellAction: vi.fn(),
  prependWeek: vi.fn(),
};

// Simulates the mounted Grid component's render-trigger registration (`Grid.tsx`'s own mount
// effect, normally) — same one-time-registration shape as `handlers` above.
const renderTrigger = vi.fn();

/** Minimal grid markup: two machine rows × two dates, plus the group/category header rows
 *  and the `#gridWrap` scroll container the drag-auto-scroll code measures. Faithful to the
 *  exact classes/attributes `Grid.tsx`/`GridBody.tsx` render (B1). */
function buildGridDom(): void {
  document.body.innerHTML = `
    <div id="gridWrap">
      <table id="grid">
        <tbody>
          <tr class="grouprow catrow" data-catgroup="maschine"><td>Maschinen</td></tr>
          <tr class="grouprow" data-group="Halle 1"><td>Halle 1</td></tr>
          <tr>
            <td class="machcol"><span class="favstar" data-fav="m1"></span></td>
            <td class="cell free" data-machine-id="m1" data-date="2021-01-04"></td>
            <td class="cell free" data-machine-id="m1" data-date="2021-01-05"></td>
          </tr>
          <tr>
            <td class="machcol">
              <span class="nextfree back" data-nb="m2"></span>
              <span class="nextfree" data-nf="m2"></span>
            </td>
            <td class="cell free" data-machine-id="m2" data-date="2021-01-04"></td>
            <td class="cell free" data-machine-id="m2" data-date="2021-01-05"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div id="overlay"></div>`;
}

function stubWindowGlobals(): void {
  // grid-interaction.ts now reads state via the real `store` singleton, not window.S
  // directly — store.set merges these onto that same shared object, and window.S is kept
  // aliased to it (as app.ts does in production) so every existing window.S.* assertion
  // below keeps working unchanged.
  store.set({
    visM: ['m1', 'm2'],
    visD: ['2021-01-04', '2021-01-05'],
    collapsed: new Set(),
    cats: new Set(['maschine', 'messtechnik']),
    data: { machines: [], bookings: {} },
    extraWeeks: 0,
  } as unknown as Partial<AppState>);
  window.S = store.state;
  window.notify = vi.fn();
}

function cell(machineId: string, date: string): HTMLElement {
  return document.querySelector(`td.cell[data-machine-id="${machineId}"][data-date="${date}"]`)!;
}

function mousedownOn(el: Element, options: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...options }));
}

function mouseoverOn(el: Element): void {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

function mouseupOn(el: Element, options: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, ...options }));
}

function clickOn(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function dblclickOn(el: Element): void {
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}

function keydown(key: string, options: KeyboardEventInit = {}): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }),
  );
}

// The grid DOM and its event listeners are built exactly once, matching `initGridInteraction`'s
// real one-time-at-boot contract (its `document`-level listeners would otherwise accumulate
// across tests if a fresh `#grid` were rebuilt — and re-listened-to — per test). Each test only
// resets the mutable bits: `selection` state, `window.S`/mocks, scroll position, and localStorage.
beforeAll(() => {
  // jsdom doesn't implement these two DOM APIs at all — stub them once, globally, rather than
  // per-test. `scrollIntoView` is called unconditionally by keyboard nav; `elementFromPoint`
  // only matters to the drag-auto-scroll tests, which override this default via `vi.spyOn`.
  Element.prototype.scrollIntoView = vi.fn();
  document.elementFromPoint = vi.fn().mockReturnValue(null);
  buildGridDom();
  initGridInteraction(handlers);
  registerGridRenderTrigger(renderTrigger);
});

beforeEach(() => {
  stubWindowGlobals();
  localStorage.clear();
  document.getElementById('gridWrap')!.scrollLeft = 0;
  document.getElementById('gridWrap')!.scrollTop = 0;
  document.getElementById('overlay')!.classList.remove('open');
  clearSelection(); // also repaints, clearing any leftover .sel/.kfocus from the previous test
  vi.clearAllMocks();
});

describe('paintSelection / clearSelection', () => {
  it('paints the anchor↔focus rectangle and gives the focus cell a roving tabindex', () => {
    selection.anchor = { machineId: 'm1', date: '2021-01-04' };
    selection.focus = { machineId: 'm2', date: '2021-01-05' };
    paintSelection();
    expect(cell('m1', '2021-01-04').className).toContain('sel');
    expect(cell('m1', '2021-01-05').className).toContain('sel');
    expect(cell('m2', '2021-01-04').className).toContain('sel');
    expect(cell('m2', '2021-01-05')).toHaveClass('sel', 'kfocus');
    expect(cell('m2', '2021-01-05').getAttribute('aria-selected')).toBe('true');
    expect(cell('m2', '2021-01-05').getAttribute('tabindex')).toBe('0');
  });

  it('clears previous marks before repainting a smaller selection', () => {
    selection.anchor = { machineId: 'm1', date: '2021-01-04' };
    selection.focus = { machineId: 'm2', date: '2021-01-05' };
    paintSelection();
    selection.anchor = selection.focus = { machineId: 'm1', date: '2021-01-04' };
    paintSelection();
    expect(cell('m2', '2021-01-05').className).not.toContain('sel');
    expect(cell('m2', '2021-01-05').getAttribute('aria-selected')).toBeNull();
  });

  it('clearSelection resets the selection and hides the context menu', () => {
    selection.anchor = { machineId: 'm1', date: '2021-01-04' };
    selection.focus = { machineId: 'm1', date: '2021-01-04' };
    paintSelection();
    clearSelection();
    expect(selection.anchor).toBeNull();
    expect(selection.cells).toEqual([]);
    expect(cell('m1', '2021-01-04').className).not.toContain('sel');
    expect(handlers.hideCtx).toHaveBeenCalledOnce();
  });
});

describe('drag-to-select', () => {
  it('mousedown on a cell starts a new single-cell selection', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.dragging).toBe(true);
    expect(selection.didDrag).toBe(false);
    expect(cell('m1', '2021-01-04')).toHaveClass('sel');
  });

  it('ignores a non-primary mouse button', () => {
    mousedownOn(cell('m1', '2021-01-04'), { button: 2 });
    expect(selection.anchor).toBeNull();
  });

  it('mouseover during a drag extends the focus to the hovered cell', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseoverOn(cell('m2', '2021-01-05'));
    expect(selection.focus).toEqual({ machineId: 'm2', date: '2021-01-05' });
    expect(selection.didDrag).toBe(true);
    expect(selection.cells).toHaveLength(4); // the full m1..m2 × both-dates rectangle
  });

  it('mouseover before any mousedown is a no-op (no focus to extend)', () => {
    mouseoverOn(cell('m2', '2021-01-05'));
    expect(selection.focus).toBeNull();
  });

  it('shift+mousedown with an existing anchor spans a rectangle instead of starting fresh', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseupOn(document.body);
    mousedownOn(cell('m2', '2021-01-05'), { shiftKey: true });
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' }); // unchanged
    expect(selection.focus).toEqual({ machineId: 'm2', date: '2021-01-05' });
    expect(selection.didDrag).toBe(true);
  });

  it('mouseup ends the drag and opens the context menu only for a real multi-cell drag', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseoverOn(cell('m2', '2021-01-05'));
    mouseupOn(document.body, { clientX: 10, clientY: 20 });
    expect(selection.dragging).toBe(false);
    expect(handlers.showCtx).toHaveBeenCalledWith(10, 20);
  });

  it('mouseup after a plain click (no drag movement) does not open the context menu', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseupOn(document.body);
    expect(handlers.showCtx).not.toHaveBeenCalled();
  });

  it('mouseup while not dragging is a no-op', () => {
    mouseupOn(document.body);
    expect(handlers.showCtx).not.toHaveBeenCalled();
  });
});

describe('click handling', () => {
  it('clicking a favorite star toggles that machine as a favorite', () => {
    clickOn(document.querySelector('.favstar[data-fav="m1"]')!);
    expect(handlers.toggleFav).toHaveBeenCalledWith('m1');
  });

  it('clicking the "jump back" button goes to the previous free day', () => {
    clickOn(document.querySelector('[data-nb="m2"]')!);
    expect(handlers.gotoPrevFree).toHaveBeenCalledWith('m2');
  });

  it('clicking the "jump to next free" button goes to the next free day', () => {
    clickOn(document.querySelector('[data-nf="m2"]')!);
    expect(handlers.gotoNextFree).toHaveBeenCalledWith('m2');
  });

  it('clicking a category header row toggles that category (debounced)', () => {
    vi.useFakeTimers();
    clickOn(document.querySelector('tr[data-catgroup="maschine"] td')!);
    expect(window.S.cats.has('maschine')).toBe(true); // not yet — debounced
    vi.advanceTimersByTime(220);
    expect(window.S.cats.has('maschine')).toBe(false);
    vi.useRealTimers();
  });

  it('clicking a group header row toggles and persists its collapsed state', () => {
    const notifySpy = vi.spyOn(store, 'notify');
    clickOn(document.querySelector('tr[data-group="Halle 1"] td')!);
    expect(window.S.collapsed.has('Halle 1')).toBe(true);
    expect(JSON.parse(localStorage.getItem('mb_collapsed')!)).toEqual(['Halle 1']);
    expect(notifySpy).toHaveBeenCalledOnce();

    clickOn(document.querySelector('tr[data-group="Halle 1"] td')!);
    expect(window.S.collapsed.has('Halle 1')).toBe(false);
    notifySpy.mockRestore();
  });

  it('a plain click that ends a drag just clears didDrag, without any other action', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseoverOn(cell('m2', '2021-01-05'));
    clickOn(cell('m2', '2021-01-05'));
    expect(selection.didDrag).toBe(false);
    expect(handlers.openCellAction).not.toHaveBeenCalled();
  });

  it('a plain click that was not a drag does nothing (selection already happened on mousedown)', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    clickOn(cell('m1', '2021-01-04'));
    expect(handlers.openCellAction).not.toHaveBeenCalled();
  });
});

describe('double-click handling', () => {
  it('double-clicking a category header cancels the pending single-click toggle and expands every group in that category', () => {
    vi.useFakeTimers();
    window.S.collapsed = new Set(); // nothing collapsed → toggleAllGroupsInCategory collapses everything
    window.S.data!.machines = [{ id: 'm1', name: 'M1', group: 'Halle 1' }];
    clickOn(document.querySelector('tr[data-catgroup="maschine"] td')!); // would toggle "maschine" off in 220ms
    dblclickOn(document.querySelector('tr[data-catgroup="maschine"] td')!);
    vi.advanceTimersByTime(300);
    expect(window.S.cats.has('maschine')).toBe(true); // the pending single-click toggle never fired
    expect(window.S.collapsed.has('Halle 1')).toBe(true); // its one group got collapsed
    vi.useRealTimers();
  });

  it('double-clicking a cell opens its booking action', () => {
    dblclickOn(cell('m1', '2021-01-04'));
    expect(handlers.openCellAction).toHaveBeenCalledWith('m1', '2021-01-04');
  });
});

describe('keyboard navigation', () => {
  it('the first arrow press (nothing focused yet) focuses the first visible cell without moving', () => {
    keydown('ArrowRight');
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' });
  });

  it('ArrowRight/ArrowDown move focus by one column/row and reset the anchor to match', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('ArrowRight');
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-05' });
    expect(selection.anchor).toEqual(selection.focus);
    keydown('ArrowDown');
    expect(selection.focus).toEqual({ machineId: 'm2', date: '2021-01-05' });
  });

  it('Shift+Arrow extends the selection without moving the anchor', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('ArrowRight', { shiftKey: true });
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-05' });
    expect(selection.cells).toHaveLength(2);
  });

  it('clamps at the top/left edge instead of moving past it', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('ArrowLeft');
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' }); // clamped, unchanged
    keydown('ArrowUp');
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' });
  });

  it('moving past the right edge grows the grid directly via extraWeeks + render()', () => {
    mousedownOn(cell('m2', '2021-01-05')); // last column
    keydown('ArrowRight');
    expect(window.S.extraWeeks).toBe(1);
    expect(renderTrigger).toHaveBeenCalledOnce();
  });

  it('moving past the left edge calls prependWeek() to grow backwards', () => {
    // handlers.prependWeek is a no-op stub here, so the column index stays -1 and clamps to 0 —
    // this test only proves the call happens, not the resulting column (that needs a real
    // prependWeek that actually unshifts S.visD, which is still legacy / out of B2's scope).
    mousedownOn(cell('m1', '2021-01-04')); // first column
    keydown('ArrowLeft');
    expect(handlers.prependWeek).toHaveBeenCalledOnce();
  });

  it('does nothing when the grid has no visible rows/columns yet', () => {
    window.S.visM = [];
    window.S.visD = [];
    keydown('ArrowRight');
    expect(selection.focus).toBeNull();
  });

  it("Enter on a single-cell selection opens that cell's booking action", () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('Enter');
    expect(handlers.openCellAction).toHaveBeenCalledWith('m1', '2021-01-04');
  });

  it('Enter on a multi-cell selection opens the context menu instead', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseoverOn(cell('m2', '2021-01-05'));
    mouseupOn(document.body);
    keydown('Enter');
    expect(handlers.showCtx).toHaveBeenCalled();
    expect(handlers.openCellAction).not.toHaveBeenCalled();
  });

  it('Enter with nothing focused does nothing', () => {
    keydown('Enter');
    expect(handlers.openCellAction).not.toHaveBeenCalled();
    expect(handlers.showCtx).not.toHaveBeenCalled();
  });

  it('Escape clears the selection', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('Escape');
    expect(selection.anchor).toBeNull();
  });

  it('is suppressed while a modal is open', () => {
    document.getElementById('overlay')!.classList.add('open');
    keydown('ArrowRight');
    expect(selection.focus).toBeNull();
  });

  it('is suppressed while typing into a form field', () => {
    const input = document.createElement('input');
    document.body.appendChild(input); // must be attached for the keydown to bubble to document
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(selection.focus).toBeNull();
    input.remove(); // the grid DOM built in beforeAll is shared across every test in this file
  });

  it('ignores keys that are not arrows/Enter/Escape', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('a');
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' }); // unchanged
  });
});

describe('drag auto-scroll at the grid edges', () => {
  function stubGridWrapGeometry(overrides: Partial<DOMRect> = {}): void {
    const rect = {
      left: 100,
      right: 500,
      top: 50,
      bottom: 400,
      width: 400,
      height: 350,
      x: 100,
      y: 50,
      toJSON() {},
      ...overrides,
    } as DOMRect;
    document.getElementById('gridWrap')!.getBoundingClientRect = () => rect;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    stubGridWrapGeometry();
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(cell('m2', '2021-01-05'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scrolls right and re-extends the focus when dragging near the right edge', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 490, clientY: 200 }));
    vi.advanceTimersByTime(60);
    expect(document.getElementById('gridWrap')!.scrollLeft).toBeGreaterThan(0);
    expect(selection.focus).toEqual({ machineId: 'm2', date: '2021-01-05' });
  });

  it('scrolls left, or grows a week when already at the start, near the left edge', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 200 }));
    vi.advanceTimersByTime(60);
    expect(handlers.prependWeek).toHaveBeenCalled(); // scrollLeft starts at 0 in jsdom

    document.getElementById('gridWrap')!.scrollLeft = 50;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 200 }));
    vi.advanceTimersByTime(60);
    expect(document.getElementById('gridWrap')!.scrollLeft).toBeLessThan(50);
  });

  it('scrolls down near the bottom edge and up near the top edge (once already scrolled)', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 390 }));
    vi.advanceTimersByTime(60);
    expect(document.getElementById('gridWrap')!.scrollTop).toBeGreaterThan(0);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 55 }));
    vi.advanceTimersByTime(60);
    expect(document.getElementById('gridWrap')!.scrollTop).toBeLessThan(24);
  });

  it('stops auto-scrolling once the drag ends', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 490, clientY: 200 }));
    mouseupOn(document.body);
    const scrollLeftAtMouseup = document.getElementById('gridWrap')!.scrollLeft;
    vi.advanceTimersByTime(300);
    expect(document.getElementById('gridWrap')!.scrollLeft).toBe(scrollLeftAtMouseup);
  });

  it('does nothing mid-air when not dragging or the grid wrapper is missing', () => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 490, clientY: 200 }));
    vi.advanceTimersByTime(60);
    expect(document.getElementById('gridWrap')!.scrollLeft).toBe(0); // never started dragging
  });
});
