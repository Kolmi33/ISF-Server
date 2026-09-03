import { describe, it, expect } from 'vitest';
import type { Machine } from '../../../shared/types.ts';
import { formatDateLong } from '../../../shared/dates.ts';
import { maintText, statusRangeText, daysMaskText, maintenanceKind } from './machine-text.ts';

describe('maintText', () => {
  // What: a null or undefined slot (nothing to describe) renders as an empty string.
  // How: checks both null and undefined inputs.
  it('is empty for no slot', () => {
    expect(maintText(null)).toBe('');
    expect(maintText(undefined)).toBe('');
  });
  // What: a maintenance slot with both bounds set renders as "Wartung: <from> – <until>",
  // using the long German date format.
  // How: builds a bounded 'wartung' slot and checks the exact rendered label.
  it('formats a bounded Wartung slot', () => {
    const s = { type: 'wartung', from: '2021-01-04', until: '2021-01-06' };
    expect(maintText(s)).toBe(
      `Wartung: ${formatDateLong('2021-01-04')} – ${formatDateLong('2021-01-06')}`,
    );
  });
  // What: an open-ended slot (no from/until) renders "sofort" (immediately) / "unbegrenzt"
  // (indefinitely) instead of blank dates, and a 'defekt' type is labeled in lowercase.
  // How: builds a fully open-ended 'defekt' slot and checks the rendered label.
  it('uses sofort/unbegrenzt for open bounds and labels defekt', () => {
    expect(maintText({ type: 'defekt', from: '', until: '' })).toBe('defekt: sofort – unbegrenzt');
  });
  // What: a slot's optional note is appended in parentheses after the date range.
  // How: builds a slot with a note and checks it appears at the end of the rendered label.
  it('appends a note when present', () => {
    const s = { type: 'wartung', from: '2021-01-04', note: 'Kalibrierung' };
    expect(maintText(s)).toBe(
      `Wartung: ${formatDateLong('2021-01-04')} – unbegrenzt (Kalibrierung)`,
    );
  });
});

describe('statusRangeText', () => {
  // What: a machine with no maintenance slots at all renders an empty status text.
  // How: checks a bare machine (no `maint`) yields ''.
  it('is empty when the machine has no slots', () => {
    expect(statusRangeText({ id: 'm', name: 'M', group: 'g' }, '2021-06-01')).toBe('');
  });

  // What: when exactly one slot covers "today", its own text is shown with no "+N weitere" suffix.
  // How: gives a machine one slot that covers the given today and checks the plain maintText output.
  it('shows the slot covering today (single slot → no suffix)', () => {
    const m: Machine = {
      id: 'm',
      name: 'M',
      group: 'g',
      maint: [{ type: 'wartung', from: '2021-01-01', until: '2021-12-31' }],
    };
    expect(statusRangeText(m, '2021-06-01')).toBe(
      `Wartung: ${formatDateLong('2021-01-01')} – ${formatDateLong('2021-12-31')}`,
    );
  });

  // What: when no slot covers today, the earliest slot (by `from`, with a missing `from`
  // sorting as earliest of all) is shown instead, with a "+N weitere" (N more) suffix naming
  // how many other slots exist.
  // How: gives two slots neither covering today, with the open-ended one sorting first, and
  // checks the rendered text picks that one plus counts the other as "+1 weitere".
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
      `defekt: sofort – ${formatDateLong('2021-01-05')} · +1 weitere`,
    );
  });

  // What: the "earliest slot" pick doesn't depend on the array's own order — the same result
  // comes back whether the earliest slot is listed first or last.
  // How: repeats the previous test's scenario with the two slots' order reversed and checks
  // the exact same rendered output.
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
      `defekt: sofort – ${formatDateLong('2021-01-05')} · +1 weitere`,
    );
  });
});

describe('maintenanceKind', () => {
  // What: a date not covered by any slot resolves to null, not an empty-string type.
  // How: gives a machine one future slot and checks a query for an earlier date is null.
  it('is null when no slot covers the given date', () => {
    const m: Machine = {
      id: 'm',
      name: 'M',
      group: 'g',
      maint: [{ type: 'wartung', from: '2021-03-01' }],
    };
    expect(maintenanceKind(m, '2021-01-01')).toBeNull();
  });
  // What: for a covered date, the covering slot's own type string is returned.
  // How: gives a machine a 'defekt' slot covering the query date and checks the returned type.
  it("returns the covering slot's type", () => {
    const m: Machine = {
      id: 'm',
      name: 'M',
      group: 'g',
      maint: [{ type: 'defekt', from: '2021-01-01', until: '2021-01-31' }],
    };
    expect(maintenanceKind(m, '2021-01-15')).toBe('defekt');
  });
  // What: with no `today` argument given, it defaults to the real current date rather than
  // requiring the caller to always pass one.
  // How: calls with no date argument on a machine with no maintenance and checks the result
  // is null (can't assert a specific date since "now" isn't fixed, but this confirms the
  // default path runs without error).
  it('defaults `today` to now', () => {
    expect(maintenanceKind({ id: 'm', name: 'M', group: 'g' })).toBeNull();
  });
});

describe('daysMaskText', () => {
  const M = (days?: string): Machine => ({ id: 'm', name: 'M', group: 'g', days });
  // What: a missing mask, a malformed (wrong-length) mask, and an all-available mask all
  // render the same "jeden Tag" (every day) label.
  // How: checks undefined, a too-short string, and an all-'1' mask all render that label.
  it('is "jeden Tag" for absent, wrong-length, or all-on masks', () => {
    expect(daysMaskText(M(undefined))).toBe('jeden Tag');
    expect(daysMaskText(M('111'))).toBe('jeden Tag'); // wrong length
    expect(daysMaskText(M('1111111'))).toBe('jeden Tag');
  });
  // What: a genuinely partial mask lists the enabled weekdays by their German abbreviation.
  // How: checks a Mon-Fri mask lists five weekday abbreviations and a weekend-only mask lists
  // just Saturday and Sunday.
  it('lists the enabled weekdays', () => {
    expect(daysMaskText(M('1111100'))).toBe('Mo, Di, Mi, Do, Fr');
    expect(daysMaskText(M('0000011'))).toBe('Sa, So');
  });
  // What: a mask with every day off renders "keine Tage" (no days) rather than an empty list.
  // How: checks an all-'0' mask renders that specific label.
  it('is "keine Tage" when the mask is all-off', () => {
    expect(daysMaskText(M('0000000'))).toBe('keine Tage');
  });
});
