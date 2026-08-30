// The admin (Verwalten) list view model (Phase 4.3). The modal's add/edit/reorder wiring, the
// per-row status/maintenance badges and the row markup stay in the legacy adapter; what moves here
// is the pure list kernel: order the machines (manual = source order, or by name / by group→name)
// and filter them by a case-insensitive search over "name group". Faithful port of the admin
// `renderList` head; the machines and the (DOM-read) sort/query are injected (E4).

import type { Machine } from '../../../../shared/types.ts';

/** The admin sort dropdown values. `manual` keeps the machines' stored order. */
export type AdminSort = 'manual' | 'name' | 'group';

/**
 * Order and filter the machine list for the admin modal. `sort` is `name` (A–Z, German collation),
 * `group` (by group then name), or anything else = `manual` (stored order). `query` matches a
 * case-insensitive substring of `"<name> <group>"`. Returns a new array. Faithful to legacy.
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
