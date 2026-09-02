// The "Bereich" `<select>`'s `<optgroup>` structure (Phase 7 slice B6), shared by the All-
// Bookings modal (B5) and the machine form (B6) — both group their machine list by category
// via `groupsByCategory`, then render one `<optgroup>` per non-empty category. No `value` on
// each `<option>` (its value defaults to its text content, the group name), matching legacy's
// own markup so the enclosing `<select>`'s plain string `value` still just works.

import { CATEGORIES, type CategoryGroups } from '../../core/machines-queries.ts';

export function GroupOptions({ groupOptions }: { groupOptions: readonly CategoryGroups[] }) {
  return (
    <>
      {groupOptions.map(({ category, groups }) => (
        <optgroup
          key={category}
          label={CATEGORIES.find((c) => c.id === category)?.label ?? category}
        >
          {groups.map((group) => (
            <option key={group}>{group}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
