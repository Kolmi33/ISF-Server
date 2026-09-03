// =======================================================================================
// ADMIN VIEW MODEL MODULE (web/js/ui/views/admin.ts)
// =======================================================================================
//
// The admin (Verwalten) list's pure view-model kernel: orders the machines (manual = source
// order, or by name / by group→name) and filters them by a case-insensitive search over
// "name group".
//
// =======================================================================================

import type { Machine } from '../../../../shared/types.ts';

/** The admin sort dropdown values. `manual` keeps the machines' stored order. */
export type AdminSort = 'manual' | 'name' | 'group';

/**
 * Orders and filters the machine list for the admin modal. `sort` is `name` (A–Z, German
 * collation), `group` (by group then name), or anything else = `manual` (stored order).
 * `query` matches a case-insensitive substring of `"<name> <group>"`. Returns a new array.
 */
export function filterAdminMachines(
  machines: readonly Machine[],
  sort: string,
  query: string,
): Machine[] {
  const lowercaseQuery = query.toLowerCase();
  const rows = machines.slice();
  if (sort === 'name') {
    rows.sort((machineA, machineB) => machineA.name.localeCompare(machineB.name, 'de'));
  } else if (sort === 'group') {
    rows.sort(
      (machineA, machineB) =>
        (machineA.group || '').localeCompare(machineB.group || '', 'de') ||
        machineA.name.localeCompare(machineB.name, 'de'),
    );
  }
  return rows.filter((machine) =>
    (machine.name + ' ' + machine.group).toLowerCase().includes(lowercaseQuery),
  );
}
