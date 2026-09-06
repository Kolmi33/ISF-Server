import { describe, expect, it } from 'vitest';
import { searchBookingWindows, availableForBooking } from './booking-assistant-search.ts';
import type { BookingData } from '../../../shared/types.ts';
import { getAllDaysInRange } from '../../../shared/dates.ts';
import type { PlanEntry, PlanGroupEntry } from './booking-assistant-types.ts';

const from = '2026-09-07';
const to = '2026-09-13';
const device: PlanEntry = { kind: 'device', id: 'entry-a', deviceId: 'a' };
const member = (deviceId: string): PlanEntry => ({ kind: 'device', id: `m-${deviceId}`, deviceId });
const group: PlanGroupEntry = {
  kind: 'group',
  id: 'group',
  members: [member('a'), member('b')],
  requiredCount: 1,
};
const data = (): BookingData => ({
  machines: ['a', 'b', 'c'].map((id) => ({ id, name: id, group: 'Halle', days: '1111111' })),
  bookings: {},
});
const booked = { name: 'Andere Person', comment: '' };

describe('supplied assistant live calendar-day scheduler', () => {
  it('offers a long free run once and caps the result to the maximum duration', () => {
    const windows = searchBookingWindows(data(), [device], from, to, 2, 4);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      minDays: 2,
      maxDays: 4,
      devices: [{ deviceId: 'a', fromGroup: false }],
    });
    expect(windows[0]!.dates).toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
  });
  it('sorts separate slots by offered length and breaks equal lengths by earlier start', () => {
    const state = data();
    state.bookings.a = {
      '2026-09-10': booked,
      '2026-09-17': booked,
      '2026-09-20': booked,
    };
    const windows = searchBookingWindows(state, [device], from, '2026-09-21', 2, 4);
    expect(windows.map((window) => window.dates)).toEqual([
      ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'],
      ['2026-09-07', '2026-09-08', '2026-09-09'],
      ['2026-09-18', '2026-09-19'],
    ]);

    state.bookings.a = { '2026-09-10': booked, '2026-09-14': booked };
    expect(
      searchBookingWindows(state, [device], from, '2026-09-15', 3, 3).map(
        (window) => window.dates[0],
      ),
    ).toEqual(['2026-09-07', '2026-09-11']);
  });
  it('breaks at bookings and maintenance, including inclusive endpoints', () => {
    const state = data();
    state.bookings.a = { '2026-09-09': booked };
    state.machines[0]!.maint = [{ type: 'wartung', from: '2026-09-12', until: '2026-09-13' }];
    expect(searchBookingWindows(state, [device], from, to, 2, 7).map((w) => w.dates)).toEqual([
      ['2026-09-07', '2026-09-08'],
      ['2026-09-10', '2026-09-11'],
    ]);
  });
  it('honors machine weekdays and never skips an unavailable weekend', () => {
    const state = data();
    state.machines[0]!.days = '1111100';
    expect(searchBookingWindows(state, [device], '2026-09-11', '2026-09-14', 2, 4)).toEqual([]);
    state.machines[0]!.days = '1111111';
    expect(
      searchBookingWindows(state, [device], '2026-09-11', '2026-09-14', 4, 4)[0]!.dates,
    ).toHaveLength(4);
    state.machines[0]!.days = '1010000';
    expect(searchBookingWindows(state, [device], from, to, 1, 7).map((w) => w.dates)).toEqual([
      [from],
      ['2026-09-09'],
    ]);
  });
  it('does not combine different alternatives across days into a fictional window', () => {
    const state = data();
    state.bookings.a = { '2026-09-08': booked };
    state.bookings.b = { [from]: booked };
    expect(searchBookingWindows(state, [group], from, '2026-09-08', 2, 2)).toEqual([]);
    expect(
      searchBookingWindows(state, [group], from, '2026-09-08', 1, 2).map((w) => w.devices),
    ).toEqual([[{ deviceId: 'a', fromGroup: true }], [{ deviceId: 'b', fromGroup: true }]]);
  });
  it('resolves N-of-M together with mandatory devices for their whole window', () => {
    const state = data();
    state.bookings.a = { '2026-09-10': booked };
    const plan: PlanEntry[] = [
      { ...group, requiredCount: 2 },
      { kind: 'device', id: 'e-c', deviceId: 'c' },
    ];
    const windows = searchBookingWindows(state, plan, from, to, 2, 7);
    expect(windows[0]!.devices).toEqual([
      { deviceId: 'b', fromGroup: true },
      { deviceId: 'a', fromGroup: true },
      { deviceId: 'c', fromGroup: false },
    ]);
    for (const window of windows)
      for (const resolved of window.devices)
        for (const day of window.dates)
          expect(availableForBooking(state, resolved.deviceId, day)).toBe(true);
  });
  it('chooses the longest-lived alternative and sorts its slots by offered length', () => {
    const state = data();
    state.bookings.a = { '2026-09-10': booked };
    state.bookings.b = { [from]: booked };
    const windows = searchBookingWindows(state, [group], from, to, 2, 7);
    expect(windows.map((w) => [w.dates[0], w.dates.at(-1), w.devices[0]!.deviceId])).toEqual([
      ['2026-09-08', to, 'b'],
      [from, '2026-09-09', 'a'],
    ]);
  });
  it('resolves a requirement group nested inside a requirement group', () => {
    const state = data();
    // "Entweder c allein, oder a und b zusammen" — flach nicht ausdrückbar.
    const plan: PlanEntry[] = [
      {
        kind: 'group',
        id: 'outer',
        requiredCount: 1,
        members: [member('c'), { ...group, id: 'inner', requiredCount: 2 }],
      },
    ];
    // Solange c frei ist, ist c die längstlebende Möglichkeit und gewinnt allein.
    expect(searchBookingWindows(state, plan, from, to, 1, 7)[0]!.devices).toEqual([
      { deviceId: 'c', fromGroup: true },
    ]);
    // Fällt c mittendrin aus, trägt das Paar a+b länger — und beide werden eingeplant.
    state.bookings.c = { '2026-09-09': booked };
    const windows = searchBookingWindows(state, plan, from, to, 1, 7);
    expect(windows[0]!.devices).toEqual([
      { deviceId: 'a', fromGroup: true },
      { deviceId: 'b', fromGroup: true },
    ]);
    expect(windows[0]!.dates).toEqual(getAllDaysInRange(from, to));
    // Auch das eingebettete "2 von 2" wird geprüft.
    expect(() =>
      searchBookingWindows(
        state,
        [
          {
            kind: 'group',
            id: 'outer',
            requiredCount: 1,
            members: [member('c'), { ...group, id: 'inner', requiredCount: 3 }],
          },
        ],
        from,
        to,
        1,
        7,
      ),
    ).toThrow('Anzahl');
  });
  it('rejects invalid requirements and durations; missing machines produce no result', () => {
    const search = (plan: PlanEntry[], min = 1, max = 7) =>
      searchBookingWindows(data(), plan, from, to, min, max);
    expect(() => search([])).toThrow();
    expect(() => search([device, device])).toThrow();
    for (const requiredCount of [0, 3, 1.5])
      expect(() => search([{ ...group, requiredCount }])).toThrow();
    for (const [min, max] of [
      [0, 3],
      [2, 1],
      [1.5, 3],
      [1, 2.5],
    ])
      expect(() => search([device], min, max)).toThrow();
    expect(() => searchBookingWindows(data(), [device], to, from, 1, 7)).toThrow();
    expect(() => searchBookingWindows(data(), [device], '', to, 1, 7)).toThrow();
    expect(search([{ ...device, deviceId: 'missing' }])).toEqual([]);
    expect(search([device], 8, 9)).toEqual([]);
  });
});
