// SPDX-License-Identifier: AGPL-3.0-only
import type { QuickFindDto } from '@ardoise/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function quickFindQuery(workspaceId: string, q: string, limit = 20) {
  return {
    queryKey: ['workspaces', workspaceId, 'quick-find', q, limit],
    queryFn: () =>
      api.get<QuickFindDto>(
        `/api/workspaces/${workspaceId}/search/quick?q=${encodeURIComponent(q)}&limit=${limit}`,
      ),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  };
}

/** Debounces a value (search inputs). */
export function useDebounced<T>(value: T, ms = 150): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return current;
}
