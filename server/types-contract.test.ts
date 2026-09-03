import { describe, it, expect } from 'vitest';
import type { Machine, Booking, ServerData } from '../shared/types.ts';
import type { MachineOut, BookingOut, StateOut } from './types.ts';

// A compile-time (not runtime) tripwire. `shared/types.ts` describes the wire contract the
// frontend trusts (Machine/Booking/ServerData); `server/types.ts` independently declares
// the shapes the backend actually emits (MachineOut/BookingOut/StateOut) -- the backend
// doesn't import shared/types.ts at all (a deliberate build-boundary decision, see
// ARCHITECTURE_AUDIT.md F7: the two are different compile targets with no shared runtime
// module today). That means nothing catches the two drifting apart if a field is renamed,
// added, or removed on one side and not the other -- except this file: if that happens,
// `tsc --noEmit` (part of `npm run verify`) fails right here, at the point of drift,
// instead of only being discoverable by comparing both files by eye.
//
// Deliberately checks field NAMES only, not exact types -- e.g. Machine.group: string vs.
// MachineOut.group: string | null, and several required-on-the-wire fields that are
// optional on Machine, are known, already-reviewed differences (the DB layer can hand back
// a null group; the wire always fills in a default), not bugs worth failing this check over.
type KeysMatch<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : ['field(s) missing from the left-hand type', Exclude<keyof B, keyof A>]
  : ['field(s) missing from the right-hand type', Exclude<keyof A, keyof B>];

// If any of these three stop being exactly `true`, the mismatched key(s) appear directly in
// the resulting type error (a wrong-shaped tuple can't be assigned to `true` below).
type MachineKeysMatch = KeysMatch<Machine, MachineOut>;
type BookingKeysMatch = KeysMatch<Booking, BookingOut>;
// ServerData carries client-only fields (`revision`, `log`) the wire never sends, and `rev`
// is spelled/typed slightly differently on each side by design (optional-on-wire vs.
// always-present) -- compare only the fields both sides are meant to agree on verbatim.
type ServerDataWireShape = Pick<ServerData, 'groups' | 'machines' | 'bookings'>;
type StateOutWireShape = Pick<StateOut, 'groups' | 'machines' | 'bookings'>;
type StateKeysMatch = KeysMatch<ServerDataWireShape, StateOutWireShape>;

describe('shared/types.ts vs server/types.ts — wire-shape field-name contract', () => {
  // What: shared/types.ts's client-trusted wire shapes and server/types.ts's independently-
  // declared emitted shapes still agree on field names, even though the backend never
  // imports shared/types.ts to enforce that structurally.
  // How: the real check already happened at compile time via the KeysMatch type aliases
  // above — if any of them stopped being exactly `true`, this file would fail to type-check
  // before ever reaching a runtime assertion. This body just confirms the file actually ran.
  it('every field name on the wire matches (the real check is the types above)', () => {
    // These assignments ARE the check: TypeScript rejects them at compile time the moment
    // any of the three type aliases above stop being exactly `true`. There is nothing to
    // assert at runtime beyond confirming the file itself ran.
    const machineFieldsMatch: MachineKeysMatch = true;
    const bookingFieldsMatch: BookingKeysMatch = true;
    const stateFieldsMatch: StateKeysMatch = true;
    expect([machineFieldsMatch, bookingFieldsMatch, stateFieldsMatch]).toEqual([true, true, true]);
  });
});
