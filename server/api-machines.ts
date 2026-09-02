// api-machines.ts — Phase 9b: GET /api/v1/machines, GET /api/v1/machines/:id. The first two
// real /api/v1/* endpoints — read-only, so no write-path risk. Reuses `model.ts`'s existing
// `machineOut` wire mapper: a REST machine is the exact same shape `/api/state` already emits,
// not a new contract to maintain in parallel.

import type { Db } from './db.js';
import { machineOut } from './model.js';
import type { MachineOut, MachineRow } from './types.js';
import type { ApiResponse } from './api-router.js';
import { apiSuccess, apiError } from './api-response.js';

function allMachineRows(db: Db): MachineRow[] {
  return db.prepare('SELECT * FROM machines ORDER BY sort, name').all() as unknown as MachineRow[];
}

/** A machine's category the way the wire shape expresses it: `cat` absent means 'maschine'
 *  (mirrors the client's own `core/machines.ts` `getMachineCategory` convention). */
function categoryOfOut(machine: MachineOut): string {
  return machine.cat === 'messtechnik' ? 'messtechnik' : 'maschine';
}

/**
 * `GET /api/v1/machines`. Supports `?category=`, `?group=`, `?status=` filters (all exact-match,
 * combinable) and `?sort=name` (German collation; omitted or any other value keeps the DB's own
 * `sort, name` order — the same order Admin's manual-sort mode uses). The list is small enough
 * (low hundreds) that no pagination is offered yet.
 */
export function listMachines(db: Db, url: URL): ApiResponse {
  const category = url.searchParams.get('category');
  const group = url.searchParams.get('group');
  const status = url.searchParams.get('status');

  let machines = allMachineRows(db).map(machineOut);
  if (category) machines = machines.filter((machine) => categoryOfOut(machine) === category);
  if (group) machines = machines.filter((machine) => machine.group === group);
  if (status) machines = machines.filter((machine) => machine.status === status);
  if (url.searchParams.get('sort') === 'name') {
    machines = [...machines].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  return apiSuccess(machines);
}

/** `GET /api/v1/machines/:id`. 404 `NOT_FOUND` (naming the id) when it doesn't exist. */
export function getMachine(db: Db, machineId: string): ApiResponse {
  const row = db.prepare('SELECT * FROM machines WHERE id=?').get(machineId) as
    MachineRow | undefined;
  if (!row) return apiError(404, 'NOT_FOUND', `Maschine nicht gefunden: ${machineId}`);
  return apiSuccess(machineOut(row));
}
