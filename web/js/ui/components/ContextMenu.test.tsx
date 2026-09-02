// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { AppState, Booking, Machine } from '../../../../shared/types.ts';
import { selection } from '../grid-interaction.ts';
import { store } from '../../store-instance.ts';
import { ContextMenu, showCtx, hideCtx } from './ContextMenu.tsx';

function machine(overrides: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'Fräse', group: 'Halle 1', ...overrides };
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return { name: 'anna', ...overrides };
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="ctxMenu"></div>
    <div id="gridWrap"></div>
    <div id="toast"></div>
    <div id="overlay"><div id="modal" tabindex="-1"></div></div>
    <div id="modalReopen"></div>`;
  store.set({
    data: { machines: [machine()], bookings: {} },
    user: 'anna',
    visM: [],
    visD: [],
  } as unknown as Partial<AppState>);
  window.S = store.state;
  window.machById = (id: string) => window.S.data!.machines.find((m) => m.id === id);
  window.mutate = vi.fn((fn: (fresh: unknown) => unknown) =>
    Promise.resolve(fn(window.S.data)),
  ) as typeof window.mutate;
  window.askConfirm = vi.fn().mockResolvedValue(true);
  window.hideCtx = hideCtx;
  selection.anchor = { mid: 'm1', date: '2021-01-04' };
  selection.focus = { mid: 'm1', date: '2021-01-05' };
  selection.cells = [
    { mid: 'm1', date: '2021-01-04' },
    { mid: 'm1', date: '2021-01-05' },
  ];
  render(<ContextMenu />, { container: document.getElementById('ctxMenu')! });
});

describe('ContextMenu', () => {
  it('renders nothing, and #ctxMenu stays hidden, until shown', () => {
    expect(document.getElementById('ctxMenu')!.style.display).not.toBe('block');
    expect(document.getElementById('ctxMenu')!.children.length).toBe(0);
  });

  it('shows the machine count and date range, with no delete button when nothing is booked', () => {
    act(() => showCtx(100, 100));
    expect(document.getElementById('ctxMenu')!.style.display).toBe('block');
    expect(screen.getByText(/1 Maschine\(n\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Buchung\(en\) löschen/)).not.toBeInTheDocument();
    expect(screen.getByText(/Buchen…/)).toBeInTheDocument();
  });

  it('shows a delete button naming the affected bookers when the range has bookings', () => {
    window.S.data!.bookings = { m1: { '2021-01-04': booking({ name: 'anna' }) } };
    act(() => showCtx(100, 100));
    const del = screen.getByTitle('betroffen: anna');
    expect(del).toHaveTextContent('1 Buchung(en) löschen');
  });

  it('hideCtx hides the menu again', () => {
    act(() => showCtx(100, 100));
    act(() => hideCtx());
    expect(document.getElementById('ctxMenu')!.style.display).toBe('none');
    expect(document.getElementById('ctxMenu')!.children.length).toBe(0);
  });

  it('"Abbrechen" hides the menu and clears the selection', () => {
    act(() => showCtx(100, 100));
    fireEvent.click(screen.getByText('Abbrechen'));
    expect(document.getElementById('ctxMenu')!.style.display).toBe('none');
    expect(selection.cells).toEqual([]);
    expect(selection.anchor).toBeNull();
  });

  it('an outside mousedown dismisses the menu; a click inside it does not', () => {
    act(() => showCtx(100, 100));
    fireEvent.mouseDown(document.getElementById('ctxMenu')!);
    expect(document.getElementById('ctxMenu')!.style.display).toBe('block');

    fireEvent.mouseDown(document.body);
    expect(document.getElementById('ctxMenu')!.style.display).toBe('none');
  });

  it('"Buchen…" hides the menu and opens the booking form pre-picked for the range', async () => {
    act(() => showCtx(100, 100));
    fireEvent.click(screen.getByText(/Buchen…/));
    expect(document.getElementById('ctxMenu')!.style.display).toBe('none');
    expect(await screen.findByRole('heading', { name: 'Buchen' })).toBeInTheDocument();
  });

  it('deleting confirms, deletes the booked cells via mutate, clears selection, and offers undo', async () => {
    window.S.data!.bookings = {
      m1: {
        '2021-01-04': booking({ name: 'anna' }),
        '2021-01-05': booking({ name: 'ben' }),
      },
    };
    act(() => showCtx(100, 100));
    await act(async () => {
      fireEvent.click(screen.getByTitle('betroffen: anna, ben'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Markierte Buchungen löschen?' }),
    );
    expect(window.S.data!.bookings['m1']).toEqual({});
    expect(selection.cells).toEqual([]);
    expect(document.getElementById('ctxMenu')!.style.display).toBe('none');
    expect(document.getElementById('toast')!.textContent).toMatch(/2 Buchung\(en\) gelöscht\./);
  });

  it("escapes a booker name before it reaches the confirm dialog's HTML body", async () => {
    window.S.data!.bookings = { m1: { '2021-01-04': booking({ name: '<b>x</b>' }) } };
    act(() => showCtx(100, 100));
    await act(async () => {
      fireEvent.click(screen.getByTitle('betroffen: <b>x</b>'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('&lt;b&gt;x&lt;/b&gt;') }),
    );
    expect(window.askConfirm).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('<b>x</b>') }),
    );
  });

  it('does not delete when the confirm dialog is declined', async () => {
    window.askConfirm = vi.fn().mockResolvedValue(false);
    window.S.data!.bookings = { m1: { '2021-01-04': booking({ name: 'anna' }) } };
    act(() => showCtx(100, 100));
    await act(async () => {
      fireEvent.click(screen.getByTitle('betroffen: anna'));
      await Promise.resolve();
    });
    expect(window.S.data!.bookings['m1']!['2021-01-04']).toBeDefined();
  });
});
