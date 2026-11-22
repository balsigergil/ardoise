// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@ardoise/shared';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { api, pageQuery } from '@/lib/api';

export const PAGE_SIZE = 50;

/** Cursor-paginated list: loads one page at a time (CLAUDE.md §1.3). */
export function usePagedList<T>(queryKey: QueryKey, path: string, q?: string) {
  return useInfiniteQuery({
    queryKey: [...queryKey, { q: q ?? '' }],
    queryFn: ({ pageParam }) => {
      const query = pageQuery({ cursor: pageParam, limit: PAGE_SIZE, q });
      return api.get<Page<T>>(`${path}${query}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
