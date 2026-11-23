// SPDX-License-Identifier: AGPL-3.0-only
import type { CollabUser } from '@ardoise/shared';

export interface PresentUser extends CollabUser {
  self: boolean;
}

/** One entry per person (a user with two tabs shows once), the current user first. */
export function presentUsers(
  states: Map<number, Record<string, unknown>>,
  selfClientId: number,
): PresentUser[] {
  const byId = new Map<string, PresentUser>();
  for (const [clientId, state] of states) {
    const user = state['user'] as Partial<CollabUser> | undefined;
    if (!user?.id || !user.name) continue;
    const self = clientId === selfClientId;
    const existing = byId.get(user.id);
    if (!existing || self)
      byId.set(user.id, {
        id: user.id,
        name: user.name,
        color: user.color ?? '#888',
        self: self || !!existing?.self,
      });
  }
  return [...byId.values()].sort(
    (a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name),
  );
}
