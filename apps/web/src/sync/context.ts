// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncStore } from '@ardoise/sync';
import { createContext, use } from 'react';

export interface SyncContextValue {
  store: SyncStore;
  /** Bumped when cached lists must be refetched (access changes, resync). */
  refreshToken: number;
}

export const SyncContext = createContext<SyncContextValue | null>(null);

export function useSyncContext(): SyncContextValue {
  const value = use(SyncContext);
  if (!value) throw new Error('useSyncContext must be used inside <SyncProvider>');
  return value;
}

export function useOptionalSync(): SyncContextValue | null {
  return use(SyncContext);
}
