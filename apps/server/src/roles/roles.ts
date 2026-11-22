// SPDX-License-Identifier: AGPL-3.0-only
/** Process roles of the single image (ARCHITECTURE §2). */
export const roles = ['all', 'api', 'collab', 'worker'] as const;
export type Role = (typeof roles)[number];

export interface RoleFeatures {
  /** REST, sync and MCP endpoints, plus the static SPA. */
  api: boolean;
  /** Hocuspocus WebSocket server at /collab (M3). */
  collab: boolean;
  /** BullMQ job processors. */
  worker: boolean;
}

/** Every role serves /healthz and /readyz; this decides what else runs in the process. */
export function featuresForRole(role: Role): RoleFeatures {
  switch (role) {
    case 'all':
      return { api: true, collab: true, worker: true };
    case 'api':
      return { api: true, collab: false, worker: false };
    case 'collab':
      return { api: false, collab: true, worker: false };
    case 'worker':
      return { api: false, collab: false, worker: true };
  }
}
