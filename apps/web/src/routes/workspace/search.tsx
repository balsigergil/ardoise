// SPDX-License-Identifier: AGPL-3.0-only
/** Full search page (PRODUCT §14): titles and content, filters, highlighted snippets. */
import type { MemberDto, Page, SearchResultsDto, TeamspaceDto } from '@ardoise/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageIcon } from '@/components/page-tree/page-icon';
import { searchPath, snippetParts, type SearchFilters } from '@/components/search/snippet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounced } from '@/editor/ui/search-queries';
import { api } from '@/lib/api';
import { myTeamspacesQuery } from '@/lib/queries';

const selectClass = 'h-8 rounded-md border bg-background px-2 text-sm';

export function SearchPage({
  workspaceId,
  initialQuery,
}: {
  workspaceId: string;
  initialQuery: string;
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<SearchFilters>({
    q: initialQuery,
    titleOnly: false,
    teamspaceId: '',
    createdBy: '',
    edited: '',
  });
  const q = useDebounced(filters.q.trim(), 250);
  const active = { ...filters, q };
  const results = useInfiniteQuery({
    queryKey: ['workspaces', workspaceId, 'search', active],
    queryFn: ({ pageParam }) =>
      api.get<SearchResultsDto>(searchPath(workspaceId, active, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: q.length > 0,
  });
  const teamspaces = useQuery(myTeamspacesQuery(workspaceId));
  const members = useQuery({
    queryKey: ['workspaces', workspaceId, 'members', 'mentions'],
    queryFn: () => api.get<Page<MemberDto>>(`/api/workspaces/${workspaceId}/members?limit=100`),
    staleTime: 5 * 60_000,
  });
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (patch: Partial<SearchFilters>) => setFilters((f) => ({ ...f, ...patch }));
  return (
    <div className="mx-auto grid max-w-3xl gap-4 px-6 py-8" data-testid="search-page">
      <h1 className="text-2xl font-semibold">{t('search.page.title')}</h1>
      <div className="flex items-center gap-2 rounded-md border px-3">
        <Search className="size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          autoFocus
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder={t('search.page.placeholder')}
          aria-label={t('search.page.placeholder')}
          className="border-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.titleOnly}
            onChange={(e) => set({ titleOnly: e.target.checked })}
          />
          {t('search.page.titleOnly')}
        </label>
        <select
          aria-label={t('search.page.teamspace')}
          className={selectClass}
          value={filters.teamspaceId}
          onChange={(e) => set({ teamspaceId: e.target.value })}
        >
          <option value="">{t('search.page.anyTeamspace')}</option>
          {(teamspaces.data?.items ?? []).map((ts: TeamspaceDto) => (
            <option key={ts.id} value={ts.id}>
              {ts.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('search.page.createdBy')}
          className={selectClass}
          value={filters.createdBy}
          onChange={(e) => set({ createdBy: e.target.value })}
        >
          <option value="">{t('search.page.anyone')}</option>
          {(members.data?.items ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('search.page.edited')}
          className={selectClass}
          value={filters.edited}
          onChange={(e) => set({ edited: e.target.value })}
        >
          <option value="">{t('search.page.anyTime')}</option>
          <option value="day">{t('search.page.lastDay')}</option>
          <option value="week">{t('search.page.lastWeek')}</option>
          <option value="month">{t('search.page.lastMonth')}</option>
          <option value="year">{t('search.page.lastYear')}</option>
        </select>
      </div>
      {!q && <p className="text-sm text-muted-foreground">{t('search.page.hint')}</p>}
      {q && results.isPending && <Skeleton className="h-20 w-full" />}
      {q && results.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('search.page.empty')}</p>
      )}
      <ul className="grid gap-1" data-testid="search-results">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to="/w/$workspaceId/p/$pageId"
              params={{ workspaceId, pageId: item.id }}
              className="grid gap-0.5 rounded-md px-3 py-2 hover:bg-accent"
            >
              <span className="flex items-center gap-2 font-medium">
                <PageIcon icon={item.icon} />
                <span className="truncate">{item.title || t('pages.untitled')}</span>
              </span>
              {item.path.length > 0 && (
                <span className="truncate text-xs text-muted-foreground">
                  {item.path.join(' / ')}
                </span>
              )}
              {item.snippet && (
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {snippetParts(item.snippet).map((part, i) =>
                    part.match ? (
                      <mark
                        key={i}
                        className="rounded-sm bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-500/30"
                      >
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {results.hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-start"
          onClick={() => void results.fetchNextPage()}
        >
          {t('search.page.more')}
        </Button>
      )}
    </div>
  );
}
