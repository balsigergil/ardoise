// SPDX-License-Identifier: AGPL-3.0-only
import type {
  EntityMap,
  EntityType,
  MutationInput,
  MutationName,
  PageDto,
  PageParent,
} from '@ardoise/shared';
import type { SyncStore } from '@ardoise/sync';
import { useCallback, useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';
import { useSyncContext } from './context';

export function useSyncStore(): SyncStore {
  return useSyncContext().store;
}

/** Re-renders on store changes and returns `select(store)`. Keep selectors cheap. */
export function useSyncSelector<T>(select: (store: SyncStore) => T): T {
  const store = useSyncStore();
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return select(store);
}

export function useEntity<T extends EntityType>(
  type: T,
  id: string | undefined,
): EntityMap[T] | undefined {
  return useSyncSelector((s) => (id ? s.get(type, id) : undefined));
}

export function useChildren(parent: PageParent): PageDto[] {
  return useSyncSelector((s) => s.children(parent));
}

/**
 * Returns a function that queues a mutation (applied optimistically) and resolves once
 * the server applied it, or rejects with an `ApiError` carrying the rejection code.
 */
export function useMutate() {
  const store = useSyncStore();
  return useCallback(
    async <N extends MutationName>(name: N, input: MutationInput[N]): Promise<void> => {
      const queued = store.mutate(name, input);
      if (!queued.ok) throw new ApiError(409, queued.code);
      const result = await store.settled(queued.id);
      if (result.status === 'rejected')
        throw new ApiError(409, (result.code ?? 'internal_error') as never);
    },
    [store],
  );
}
