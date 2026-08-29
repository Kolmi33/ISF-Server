import { describe, it, expect } from 'vitest';
import type { Machine } from '../../../shared/types.ts';
import { fmtLong } from '../core/dates.ts';
import { maintText, statusRangeText, daysMaskText } from './machine-text.ts';

describe('maintText', () => {
  it('is empty for no slot', () => {
    expect(maintText(null)).toBe('');
    expect(maintText(undefined)).toBe('');
  });
  it('formats a bounded Wartung slot', () => {
    const s = { type: 'wartung', from: '2021-01-04', until: '2021-01-06' };
    expect(maintText(s)).toBe(`Wartung: ${fmtLong('2021-01-04')} – ${fmtLong('2021-01-06')}`);
  });
  it('uses sofort/unbegrenzt for open bounds and labels defekt', () => {
    expect(maintText({ type: 'defekt', from: '', until: '' })).toBe('defekt: sofort – unbegrenzt');
  });
  it('appends a note when present', () => {
    const s = { type: 'wartung', from: '2021-01-04', note: 'Kalibrierung' };
    expect(maintText(s)).toBe(`Wartung: ${fmtLong('2021-01-04')} – unbegrenzt (Kalibrierung)`);
  });
});

describe('statusRangeText', () => {
  it('is empty when the machine has no slots', () => {
    expect(statusRangeText({ id: 'm', name: 'M', group: 'g' }, '2021-06-01')).toBe('');
  });

  it('shows the slot covering today (single slot → no suffix)', () => {
    const m: Machine = {
      id: 'm',
      name: 'M',
      group: 'g',
      maint: [{ type: 'wartung', from: '2021-01-01', until: '2021-12-31' }],
    };
    expect(statusRangeText(m, '2021-06-01')).toBe(
      `Wartung: ${fmtLong('2021-01-01')} – ${fmtLong('2021-12-31')}`,
    );
  });

  it('falls back to the earliest slot by from when none covers today, with a +N suffix', () => {
    const m: Machine = {
      id: 'm',
      name: 'M',
      group: 'g',
      // none covers 2021-06-01; defekt has no `from` → sorts first ('0'); comparator returns 1 here
      maint: [
        { type: 'wartung', from: '2021-03-01', until: '2021-03-05' },
        { type: 'defekt', until: '2021-01-05' },
      ],
    };
    expect(statusRangeText(m, '2021-06-01')).toBe(
      `defekt: sofort – ${fmtLong('2021-01-05')} · +1 weitere`,
    );
  });

  it('sorts earliest-first regardless of input order (comparator -1 branch)', () => {
    const m: Machine = {
      id: 'm',
      name: 'M',
      group: 'g',
      maint: [
        { type: 'defekt', until: '2021-01-05' }, // no from → '0', earliest
        { type: 'wartung', from: '2021-03-01', until: '2021-03-05' },
      ],
    };
    expect(statusRangeText(m, '2021-06-01')).toBe(
      `defekt: sofort – ${fmtLong('2021-01-05')} · +1 weitere`,
    );
  });
});

describe('daysMaskText', () => {
  const M = (days?: string): Machine => ({ id: 'm', name: 'M', group: 'g', days });
  it('is "jeden Tag" for absent, wrong-length, or all-on masks', () => {
    expect(daysMaskText(M(undefined))).toBe('jeden Tag');
    expect(daysMaskText(M('111'))).toBe('jeden Tag'); // wrong length
    expect(daysMaskText(M('1111111'))).toBe('jeden Tag');
  });
  it('lists the enabled weekdays', () => {
    expect(daysMaskText(M('1111100'))).toBe('Mo, Di, Mi, Do, Fr');
    expect(daysMaskText(M('0000011'))).toBe('Sa, So');
  });
  it('is "keine Tage" when the mask is all-off', () => {
    expect(daysMaskText(M('0000000'))).toBe('keine Tage');
  });
});
