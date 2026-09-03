// =======================================================================================
// GROUP OPTIONS COMPONENT (web/js/ui/components/GroupOptions.tsx)
// =======================================================================================
//
// The "Bereich" `<select>`'s `<optgroup>` structure, shared by the All Bookings modal and
// the machine form — both group their machine list by category via `groupsByCategory`,
// then render one `<optgroup>` per non-empty category.
//
// Key Principles:
// - NO EXPLICIT `value` ON EACH `<option>`: an option's value defaults to its own text
//   content (the group name), so the enclosing `<select>`'s plain string `value` just works
//   without this component needing to pass a separate value prop through.
//
// =======================================================================================

import { CATEGORIES, type CategoryGroups } from '../../core/machines.ts';

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
