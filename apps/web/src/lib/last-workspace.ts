// SPDX-License-Identifier: AGPL-3.0-only
import { safeStorage } from '@/lib/storage';

export const LAST_WORKSPACE_KEY = 'ardoise.workspace';

export function rememberWorkspace(id: string): void {
  safeStorage.set(LAST_WORKSPACE_KEY, id);
}

/** The last opened workspace if the user still belongs to it, else the first one. */
export function pickWorkspace(
  workspaces: readonly { id: string }[],
  last: string | null,
): string | undefined {
  return workspaces.find((w) => w.id === last)?.id ?? workspaces[0]?.id;
}

export function lastWorkspace(): string | null {
  return safeStorage.get(LAST_WORKSPACE_KEY);
}
