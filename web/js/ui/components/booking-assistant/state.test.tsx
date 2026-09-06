// @vitest-environment jsdom
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssistantState } from './useAssistantState.ts';
import { normalizePlan, parseDragId, formatDate, formatDateLong, rangeLengthOf } from './model.ts';
import type { PlanEntry } from '../../../core/booking-assistant-types.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function setup() {
  const onSearch = vi.fn().mockReturnValue([]);
  const hook = renderHook(() =>
    useAssistantState({
      catalog: [],
      onSearch,
      onShowCalendar: vi.fn(),
      initialRange: { from: new Date(2026, 8, 7), to: new Date(2026, 8, 13) },
    }),
  );
  const add = (id: string) => act(() => hook.result.current.toggleDevice(id));
  const drop = (id: string, over: string | null) =>
    act(() =>
      hook.result.current.handleDragEnd({
        active: { id },
        over: over ? { id: over } : null,
      } as any),
    );
  return { ...hook, add, drop, onSearch };
}
describe('supplied plan and criteria state', () => {
  it('merges center drops, edits required count, removes members and normalizes singletons', () => {
    const { result, add, drop } = setup();
    add('a');
    add('b');
    add('c');
    const [a, b, c] = result.current.plan;
    drop(`entry:${a!.id}`, `merge:${b!.id}`);
    expect(result.current.plan[0]).toEqual({
      kind: 'group',
      id: b!.id,
      deviceIds: ['b', 'a'],
      requiredCount: 1,
    });
    drop(`entry:${c!.id}`, `merge:${b!.id}`);
    act(() => result.current.setRequiredCount(b!.id, 3));
    act(() => result.current.removeMember(b!.id, 'c'));
    expect(result.current.plan[0]).toMatchObject({ requiredCount: 2 });
    add('a');
    expect(result.current.plan).toEqual([{ kind: 'device', id: b!.id, deviceId: 'b' }]);
    act(() => result.current.removeEntry(b!.id));
    expect(result.current.plan).toEqual([]);
  });
  it('reorders edge drops and extracts group members into independent entries', () => {
    const { result, add, drop } = setup();
    add('a');
    add('b');
    add('c');
    const [a, b, c] = result.current.plan;
    drop(`entry:${a!.id}`, `entry:${c!.id}`);
    expect(result.current.plan.map((e) => e.id)).toEqual([b!.id, c!.id, a!.id]);
    drop(`entry:${a!.id}`, `merge:${b!.id}`);
    drop(`member:${b!.id}:a`, 'plan-list');
    expect(result.current.plan.map((e) => e.kind === 'device' && e.deviceId)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
  it('moves members between groups and leaves self/cancel/unknown drops unchanged', () => {
    const { result, add, drop } = setup();
    ['a', 'b', 'c', 'd'].forEach(add);
    const [a, b, c, d] = result.current.plan;
    drop(`entry:${a!.id}`, `merge:${b!.id}`);
    drop(`entry:${c!.id}`, `merge:${d!.id}`);
    const before = result.current.plan;
    drop('unknown', 'plan-list');
    drop(`entry:${b!.id}`, null);
    drop('entry:missing', `entry:${d!.id}`);
    drop(`entry:${b!.id}`, `entry:${b!.id}`);
    drop(`entry:${b!.id}`, `merge:${b!.id}`);
    drop(`member:${b!.id}:a`, `merge:${b!.id}`);
    drop(`entry:${b!.id}`, 'entry:missing');
    expect(result.current.plan).toEqual(before);
    drop(`member:${b!.id}:a`, `merge:${d!.id}`);
    expect(result.current.plan[1]).toMatchObject({ deviceIds: ['d', 'c', 'a'] });
    drop(`member:${d!.id}:a`, `entry:${b!.id}`);
    expect(result.current.plan[0]).toMatchObject({ kind: 'device', deviceId: 'a' });
  });
  it('tracks drag overlays and target highlights', () => {
    const { result, add } = setup();
    add('a');
    const id = result.current.plan[0]!.id;
    act(() => result.current.handleDragStart({ active: { id: `entry:${id}` } } as any));
    expect(result.current.draggedEntry?.id).toBe(id);
    act(() => result.current.handleDragOver({ over: { id: `merge:${id}` } }));
    expect(result.current.mergeTargetId).toBe(id);
    act(() => result.current.handleDragOver({ over: null }));
    expect(result.current.mergeTargetId).toBeNull();
  });
  it('couples min/max, retains partial ranges, applies range bounds and expires hints', () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.changeMinDays(5));
    act(() => result.current.changeMaxDays(3));
    expect(result.current.minDays).toBe(3);
    act(() => result.current.changeMinDays(6));
    expect(result.current.maxDays).toBe(6);
    act(() => result.current.applyRange({ from: new Date(2026, 8, 7), to: undefined }));
    expect(result.current.maxDays).toBe(6);
    act(() => result.current.applyRange({ from: new Date(2026, 8, 7), to: new Date(2026, 8, 8) }));
    expect(result.current.maxDays).toBe(2);
    expect(result.current.minDays).toBe(2);
    act(() => result.current.flagLimit('upper'));
    expect(result.current.limitHint?.message).toContain('2 Tage');
    act(() => vi.advanceTimersByTime(2800));
    expect(result.current.limitHint).toBeNull();
    act(() => result.current.flagLimit('lower'));
    expect(result.current.limitHint?.message).toContain('1 Tag');
  });
  it('freezes result selections and handles real search failures', () => {
    document.body.innerHTML = '<div id="toast"></div>';
    const { result, onSearch, add } = setup();
    add('a');
    onSearch.mockReturnValue([
      { id: 'one', selectedDays: 1 },
      { id: 'two', selectedDays: 1 },
    ]);
    act(() => result.current.runSearch());
    expect(onSearch.mock.calls[0]![0]).toEqual(result.current.plan);
    act(() => result.current.changeResultDays('one', 3));
    expect(result.current.results.map((w) => w.selectedDays)).toEqual([3, 1]);
    onSearch.mockImplementation(() => {
      throw new Error('Serverdaten fehlen');
    });
    act(() => result.current.runSearch());
    expect(document.getElementById('toast')!.textContent).toContain('Serverdaten fehlen');
    onSearch.mockImplementation(() => {
      throw 'Fehler';
    });
    act(() => result.current.runSearch());
    expect(document.getElementById('toast')!.textContent).toContain('Suche');
  });
  it('keeps supplied date formatting and removes empty groups', () => {
    expect(formatDate()).toBe('TT.MM.JJJJ');
    expect(formatDate(new Date(2026, 8, 7))).toBe('07.09.2026');
    expect(formatDateLong(new Date(2026, 8, 7))).toContain('07.09.2026');
    expect(rangeLengthOf({ from: undefined, to: undefined })).toBe(90);
    expect(parseDragId('invalid')).toBeNull();
    expect(parseDragId('member:g:a')).toEqual({ type: 'member', entryId: 'g', deviceId: 'a' });
    expect(
      normalizePlan([{ kind: 'group', id: 'g', deviceIds: [], requiredCount: 1 }] as PlanEntry[]),
    ).toEqual([]);
  });
});
