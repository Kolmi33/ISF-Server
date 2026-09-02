import { describe, it, expect } from 'vitest';
import type { BookingData, Machine } from '../../../shared/types.ts';
import { saveMachine, deleteMachine, moveMachine, type MachineForm } from './machines.ts';

function data(machines: Machine[], bookings: BookingData['bookings'] = {}): BookingData {
  return { machines, bookings };
}
const M = (over: Partial<Machine> = {}): Machine => ({ id: 'm1', name: 'M1', group: 'A', ...over });

const form = (over: Partial<MachineForm> = {}): MachineForm => ({
  name: 'Neue Fräse',
  group: 'A',
  cat: 'maschine',
  info: '',
  redu: '',
  daysMask: null,
  maint: [],
  ...over,
});

describe('saveMachine — edit', () => {
  it('applies the fields onto an existing machine and clears absent optionals', () => {
    const existing = M({
      id: 'm1',
      cat: 'messtechnik',
      redu: 'x',
      days: '1111100',
      maint: [{ type: 'defekt' }],
      status: 'ok',
      statusNote: 'n',
      statusFrom: 'f',
      statusUntil: 'u',
    });
    const d = data([existing]);
    const res = saveMachine(d, 'm1', form({ name: 'Umbenannt', group: 'B', info: 'i' }));
    expect(res).toBeUndefined();
    expect(d.machines[0]).toEqual({ id: 'm1', name: 'Umbenannt', group: 'B', info: 'i' });
  });

  it('keeps the present optionals (redu / days / maint / messtechnik)', () => {
    const d = data([M({ id: 'm1' })]);
    saveMachine(
      d,
      'm1',
      form({ cat: 'messtechnik', redu: 'r', daysMask: '1111100', maint: [{ type: 'wartung' }] }),
    );
    expect(d.machines[0]).toMatchObject({
      cat: 'messtechnik',
      redu: 'r',
      days: '1111100',
      maint: [{ type: 'wartung' }],
    });
  });

  it('aborts when the machine to edit has vanished', () => {
    const d = data([M({ id: 'm1' })]);
    expect(saveMachine(d, 'gone', form())).toEqual({ abort: true });
  });
});

describe('saveMachine — create', () => {
  it('slugs the name, transliterates umlauts, and inserts after the group', () => {
    const d = data([M({ id: 'a1', group: 'A' }), M({ id: 'b1', group: 'B' })]);
    saveMachine(d, null, form({ name: 'Über Fräse!', group: 'A' }));
    expect(d.machines.map((m) => m.id)).toEqual(['a1', 'ueber-fraese', 'b1']); // after last A
  });

  it('disambiguates a colliding id with a numeric suffix', () => {
    const d = data([M({ id: 'fraese', group: 'A' }), M({ id: 'fraese-2', group: 'A' })]);
    saveMachine(d, null, form({ name: 'Fraese', group: 'A' }));
    expect(d.machines.some((m) => m.id === 'fraese-3')).toBe(true);
  });

  it('falls back to "maschine" for a name with no slug-able characters', () => {
    const d = data([]);
    saveMachine(d, null, form({ name: '!!!' }));
    expect(d.machines[0]!.id).toBe('maschine');
  });

  it('appends at the end when no machine shares the group', () => {
    const d = data([M({ id: 'a1', group: 'A' })]);
    saveMachine(d, null, form({ name: 'Z', group: 'Z' }));
    expect(d.machines.map((m) => m.id)).toEqual(['a1', 'z']);
  });
});

describe('deleteMachine', () => {
  it('removes the machine and its bookings', () => {
    const d = data([M({ id: 'm1' }), M({ id: 'm2' })], { m1: { '2021-01-04': { name: 'A' } } });
    expect(deleteMachine(d, 'm1')).toBeUndefined();
    expect(d.machines.map((m) => m.id)).toEqual(['m2']);
    expect(d.bookings.m1).toBeUndefined();
  });

  it('aborts when the machine is already gone', () => {
    expect(deleteMachine(data([]), 'm1')).toEqual({ abort: true });
  });
});

describe('moveMachine', () => {
  const three = () =>
    data([M({ id: 'a', group: 'G' }), M({ id: 'b', group: 'G' }), M({ id: 'c', group: 'G' })]);

  it('swaps up (direction -1)', () => {
    const d = three();
    expect(moveMachine(d, 'b', -1)).toBeUndefined();
    expect(d.machines.map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  it('swaps down (direction +1)', () => {
    const d = three();
    moveMachine(d, 'b', 1);
    expect(d.machines.map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });

  it('aborts at the top, at the bottom, and for an unknown id', () => {
    expect(moveMachine(three(), 'a', -1)).toEqual({ abort: true }); // neighbourIndex<0
    expect(moveMachine(three(), 'c', 1)).toEqual({ abort: true }); // neighbourIndex>=length
    expect(moveMachine(three(), 'zzz', -1)).toEqual({ abort: true }); // currentIndex<0
  });

  it('aborts when the neighbour is in a different group', () => {
    const d = data([M({ id: 'a', group: 'G' }), M({ id: 'b', group: 'H' })]);
    expect(moveMachine(d, 'a', 1)).toEqual({ abort: true });
    expect(d.machines.map((m) => m.id)).toEqual(['a', 'b']); // unchanged
  });
});
