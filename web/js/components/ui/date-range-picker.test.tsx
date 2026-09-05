// @vitest-environment jsdom
import { useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DateRangePicker } from './date-range-picker.tsx';
import { DateRangeCalendar } from './date-range-calendar.tsx';

function Harness() {
  const [range, setRange] = useState({ from: '2024-02-12', to: '2024-02-16' });
  const [open, setOpen] = useState(false);
  const onChange = (from: string, to: string) => setRange({ from, to });
  // Calendar behavior is tested independently of Floating UI geometry (jsdom has no layout).
  // The real popup, focus restoration, and Escape integration are covered by browser smoke.
  return (
    <>
      <DateRangePicker {...range} onChange={onChange} />
      <button onClick={() => setOpen(true)}>Kalender öffnen</button>
      {open && <DateRangeCalendar {...range} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openCalendar() {
  fireEvent.click(screen.getByRole('button', { name: 'Kalender öffnen' }));
}
function day(name: RegExp) {
  return screen.getAllByRole('button', { name })[0]!;
}

describe('DateRangePicker', () => {
  it('keeps typed endpoints ordered in either direction and permits clearing', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Von'), { target: { value: '2024-03-01' } });
    expect(screen.getByLabelText('Bis')).toHaveValue('2024-03-01');
    fireEvent.change(screen.getByLabelText('Bis'), { target: { value: '2024-02-29' } });
    expect(screen.getByLabelText('Von')).toHaveValue('2024-02-29');
    fireEvent.change(screen.getByLabelText('Bis'), { target: { value: '' } });
    expect(screen.getByLabelText('Bis')).toHaveValue('');
  });

  it('applies a leap-day range across months only when both endpoints are selected', async () => {
    render(<Harness />);
    await openCalendar();
    fireEvent.click(day(/29\. Februar 2024/));
    expect(screen.getByRole('button', { name: 'Zeitraum übernehmen' })).toBeDisabled();
    expect(screen.getByLabelText('Von')).toHaveValue('2024-02-12');
    fireEvent.click(day(/5\. März 2024/));
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum übernehmen' }));
    expect(screen.getByLabelText('Von')).toHaveValue('2024-02-29');
    expect(screen.getByLabelText('Bis')).toHaveValue('2024-03-05');
  });

  it('orders a reverse selection and preserves same-day ranges', async () => {
    render(<Harness />);
    await openCalendar();
    fireEvent.click(day(/20\. Februar 2024/));
    fireEvent.click(day(/15\. Februar 2024/));
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum übernehmen' }));
    expect(screen.getByLabelText('Von')).toHaveValue('2024-02-15');
    expect(screen.getByLabelText('Bis')).toHaveValue('2024-02-20');
    await openCalendar();
    fireEvent.click(day(/21\. Februar 2024/));
    fireEvent.click(day(/21\. Februar 2024/));
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum übernehmen' }));
    expect(screen.getByLabelText('Von')).toHaveValue('2024-02-21');
    expect(screen.getByLabelText('Bis')).toHaveValue('2024-02-21');
  });

  it('cancels a partial selection without changing the applied range', async () => {
    render(<Harness />);
    await openCalendar();
    fireEvent.click(day(/20\. Februar 2024/));
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.getByLabelText('Von')).toHaveValue('2024-02-12');
    expect(screen.getByLabelText('Bis')).toHaveValue('2024-02-16');
    await openCalendar();
    expect(screen.getByRole('button', { name: 'Zeitraum übernehmen' })).toBeEnabled();
  });
});
