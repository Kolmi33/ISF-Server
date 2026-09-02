// api-machines-write.ts — Phase 9e: POST/PUT/DELETE /api/v1/machines[/:id], POST
// /api/v1/machines/:id/move. Every write here re-derives the FULL machine list (read all,
// apply one change in memory, hand the whole list to `mutate.ts`'s existing structural path)
// rather than adding a second write engine — `applyMutate`'s `applyStructural` already owns
// every validation/clamp/transaction/broadcast/log rule for a machine-list write (CLAUDE.md's
// "one authoritative server write path"), so routing through it here means these REST handlers
// don't re-implement — or risk drifting from — it. The in-memory reducers below mirror the
// client's own `core/machines.ts` (`saveMachine`/`deleteMachine`/`moveMachine`) field-for-field,
// the same way `model.ts`'s `blockReason`/`isDayAvailable` mirror rather than import them —
// server code never imports `web/js/*` (frontend/backend stay on their own sides of the wire
// contract in `shared/types.ts`; see ARCHITECTURE.md §5).
//
// Each handler reads the current list and re-writes it in one synchronous call (no `await` in
// between) — `db.ts`'s own note that "SQLite serialises writes for us" only holds because
// nothing else can run on Node's single thread between the read and the write.

import type { Db } from './db.js';
import { machineOut } from './model.js';
import { applyMutate, type Broadcast } from './mutate.js';
import { pickString, logOrDefault } from './api-write-helpers.js';
import type { MachineOut, MachineRow } from './types.js';
import type { ApiResponse } from './api-router.js';
import { apiSuccess, apiError } from './api-response.js';

/** The editable machine fields a REST create/update body may set — same fields the machine-edit
 *  form sends. `user`/`log` are the same generic pass-through fields `/api/mutate` itself
 *  accepts, so a REST write shows up in `GET /api/v1/activity` exactly like a grid write does. */
interface MachineWriteBody {
  name?: unknown;
  group?: unknown;
  cat?: unknown;
  info?: unknown;
  redu?: unknown;
  days?: unknown;
  maint?: unknown;
  user?: unknown;
  log?: unknown;
}

function asBody(body: unknown): MachineWriteBody {
  return (body && typeof body === 'object' ? body : {}) as MachineWriteBody;
}

function currentMachines(db: Db): MachineOut[] {
  return (
    db.prepare('SELECT * FROM machines ORDER BY sort, name').all() as unknown as MachineRow[]
  ).map(machineOut);
}

/** Apply the write body's fields onto `machine`, clearing the legacy single-status fields on
 *  every write — faithful port of `core/machines.ts`'s `applyFormFieldsToMachine` (its own
 *  comment explains why: `model.ts`'s `blockReason` prefers the structured `maint` slots
 *  precisely because every save already retires the old fields). `applyMutate`'s own
 *  `insertMachine`/`cleanMaint` still validate and clamp every field before it reaches the
 *  database — this only shapes the in-memory object handed to that existing path. */
function applyWriteFields(machine: MachineOut, body: MachineWriteBody): void {
  machine.name = String(body.name);
  machine.group = typeof body.group === 'string' ? body.group : null;
  machine.info = typeof body.info === 'string' ? body.info : '';
  if (body.redu) machine.redu = String(body.redu);
  else delete machine.redu;
  if (typeof body.days === 'string' && body.days) machine.days = body.days;
  else delete machine.days;
  if (Array.isArray(body.maint) && body.maint.length) machine.maint = body.maint;
  else delete machine.maint;
  delete machine.statusFrom;
  delete machine.statusUntil;
  machine.status = 'ok';
  machine.statusNote = '';
  if (body.cat === 'messtechnik') machine.cat = 'messtechnik';
  else delete machine.cat;
}

/** A short, deterministic hex digest of `input` (djb2 variant) — mirrors `core/machines.ts`'s
 *  `shortHash`, the id fallback for a name with no Latin-alphanumeric content to slug from. */
function shortHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/** Lowercase German umlaut/ß-aware slug, mirroring `core/machines.ts`'s `slugify` — the id a
 *  newly created machine gets, since a REST create body never supplies its own id. A name with
 *  no Latin-alphanumeric content (non-Latin script, or pure punctuation) falls back to a short
 *  hash of the name (`m_8f2a1c`) instead of a single id every such machine would collide into. */
function slugify(name: string): string {
  const transliterated = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  const slug = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug || `m_${shortHash(name)}`;
}

function findUniqueMachineId(machines: readonly MachineOut[], baseSlug: string): string {
  let candidateId = baseSlug;
  let suffix = 2;
  while (machines.some((machine) => machine.id === candidateId)) {
    candidateId = `${baseSlug}-${suffix}`;
    suffix++;
  }
  return candidateId;
}

/** Insert a new machine right after the last existing machine of the same group, so it stays
 *  grouped with its siblings — mirrors `core/machines.ts`'s `findGroupInsertionIndex`. */
function findGroupInsertionIndex(machines: readonly MachineOut[], group: string | null): number {
  for (let index = machines.length - 1; index >= 0; index--) {
    if (machines[index]!.group === group) return index + 1;
  }
  return machines.length;
}

/** Hand the whole (already-modified in memory) machine list to `applyMutate`'s structural path,
 *  translating a validation failure into a REST 400 — the one call every handler below ends
 *  with, so the transaction/broadcast/log/error-mapping logic lives in exactly one place. */
function writeStructural(
  db: Db,
  machines: MachineOut[],
  body: MachineWriteBody,
  fallbackLog: string,
  broadcast: Broadcast,
): ApiResponse | null {
  const result = applyMutate(
    db,
    { machines, user: pickString(body.user), log: logOrDefault(body.log, fallbackLog) },
    broadcast,
  );
  return result.error ? apiError(400, 'VALIDATION', result.error) : null;
}

/** `POST /api/v1/machines`. Body: `{name, group?, cat?, info?, redu?, days?, maint?}` — only
 *  `name` is required, everything else defaults the same way a brand-new machine-edit form
 *  would. 201 with the created machine's wire shape (including its generated `id`). */
export function createMachine(db: Db, body: unknown, broadcast: Broadcast): ApiResponse {
  const input = asBody(body);
  if (typeof input.name !== 'string' || !input.name.trim()) {
    return apiError(400, 'VALIDATION', 'Name fehlt.');
  }
  const machines = currentMachines(db);
  const newMachine = { id: findUniqueMachineId(machines, slugify(input.name)) } as MachineOut;
  applyWriteFields(newMachine, input);
  machines.splice(findGroupInsertionIndex(machines, newMachine.group), 0, newMachine);

  const failure = writeStructural(
    db,
    machines,
    input,
    `Maschine angelegt: ${newMachine.name} (REST)`,
    broadcast,
  );
  return failure ?? apiSuccess(newMachine, 201);
}

/** `PUT /api/v1/machines/:id`. Full replace of the editable fields (same all-at-once semantics
 *  as the machine-edit form's save, not a partial patch) — 404 if the id doesn't exist. */
export function updateMachine(
  db: Db,
  machineId: string,
  body: unknown,
  broadcast: Broadcast,
): ApiResponse {
  const input = asBody(body);
  if (typeof input.name !== 'string' || !input.name.trim()) {
    return apiError(400, 'VALIDATION', 'Name fehlt.');
  }
  const machines = currentMachines(db);
  const machine = machines.find((candidate) => candidate.id === machineId);
  if (!machine) return apiError(404, 'NOT_FOUND', `Maschine nicht gefunden: ${machineId}`);
  applyWriteFields(machine, input);

  const failure = writeStructural(
    db,
    machines,
    input,
    `Maschine bearbeitet: ${machine.name} (REST)`,
    broadcast,
  );
  return failure ?? apiSuccess(machine);
}

/** `DELETE /api/v1/machines/:id`. Removes the machine and (via `applyStructural`'s own orphan
 *  cleanup) all of its bookings. 404 if the id doesn't exist, 204 on success. */
export function deleteMachine(
  db: Db,
  machineId: string,
  body: unknown,
  broadcast: Broadcast,
): ApiResponse {
  const input = asBody(body);
  const machines = currentMachines(db);
  const index = machines.findIndex((candidate) => candidate.id === machineId);
  if (index < 0) return apiError(404, 'NOT_FOUND', `Maschine nicht gefunden: ${machineId}`);
  const [removed] = machines.splice(index, 1);

  const failure = writeStructural(
    db,
    machines,
    input,
    `Maschine gelöscht: ${removed!.name} (REST)`,
    broadcast,
  );
  return failure ?? apiSuccess(null, 204);
}

const STEP_BY_DIRECTION: Record<string, -1 | 1> = { up: -1, down: 1 };

/** `POST /api/v1/machines/:id/move`. Body: `{direction: "up"|"down"}` — swaps the machine with
 *  its neighbour within its own group (machines of one group are stored contiguously), mirroring
 *  `core/machines.ts`'s `moveMachine`. 404 for an unknown id; 409 `CONFLICT` when the move would
 *  run off the list or cross into a different group (there's nothing wrong with the request, the
 *  machine's current position just can't move that way right now). */
export function moveMachine(
  db: Db,
  machineId: string,
  body: unknown,
  broadcast: Broadcast,
): ApiResponse {
  const input = asBody(body) as MachineWriteBody & { direction?: unknown };
  const step = typeof input.direction === 'string' ? STEP_BY_DIRECTION[input.direction] : undefined;
  if (step === undefined)
    return apiError(400, 'VALIDATION', "direction muss 'up' oder 'down' sein.");

  const machines = currentMachines(db);
  const currentIndex = machines.findIndex((machine) => machine.id === machineId);
  if (currentIndex < 0) return apiError(404, 'NOT_FOUND', `Maschine nicht gefunden: ${machineId}`);
  const neighbourIndex = currentIndex + step;
  const runsOffTheList = neighbourIndex < 0 || neighbourIndex >= machines.length;
  if (runsOffTheList || machines[currentIndex]!.group !== machines[neighbourIndex]!.group) {
    return apiError(409, 'CONFLICT', 'Kann nicht in diese Richtung verschoben werden.');
  }
  [machines[currentIndex], machines[neighbourIndex]] = [
    machines[neighbourIndex]!,
    machines[currentIndex]!,
  ];

  const failure = writeStructural(db, machines, input, 'Reihenfolge geändert (REST)', broadcast);
  return failure ?? apiSuccess({ movedId: machineId, direction: input.direction });
}
