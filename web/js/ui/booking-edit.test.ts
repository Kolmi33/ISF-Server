import { describe, expect, it } from 'vitest';
import type { BookingData, Machine } from '../../../shared/types.ts';
import {
  applyBookingEdit,
  bookingEditBlock,
  bookingEditChanged,
  bookingEditConflicts,
  buildBookingEditModel,
  resizeBookingEditRow,
  shiftBookingEditRows,
  toggleBookingEditDate,
  paintBookingEditDates,
} from './booking-edit.ts';
import type { MyBookingCampaign } from './views/my-bookings.ts';

const TODAY = '2026-09-09';
const machine = (id: string, overrides: Partial<Machine> = {}): Machine => ({
  id,
  name: id.toUpperCase(),
  group: 'Halle',
  days: '1111100',
  ...overrides,
});
const booking = { name: 'Anna', gid: 'g1', gtitle: 'Projekt', note: 'Versuch', ts: 'stamp' };

function fixture(): { data: BookingData; campaign: MyBookingCampaign } {
  const data: BookingData = {
    machines: [
      machine('m1'),
      machine('m2'),
      machine('s1', { cat: 'messtechnik' }),
      machine('blocked', {
        maint: [{ type: 'wartung', from: '2026-09-14', until: '2026-09-14', note: 'Service' }],
      }),
    ],
    bookings: {
      m1: {
        '2026-09-08': booking,
        '2026-09-09': booking,
        '2026-09-10': booking,
      },
      s1: { '2026-09-10': booking },
      m2: { '2026-09-14': { name: 'Bob', gid: 'other' } },
    },
  };
  return {
    data,
    campaign: {
      id: 'g1',
      groupId: 'g1',
      title: 'Projekt',
      owner: 'Anna',
      status: 'aktiv',
      dates: ['2026-09-08', '2026-09-09', '2026-09-10'],
      cells: [
        { machineId: 'm1', date: '2026-09-08' },
        { machineId: 'm1', date: '2026-09-09' },
        { machineId: 'm1', date: '2026-09-10' },
        { machineId: 's1', date: '2026-09-10' },
      ],
      machines: [data.machines[0]!, data.machines[2]!],
      createdAt: 'stamp',
      note: 'Versuch',
    },
  };
}

describe('booking edit domain', () => {
  it('loads and preserves explicitly booked weekends when another row changes', () => {
    const { data, campaign } = fixture();
    data.bookings.m1!['2026-09-12'] = { ...booking };
    const model = buildBookingEditModel(data, campaign, TODAY);
    expect(model.initialRows[0]!.dates).toContain('2026-09-12');
    const rows = shiftBookingEditRows(model.initialRows, 1, 's1', model.days);
    expect(applyBookingEdit(data, model, rows, 'Anna').abort).not.toBe(true);
    expect(data.bookings.m1!['2026-09-12']).toEqual(booking);
  });

  it('clamps a large move at the axis boundary instead of jumping to the source', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    const moved = shiftBookingEditRows(model.initialRows, 100, undefined, model.days);
    expect(moved[0]!.dates.at(-1)).toBe(model.days.at(-1));
    expect(moved[0]!.dates.length).toBe(model.initialRows[0]!.dates.length);
  });

  it('paints dates idempotently, skips occupied cells and keeps one day on removal', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    const rows = [{ machineId: 'm2', category: 'maschine' as const, dates: ['2026-09-10'] }];
    const painted = paintBookingEditDates(
      data,
      model,
      rows,
      ['m2'],
      ['2026-09-11', '2026-09-14'],
      true,
    );
    expect(painted[0]!.dates).toEqual(['2026-09-10', '2026-09-11']);
    expect(paintBookingEditDates(data, model, painted, ['m2'], ['2026-09-11'], true)).toEqual(
      painted,
    );
    expect(
      paintBookingEditDates(data, model, painted, ['m2'], painted[0]!.dates, false)[0]!.dates,
    ).toHaveLength(1);
  });
  it('builds rows from real live group cells and leaves historic days immutable', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    expect(model.initialRows).toEqual([
      { machineId: 'm1', category: 'maschine', dates: ['2026-09-09', '2026-09-10'] },
      { machineId: 's1', category: 'messtechnik', dates: ['2026-09-10'] },
    ]);
    expect(model.days[0]).toBe('2026-09-06');
    expect(bookingEditBlock(data, model, 'm1', '2026-09-08')?.kind).toBe('past');
  });

  it('classifies foreign occupancy, maintenance and unavailable weekdays from backend data', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    expect(bookingEditBlock(data, model, 'm2', '2026-09-14')).toEqual({
      kind: 'foreign',
      label: 'Belegt von Bob',
    });
    expect(bookingEditBlock(data, model, 'blocked', '2026-09-14')).toEqual({
      kind: 'maintenance',
      label: 'Service',
    });
    expect(bookingEditBlock(data, model, 'm1', '2026-09-12')?.kind).toBe('unavailable');
  });

  it('moves a device or whole group, toggles free days, and protects the final day', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    const shifted = shiftBookingEditRows(model.initialRows, 1, 'm1');
    expect(shifted[0]!.dates).toEqual(['2026-09-10', '2026-09-11']);
    expect(shifted[1]!.dates).toEqual(['2026-09-10']);
    const added = toggleBookingEditDate(data, model, model.initialRows, 's1', '2026-09-11');
    expect(added[1]!.dates).toEqual(['2026-09-10', '2026-09-11']);
    const protectedLast = toggleBookingEditDate(data, model, model.initialRows, 's1', '2026-09-10');
    expect(protectedLast[1]!.dates).toEqual(['2026-09-10']);
  });

  it('keeps keyboard and drag shifts inside the visible editing axis', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    const atEdge = [{ machineId: 'm1', category: 'maschine' as const, dates: [model.days[0]!] }];
    expect(shiftBookingEditRows(atEdge, -1, 'm1', model.days)).toEqual(atEdge);
  });

  it('clamps growth before foreign bookings and skips closed weekend days', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    const rows = [{ machineId: 'm2', category: 'maschine' as const, dates: ['2026-09-10'] }];
    const resized = resizeBookingEditRow(data, model, rows, 'm2', 'end', '2026-09-15');
    expect(resized[0]!.dates).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('reports conflicts and applies a valid move atomically while preserving metadata', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    const moved = shiftBookingEditRows(model.initialRows, 1, 's1');
    expect(bookingEditChanged(model.initialRows, moved)).toBe(true);
    expect(bookingEditConflicts(data, model, moved)).toEqual([]);
    const result = applyBookingEdit(data, model, moved, 'anna');
    expect(result.abort).not.toBe(true);
    expect(data.bookings.s1!['2026-09-10']).toBeUndefined();
    expect(data.bookings.s1!['2026-09-11']).toEqual(booking);
    expect(result.undo).toHaveLength(2);
  });

  it('rejects foreign owners, stale source cells, conflicts and an empty group without mutation', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    expect(applyBookingEdit(data, model, model.initialRows, 'Bob').error).toMatch(/Eigentümer/);
    expect(applyBookingEdit(data, model, [], 'Anna').error).toMatch(/Mindestens/);
    data.bookings.m1!['2026-09-09'] = { ...booking, note: 'parallel geändert' };
    expect(applyBookingEdit(data, model, model.initialRows, 'Anna').error).toMatch(
      /zwischenzeitlich/,
    );
  });

  it('rejects duplicate device rows before changing live booking data', () => {
    const { data, campaign } = fixture();
    const model = buildBookingEditModel(data, campaign, TODAY);
    const duplicated = [...model.initialRows, { ...model.initialRows[0]!, dates: ['2026-09-11'] }];
    const before = structuredClone(data.bookings);
    expect(applyBookingEdit(data, model, duplicated, 'Anna').error).toMatch(/nur einmal/);
    expect(data.bookings).toEqual(before);
  });
});
