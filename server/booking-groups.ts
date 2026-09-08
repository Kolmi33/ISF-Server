import { randomUUID } from 'node:crypto';

/** Creates a compact booking-group identifier within the persisted 40-character limit. */
export function createBookingGroupId(): string {
  return `g_${randomUUID().replaceAll('-', '')}`;
}
