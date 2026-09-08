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
  // What: painting a selection marks every cell in the anchor↔focus rectangle with the
  // selected class, and additionally gives the FOCUS cell (only) the roving tabindex/aria
  // treatment that makes it the one real keyboard-focus target in the whole grid.
  // How: sets a 2×2 rectangle's opposite corners as anchor/focus, paints, and checks all four
  // cells got the sel class while only the focus cell got kfocus/aria-selected/tabindex=0.
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

  it('does not query or rewrite unchanged selected cells on a repeated paint', () => {
    selection.anchor = { machineId: 'm1', date: '2021-01-04' };
    selection.focus = { machineId: 'm2', date: '2021-01-05' };
    paintSelection();
    const querySelector = vi.spyOn(document, 'querySelector');

    paintSelection();

    expect(querySelector).not.toHaveBeenCalled();
    querySelector.mockRestore();
  });

  // What: repainting a smaller selection actually clears the marks on cells no longer
  // included — a stale .sel class from the previous, larger selection doesn't linger.
  // How: paints a 2×2 rectangle, then shrinks the selection to a single cell and repaints,
  // checking a cell outside the new selection lost both its class and aria attribute.
  it('clears previous marks before repainting a smaller selection', () => {
    selection.anchor = { machineId: 'm1', date: '2021-01-04' };
    selection.focus = { machineId: 'm2', date: '2021-01-05' };
    paintSelection();
    selection.anchor = selection.focus = { machineId: 'm1', date: '2021-01-04' };
    paintSelection();
    expect(cell('m2', '2021-01-05').className).not.toContain('sel');
    expect(cell('m2', '2021-01-05').getAttribute('aria-selected')).toBeNull();
  });

  // What: clearSelection resets both the selection state and the painted classes, and also
  // hides any open context menu (a selection and its context menu are always dismissed together).
  // How: paints a single-cell selection, clears it, and checks the selection state reset, the
  // cell's class is clean, and the hideCtx handler was called.
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
  // What: a mousedown on a cell (with no modifier) starts a brand-new single-cell selection —
  // anchor and focus both land on that cell, a drag begins, but no actual drag movement has
  // happened yet.
  // How: fires a plain mousedown on one cell and checks the selection state and that the cell
  // got the sel class.
  it('mousedown on a cell starts a new single-cell selection', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.dragging).toBe(true);
    expect(selection.didDrag).toBe(false);
    expect(cell('m1', '2021-01-04')).toHaveClass('sel');
  });

  // What: only the primary (left) mouse button starts a selection — a right-click, say,
  // doesn't accidentally begin dragging.
  // How: fires a mousedown with button:2 (right) and checks no selection started.
  it('ignores a non-primary mouse button', () => {
    mousedownOn(cell('m1', '2021-01-04'), { button: 2 });
    expect(selection.anchor).toBeNull();
  });

  // What: while actively dragging (mouse button down, moving over cells), each mouseover
  // extends the focus corner to the newly-hovered cell, growing the selected rectangle, and
  // marks the drag as a real drag (didDrag) rather than a plain click.
  // How: mousedowns on one corner, mouseovers the opposite corner, and checks the focus
  // updated, didDrag flipped true, and the selection covers the full 2×2 rectangle.
  it('mouseover during a drag extends the focus to the hovered cell', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseoverOn(cell('m2', '2021-01-05'));
    expect(selection.focus).toEqual({ machineId: 'm2', date: '2021-01-05' });
    expect(selection.didDrag).toBe(true);
    expect(selection.cells).toHaveLength(4); // the full m1..m2 × both-dates rectangle
  });

  // What: a mouseover with no drag currently active (no mousedown happened first) does
  // nothing — there's no active selection to extend.
  // How: fires a mouseover with no prior mousedown and checks the focus stayed null.
  it('mouseover before any mousedown is a no-op (no focus to extend)', () => {
    mouseoverOn(cell('m2', '2021-01-05'));
    expect(selection.focus).toBeNull();
  });

  // What: shift+mousedown behaves like a keyboard shift+arrow — it extends the EXISTING
  // anchor to the newly-clicked cell (spanning a rectangle) rather than starting a fresh
  // single-cell selection the way a plain mousedown would.
  // How: makes a normal single-cell selection first, then shift+mousedowns a distant cell,
  // and checks the original anchor is preserved while focus moved and didDrag is true.
  it('shift+mousedown with an existing anchor spans a rectangle instead of starting fresh', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseupOn(document.body);
    mousedownOn(cell('m2', '2021-01-05'), { shiftKey: true });
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' }); // unchanged
    expect(selection.focus).toEqual({ machineId: 'm2', date: '2021-01-05' });
    expect(selection.didDrag).toBe(true);
  });

  // What: releasing the mouse ends the drag state, and if the drag actually moved across
  // multiple cells (a real selection, not just a click), it opens the context menu at the
  // release point.
  // How: drags across two cells, releases at a specific screen position, and checks the drag
  // ended and showCtx was called with that exact position.
  it('mouseup ends the drag and opens the context menu only for a real multi-cell drag', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseoverOn(cell('m2', '2021-01-05'));
    mouseupOn(document.body, { clientX: 10, clientY: 20 });
    expect(selection.dragging).toBe(false);
    expect(handlers.showCtx).toHaveBeenCalledWith(10, 20);
  });

  // What: a plain click (mousedown then mouseup with no mouseover between) never opens the
  // context menu — only an actual drag does.
  // How: mousedowns and immediately mouseups with no movement in between, checking showCtx
  // was never called.
  it('mouseup after a plain click (no drag movement) does not open the context menu', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseupOn(document.body);
    expect(handlers.showCtx).not.toHaveBeenCalled();
  });

  // What: a mouseup with no drag ever having started is a safe no-op.
  // How: fires mouseup directly with no prior mousedown and checks showCtx was never called.
  it('mouseup while not dragging is a no-op', () => {
    mouseupOn(document.body);
    expect(handlers.showCtx).not.toHaveBeenCalled();
  });
});

describe('click handling', () => {
  // What: clicking a row's favorite star delegates to the toggleFav handler for that machine.
  // How: clicks the star element carrying data-fav="m1" and checks the handler was called
  // with that machine id.
  it('clicking a favorite star toggles that machine as a favorite', () => {
    clickOn(document.querySelector('.favstar[data-fav="m1"]')!);
    expect(handlers.toggleFav).toHaveBeenCalledWith('m1');
  });

  // What: clicking a row's "jump back" (previous free day) icon delegates to gotoPrevFree.
  // How: clicks the element carrying data-nb="m2" and checks the handler was called with
  // that machine id.
  it('clicking the "jump back" button goes to the previous free day', () => {
    clickOn(document.querySelector('[data-nb="m2"]')!);
    expect(handlers.gotoPrevFree).toHaveBeenCalledWith('m2');
  });

  // What: clicking a row's "jump to next free" icon delegates to gotoNextFree.
  // How: clicks the element carrying data-nf="m2" and checks the handler was called with
  // that machine id.
  it('clicking the "jump to next free" button goes to the next free day', () => {
    clickOn(document.querySelector('[data-nf="m2"]')!);
    expect(handlers.gotoNextFree).toHaveBeenCalledWith('m2');
  });

  // What: clicking a category header row toggles that category's visibility, debounced (so a
  // double-click can be distinguished and handled differently — see the double-click tests below).
  // How: clicks the category header, checks it's still shown right away (debounced, not yet
  // applied), advances past the debounce window, and checks it's now hidden.
  it('clicking a category header row toggles that category (debounced)', () => {
    vi.useFakeTimers();
    clickOn(document.querySelector('tr[data-catgroup="maschine"] td')!);
    expect(window.S.cats.has('maschine')).toBe(true); // not yet — debounced
    vi.advanceTimersByTime(220);
    expect(window.S.cats.has('maschine')).toBe(false);
    vi.useRealTimers();
  });

  // What: clicking a group header row toggles its fold state (not debounced, unlike
  // category), persists the change to localStorage, and repaints — and clicking again toggles
  // it back.
  // How: clicks the group header, checks it collapsed and persisted with one notify, then
  // clicks again and checks it re-expanded.
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

  // What: the click event that follows a real drag (mousedown → mouseover → click) doesn't
  // trigger a cell-open action — the drag itself already did the selecting, so the trailing
  // click just resets the didDrag flag and otherwise does nothing.
  // How: performs a real drag (down, over a different cell) then fires click on the ending
  // cell, checking didDrag reset to false and openCellAction was never called.
  it('a plain click that ends a drag just clears didDrag, without any other action', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseoverOn(cell('m2', '2021-01-05'));
    clickOn(cell('m2', '2021-01-05'));
    expect(selection.didDrag).toBe(false);
    expect(handlers.openCellAction).not.toHaveBeenCalled();
  });

  // What: a genuine plain click (mousedown then click, no drag at all) doesn't open the
  // cell's booking action either — a single click only selects (already done on mousedown);
  // opening the booking action requires a double-click or Enter instead.
  // How: mousedowns and clicks the same cell with no movement between, and checks
  // openCellAction was never called.
  it('a plain click that was not a drag does nothing (selection already happened on mousedown)', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    clickOn(cell('m1', '2021-01-04'));
    expect(handlers.openCellAction).not.toHaveBeenCalled();
  });
});

describe('double-click handling', () => {
  // What: a double-click on a category header is a genuinely distinct gesture from two
  // separate single clicks — it CANCELS the debounced single-click toggle (which would
  // otherwise still fire and hide the category) and instead runs toggleAllGroupsInCategory
  // on that category (here, starting from all-open, so it collapses every group in it).
  // How: clicks then immediately double-clicks the same category header, advances well past
  // the single-click debounce window, and checks the category is still shown (the pending
  // toggle never fired) while its one group is now collapsed (the double-click's own action ran).
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

  // What: double-clicking a grid cell (not a header) opens its booking action directly.
  // How: double-clicks a cell and checks openCellAction was called with its machine/date.
  it('double-clicking a cell opens its booking action', () => {
    dblclickOn(cell('m1', '2021-01-04'));
    expect(handlers.openCellAction).toHaveBeenCalledWith('m1', '2021-01-04');
  });
});

describe('keyboard navigation', () => {
  // What: an arrow key with no prior selection just establishes focus on the first visible
  // cell — it doesn't also apply the arrow's own movement on top of that first placement.
  // How: presses ArrowRight with nothing selected and checks focus/anchor both land on the
  // grid's first cell (not the second, which a "move right" would have produced).
  it('the first arrow press (nothing focused yet) focuses the first visible cell without moving', () => {
    keydown('ArrowRight');
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' });
  });

  // What: with an existing selection, plain (non-shift) arrow keys move BOTH the focus and
  // the anchor together by one column/row — a plain arrow press moves the whole selection,
  // it doesn't grow it.
  // How: selects one cell, presses ArrowRight (checks focus moved and anchor matches focus
  // again — not left behind), then ArrowDown (checks focus moved down a row too).
  it('ArrowRight/ArrowDown move focus by one column/row and reset the anchor to match', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('ArrowRight');
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-05' });
    expect(selection.anchor).toEqual(selection.focus);
    keydown('ArrowDown');
    expect(selection.focus).toEqual({ machineId: 'm2', date: '2021-01-05' });
  });

  // What: holding Shift while pressing an arrow key extends the selection (grows the
  // rectangle) instead of moving it — the anchor stays put, only the focus corner moves.
  // How: selects one cell, presses Shift+ArrowRight, and checks the anchor is unchanged, the
  // focus moved right, and the selection now covers 2 cells.
  it('Shift+Arrow extends the selection without moving the anchor', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('ArrowRight', { shiftKey: true });
    expect(selection.anchor).toEqual({ machineId: 'm1', date: '2021-01-04' });
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-05' });
    expect(selection.cells).toHaveLength(2);
  });

  // What: pressing an arrow that would move focus past the grid's top or left edge clamps in
  // place rather than wrapping or going out of bounds.
  // How: selects the grid's very first cell, presses ArrowLeft then ArrowUp, and checks focus
  // stays on that same first cell both times.
  it('clamps at the top/left edge instead of moving past it', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('ArrowLeft');
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' }); // clamped, unchanged
    keydown('ArrowUp');
    expect(selection.focus).toEqual({ machineId: 'm1', date: '2021-01-04' });
  });

  // What: unlike the top/left edges (which clamp), moving right past the grid's LAST visible
  // column grows the week window directly (a synchronous render, not the debounced notify
  // path) so the keyboard nav can keep moving forward onto the newly-revealed column.
  // How: selects the grid's last column, presses ArrowRight, and checks extraWeeks grew and
  // the render trigger fired.
  it('moving past the right edge grows the grid directly via extraWeeks + render()', () => {
    mousedownOn(cell('m2', '2021-01-05')); // last column
    keydown('ArrowRight');
    expect(window.S.extraWeeks).toBe(1);
    expect(renderTrigger).toHaveBeenCalledOnce();
  });

  // What: moving left past the grid's FIRST visible column calls the injected prependWeek
  // handler to grow the window backwards, the keyboard-nav counterpart of the right-edge growth.
  // How: selects the grid's first column, presses ArrowLeft, and checks the prependWeek
  // handler was called. Only the call itself is checked here, not the resulting column,
  // because the injected handler is a no-op stub in this fixture — the real handler
  // (grid-scroll.ts's prependWeek) unshifts S.visD, which this component-level test isn't
  // wired to observe.
  it('moving past the left edge calls prependWeek() to grow backwards', () => {
    mousedownOn(cell('m1', '2021-01-04')); // first column
    keydown('ArrowLeft');
    expect(handlers.prependWeek).toHaveBeenCalledOnce();
  });

  // What: before any data has loaded (no visible machines or dates), arrow key navigation is
  // a safe no-op rather than erroring on an empty grid.
  // How: empties the visible machine/date lists, presses ArrowRight, and checks focus stays null.
  it('does nothing when the grid has no visible rows/columns yet', () => {
    window.S.visM = [];
    window.S.visD = [];
    keydown('ArrowRight');
    expect(selection.focus).toBeNull();
  });

  // What: pressing Enter with a single cell selected opens that cell's booking action —
  // the keyboard equivalent of double-clicking it.
  // How: selects one cell, presses Enter, and checks openCellAction was called with it.
  it("Enter on a single-cell selection opens that cell's booking action", () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('Enter');
    expect(handlers.openCellAction).toHaveBeenCalledWith('m1', '2021-01-04');
  });

  // What: with more than one cell selected, Enter opens the context menu instead of a single
  // cell's booking action — there's no single obvious cell to act on directly.
  // How: drags to select two cells, presses Enter, and checks showCtx fired while
  // openCellAction did not.
  it('Enter on a multi-cell selection opens the context menu instead', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    mouseoverOn(cell('m2', '2021-01-05'));
    mouseupOn(document.body);
    keydown('Enter');
    expect(handlers.showCtx).toHaveBeenCalled();
    expect(handlers.openCellAction).not.toHaveBeenCalled();
  });

  // What: pressing Enter with no active selection at all does nothing.
  // How: presses Enter with nothing selected and checks neither action handler fired.
  it('Enter with nothing focused does nothing', () => {
    keydown('Enter');
    expect(handlers.openCellAction).not.toHaveBeenCalled();
    expect(handlers.showCtx).not.toHaveBeenCalled();
  });

  // What: Escape clears the current selection.
  // How: selects a cell, presses Escape, and checks the anchor reset to null.
  it('Escape clears the selection', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    keydown('Escape');
    expect(selection.anchor).toBeNull();
  });

  // What: grid keyboard navigation is suppressed while a modal overlay is open — arrow keys
  // shouldn't move the grid selection behind an open dialog.
  // How: marks the overlay as open, presses ArrowRight, and checks focus stayed null.
  it('is suppressed while a modal is open', () => {
    document.getElementById('overlay')!.classList.add('open');
    keydown('ArrowRight');
    expect(selection.focus).toBeNull();
  });

  // What: grid keyboard navigation is also suppressed while the keydown originates from a
  // form input — otherwise typing in a text field elsewhere on the page would hijack the grid
  // selection with every arrow key press.
  // How: attaches a real input element, fires the keydown FROM that input (so it bubbles from
  // there, not from the grid), and checks focus stayed null.
  it('is suppressed while typing into a form field', () => {
    const input = document.createElement('input');
    document.body.appendChild(input); // must be attached for the keydown to bubble to document
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(selection.focus).toBeNull();
    input.remove(); // the grid DOM built in beforeAll is shared across every test in this file
  });

  // What: any key outside the recognized set (arrows, Enter, Escape) is simply ignored,
  // leaving the current selection untouched.
  // How: selects a cell, presses an unrelated key ('a'), and checks focus is unchanged.
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

  // What: dragging a selection with the mouse near the grid wrapper's right edge
  // auto-scrolls the viewport right, and once it scrolls, re-evaluates which cell is now
  // under the (stationary) mouse position and extends the selection focus to it.
  // How: starts a drag, moves the mouse near the right edge (stubbed elementFromPoint returns
  // a specific far cell), advances the auto-scroll's interval timer, and checks both that
  // scrollLeft increased and the focus extended to the cell now under the mouse.
  it('scrolls right and re-extends the focus when dragging near the right edge', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 490, clientY: 200 }));
    vi.advanceTimersByTime(60);
    expect(document.getElementById('gridWrap')!.scrollLeft).toBeGreaterThan(0);
    expect(selection.focus).toEqual({ machineId: 'm2', date: '2021-01-05' });
  });

  // What: dragging near the left edge scrolls left when there's room to scroll, or — if
  // already scrolled all the way to the start — grows a week backward instead (mirroring the
  // wheel-listener's left-edge behavior), so a drag never gets stuck unable to reach earlier days.
  // How: drags near the left edge while at scrollLeft 0 and checks prependWeek was called;
  // then repeats with a nonzero scrollLeft and checks it actually decreased instead.
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

  // What: the same auto-scroll behavior applies vertically too — near the bottom edge scrolls
  // down, and (once there's scroll room to give back) near the top edge scrolls back up.
  // How: drags near the bottom edge and checks scrollTop increased; then drags near the top
  // edge and checks scrollTop decreased back down.
  it('scrolls down near the bottom edge and up near the top edge (once already scrolled)', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 390 }));
    vi.advanceTimersByTime(60);
    expect(document.getElementById('gridWrap')!.scrollTop).toBeGreaterThan(0);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 55 }));
    vi.advanceTimersByTime(60);
    expect(document.getElementById('gridWrap')!.scrollTop).toBeLessThan(24);
  });

  // What: releasing the mouse (ending the drag) stops the auto-scroll interval — it doesn't
  // keep scrolling on its own after the drag is over.
  // How: starts a drag near the right edge, releases the mouse, records the scroll position
  // at that moment, advances time well past another auto-scroll tick, and checks the position
  // never moved further.
  it('stops auto-scrolling once the drag ends', () => {
    mousedownOn(cell('m1', '2021-01-04'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 490, clientY: 200 }));
    mouseupOn(document.body);
    const scrollLeftAtMouseup = document.getElementById('gridWrap')!.scrollLeft;
    vi.advanceTimersByTime(300);
    expect(document.getElementById('gridWrap')!.scrollLeft).toBe(scrollLeftAtMouseup);
  });

  // What: a mousemove near the edge with no drag actually in progress doesn't trigger any
  // auto-scroll — the edge-proximity logic only matters while dragging.
  // How: fires a mousemove near the right edge with no prior mousedown, advances time, and
  // checks scrollLeft never moved from its starting 0.
  it('does nothing mid-air when not dragging or the grid wrapper is missing', () => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 490, clientY: 200 }));
    vi.advanceTimersByTime(60);
    expect(document.getElementById('gridWrap')!.scrollLeft).toBe(0); // never started dragging
  });
});

describe('GridInteractionHandlers — before initGridInteraction()', () => {
  // What: pins a deliberate design decision — every call site that invokes an injected
  // handler (clearSelection's handlers.hideCtx(), the click/drag/keyboard handlers' own
  // handlers.showCtx()/toggleFav()/etc.) must THROW if initGridInteraction() hasn't run yet,
  // not silently do nothing. initGridInteraction() is called exactly once, synchronously, at
  // boot (app.ts), before any of its own event listeners exist to be triggered — so this null
  // case is architecturally unreachable in the real app; the only way to hit it is a genuine
  // programming error (calling an exported function before boot, or a future refactor that
  // breaks the init-before-listeners ordering). A silent no-op would swallow exactly that
  // error — a click that quietly does nothing, no console line, no stack trace — which is the
  // failure mode PRINCIPLES.md P0 ("never swallow failures") exists to rule out. Throwing
  // surfaces it immediately, at the exact call site, the moment it happens.
  // How: resets the module registry and dynamically re-imports a fresh instance of this
  // module (so its module-private `handlers` variable starts at its true uninitialized
  // `null`, independent of the shared instance every other test in this file already
  // initialized via the top-level `initGridInteraction(handlers)` call above), then calls the
  // fresh instance's exported `clearSelection()` — the simplest handler-invoking entry point,
  // needing no DOM event simulation — without ever calling `initGridInteraction`, and checks
  // it throws rather than returning normally.
  it('throws rather than silently no-opping when a handler is invoked', async () => {
    vi.resetModules();
    const fresh = await import('./grid-interaction.ts');
    expect(() => fresh.clearSelection()).toThrow();
  });
});
