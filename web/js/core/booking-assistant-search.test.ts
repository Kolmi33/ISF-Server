import { describe, expect, it } from 'vitest';
import { availableForBooking, searchBookingWindows } from './booking-assistant-search.ts';
import type { BookingData } from '../../../shared/types.ts';
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

describe('booking assistant workday scheduler', () => {
  it('offers an open run once and caps it to the maximum duration', () => {
    const windows = searchBookingWindows(data(), [device], from, to, 2, 4);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      openEnded: true,
      minDays: 2,
      maxDays: 4,
      devices: [{ deviceId: 'a', fromGroup: false }],
    });
    expect(windows[0]!.dates).toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
  });

  it('counts only Monday through Friday and treats Friday to Monday as continuous', () => {
    const state = data();
    state.bookings.a = {
      '2026-09-12': booked,
      '2026-09-13': booked,
    };
    state.machines[0]!.maint = [{ type: 'wartung', from: '2026-09-12', until: '2026-09-13' }];
    const window = searchBookingWindows(state, [device], '2026-09-11', '2026-09-18', 6, 6)[0]!;
    expect(window.dates).toEqual([
      '2026-09-11',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ]);
    expect(window.openEnded).toBe(true);
  });

  it('sorts finite slots by offered workdays and breaks equal lengths by earlier start', () => {
    const state = data();
    state.bookings.a = {
      '2026-09-10': booked,
      '2026-09-17': booked,
      '2026-09-22': booked,
    };
    expect(
      searchBookingWindows(state, [device], from, '2026-09-21', 2, 4).map((window) => window.dates),
    ).toEqual([
      ['2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16'],
      ['2026-09-07', '2026-09-08', '2026-09-09'],
      ['2026-09-18', '2026-09-21'],
    ]);

    state.bookings.a = {
      '2026-09-10': booked,
      '2026-09-14': booked,
      '2026-09-18': booked,
    };
    expect(
      searchBookingWindows(state, [device], from, '2026-09-17', 3, 3).map(
        (window) => window.dates[0],
      ),
    ).toEqual(['2026-09-07', '2026-09-15']);
  });

  it('breaks finite slots at weekday bookings and maintenance boundaries', () => {
    const state = data();
    state.bookings.a = { '2026-09-09': booked };
    state.machines[0]!.maint = [{ type: 'wartung', from: '2026-09-14', until: '2026-09-15' }];
    expect(
      searchBookingWindows(state, [device], from, '2026-09-15', 2, 7).map((window) => window.dates),
    ).toEqual([
      ['2026-09-07', '2026-09-08'],
      ['2026-09-10', '2026-09-11'],
    ]);
  });

  it('honors recurring machine weekday restrictions inside the Monday-to-Friday calendar', () => {
    const state = data();
    state.machines[0]!.days = '1010000';
    expect(
      searchBookingWindows(state, [device], from, to, 1, 5).map((window) => window.dates),
    ).toEqual([['2026-09-07'], ['2026-09-09']]);
  });

  it('does not combine different alternatives across workdays into a fictional window', () => {
    const state = data();
    state.bookings.a = { '2026-09-08': booked };
    state.bookings.b = { [from]: booked, '2026-09-09': booked };
    expect(searchBookingWindows(state, [group], from, '2026-09-08', 2, 2)).toEqual([]);
    expect(
      searchBookingWindows(state, [group], from, '2026-09-08', 1, 1).map(
        (window) => window.devices,
      ),
    ).toEqual([[{ deviceId: 'a', fromGroup: true }], [{ deviceId: 'b', fromGroup: true }]]);
  });

  it('resolves N-of-M together with mandatory devices for their whole finite window', () => {
    const state = data();
    state.machines[0]!.maint = [{ type: 'wartung', from: '2026-09-10' }];
    const plan: PlanEntry[] = [
      { ...group, requiredCount: 2 },
      { kind: 'device', id: 'e-c', deviceId: 'c' },
    ];
    const window = searchBookingWindows(state, plan, from, to, 2, 7)[0]!;
    expect(window.openEnded).toBe(false);
    expect(window.dates).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
    expect(window.devices).toEqual([
      { deviceId: 'b', fromGroup: true },
      { deviceId: 'a', fromGroup: true },
      { deviceId: 'c', fromGroup: false },
    ]);
    for (const resolved of window.devices)
      for (const day of window.dates)
        expect(availableForBooking(state, resolved.deviceId, day)).toBe(true);
  });

  it('prefers an open-ended alternative and sorts that result before finite slots', () => {
    const state = data();
    state.bookings.a = { '2026-09-10': booked };
    state.bookings.b = { [from]: booked };
    const windows = searchBookingWindows(state, [group], from, to, 2, 5);
    expect(
      windows.map((window) => [window.openEnded, window.dates[0], window.devices[0]!.deviceId]),
    ).toEqual([
      [true, '2026-09-08', 'b'],
      [false, from, 'a'],
    ]);
  });

  it('marks future bookings and maintenance as finite, including an open-ended maintenance block', () => {
    const state = data();
    state.bookings.a = { '2026-09-30': booked };
    let window = searchBookingWindows(state, [device], from, from, 2, 5)[0]!;
    expect(window.openEnded).toBe(false);
    expect(window.dates).toHaveLength(5);

    state.bookings.a = {};
    state.machines[0]!.maint = [{ type: 'defekt', from: '2026-09-30' }];
    window = searchBookingWindows(state, [device], from, from, 2, 5)[0]!;
    expect(window.openEnded).toBe(false);
    state.machines[0]!.maint = [{ type: 'defekt', from }];
    expect(searchBookingWindows(state, [device], from, to, 1, 5)).toEqual([]);
  });

  it('resolves nested requirement groups with one fixed choice for the complete result', () => {
    const state = data();
    const plan: PlanEntry[] = [
      {
        kind: 'group',
        id: 'outer',
        requiredCount: 1,
        members: [member('c'), { ...group, id: 'inner', requiredCount: 2 }],
      },
    ];
    expect(searchBookingWindows(state, plan, from, to, 1, 5)[0]!.devices).toEqual([
      { deviceId: 'c', fromGroup: true },
    ]);
    state.machines[2]!.maint = [{ type: 'wartung', from: '2026-09-09' }];
    expect(searchBookingWindows(state, plan, from, to, 1, 5)[0]!.devices).toEqual([
      { deviceId: 'a', fromGroup: true },
      { deviceId: 'b', fromGroup: true },
    ]);
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
        5,
      ),
    ).toThrow('Anzahl');
  });

  it('rejects invalid requirements and durations; missing machines produce no result', () => {
    const search = (plan: PlanEntry[], min = 1, max = 5) =>
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
    expect(() => searchBookingWindows(data(), [device], to, from, 1, 5)).toThrow();
    expect(() => searchBookingWindows(data(), [device], '', to, 1, 5)).toThrow();
    expect(() => searchBookingWindows(data(), [device], '2026-09-12', '2026-09-13', 1, 1)).toThrow(
      'keine Arbeitstage',
    );
    expect(search([{ ...device, deviceId: 'missing' }])).toEqual([]);
  });
});
