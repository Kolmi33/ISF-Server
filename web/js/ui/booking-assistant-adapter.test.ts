import { describe, expect, it } from 'vitest';
import {
  assistantBooking,
  assistantCatalog,
  searchAssistant,
} from './booking-assistant-adapter.ts';
import type { BookingData } from '../../../shared/types.ts';
import type { PlanEntry } from '../core/booking-assistant-types.ts';

const data: BookingData = {
  machines: [
    {
      id: 'real-id',
      name: 'Lange echte Maschine',
      group: 'Alte Halle',
      days: '1111111',
      info: 'Nur mit Einweisung',
    },
    { id: 'meter', name: 'Messgerät', group: 'Labor', cat: 'messtechnik' },
  ],
  bookings: {},
};
const plan: PlanEntry[] = [{ kind: 'device', id: 'card', deviceId: 'real-id' }];
const range = { from: new Date(2026, 9, 23), to: new Date(2026, 9, 27) };
describe('backend/frontend assistant boundary', () => {
  it('uses actual IDs, labels, department, categories and favorites without demo data', () => {
    const catalog = assistantCatalog(data.machines, new Set(['meter']));
    expect(catalog.map((c) => [c.section?.label, c.label])).toEqual([
      [undefined, 'Favoriten'],
      ['Maschinen', 'Alte Halle'],
      ['Messtechnik', 'Labor'],
    ]);
    expect(catalog[1]!.devices[0]).toEqual({
      id: 'real-id',
      name: 'Lange echte Maschine',
      code: 'real-id',
      lab: 'Alte Halle',
      info: 'Nur mit Einweisung',
    });
    expect(assistantCatalog([], new Set())).toEqual([]);
  });
  it('transfers exact workdays across the DST weekend and selected result duration', () => {
    const window = searchAssistant(data, plan, range, 2, 3)[0]!;
    expect(window.openEnded).toBe(true);
    expect(window.dates).toEqual(['2026-10-23', '2026-10-26', '2026-10-27']);
    expect(window.start).toEqual(new Date(2026, 9, 23));
    expect(window.end).toEqual(new Date(2026, 9, 27));
    expect(window.spanDays).toBe(3);
    expect(window.selectedDays).toBe(3);
    expect(assistantBooking(data, { ...window, selectedDays: 2 })).toEqual({
      ids: ['real-id'],
      from: '2026-10-23',
      to: '2026-10-26',
      dates: ['2026-10-23', '2026-10-26'],
    });
  });
  it('rechecks live bookings before confirmation instead of trusting a stale search', () => {
    const window = searchAssistant(data, plan, range, 1, 4)[0]!;
    const changed = {
      ...data,
      bookings: { 'real-id': { '2026-10-26': { name: 'Andere Person', comment: '' } } },
    };
    expect(() => assistantBooking(changed, window)).toThrow('Verfügbarkeit');
    expect(() => assistantBooking({ ...data, machines: [] }, window)).toThrow('Verfügbarkeit');
    expect(() => assistantBooking(data, { ...window, devices: [] })).toThrow();
    expect(() => assistantBooking(data, { ...window, selectedDays: 0 })).toThrow('Anzahl');
    expect(() => assistantBooking(data, { ...window, selectedDays: 5 })).toThrow('Anzahl');
    expect(() => assistantBooking(data, { ...window, selectedDays: 1.5 })).toThrow('Anzahl');
    expect(() =>
      assistantBooking(data, { ...window, maxSelectableDays: 8, selectedDays: 8 }),
    ).toThrow('Verfügbarkeit');
  });
  it('rejects incomplete and inverted ranges', () => {
    expect(() => searchAssistant(data, plan, { from: undefined, to: range.to }, 1, 2)).toThrow(
      'Start- und Enddatum',
    );
    expect(() => searchAssistant(data, plan, { from: range.to, to: range.from }, 1, 2)).toThrow(
      'Zeitraum',
    );
    expect(() =>
      searchAssistant(data, plan, { from: new Date(NaN), to: range.to }, 1, 2),
    ).toThrow();
  });
});
