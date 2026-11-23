// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Quick find (PRODUCT §4, §14), Ctrl/Cmd+K: recent pages when the query is empty, else
 * title matches first, then content matches, then a link to the full search.
 */
import type { QuickFindItemDto, SearchResultsDto } from '@ardoise/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageIcon } from '@/components/page-tree/page-icon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { quickFindQuery, useDebounced } from '@/editor/ui/search-queries';
import { api } from '@/lib/api';
import { recentsQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

export function QuickFind({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const debounced = useDebounced(q.trim());
  const results = useQuery(quickFindQuery(workspaceId, debounced));
  const content = useQuery({
    queryKey: ['workspaces', workspaceId, 'quick-find-content', debounced],
    queryFn: () =>
      api.get<SearchResultsDto>(
        `/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(debounced)}&limit=5`,
      ),
    enabled: debounced.length > 0,
    staleTime: 10_000,
  });
  const recents = useQuery({ ...recentsQuery(workspaceId), enabled: !debounced });
  const titleItems = debounced ? (results.data?.items ?? []) : [];
  const seen = new Set(titleItems.map((i) => i.id));
  const contentItems = debounced ? (content.data?.items ?? []).filter((i) => !seen.has(i.id)) : [];
  const recentItems: QuickFindItemDto[] = debounced
    ? []
    : (recents.data?.items ?? [])
        .slice(0, 8)
        .map((r) => ({ id: r.page.id, title: r.page.title, icon: r.page.icon, path: [] }));
  const items: QuickFindItemDto[] = [...recentItems, ...titleItems, ...contentItems];
  const count = items.length + (q.trim() ? 1 : 0);
  const open = (pageId: string) => {
    onClose();
    void navigate({ to: '/w/$workspaceId/p/$pageId', params: { workspaceId, pageId } });
  };
  const fullSearch = () => {
    onClose();
    void navigate({
      to: '/w/$workspaceId/search',
      params: { workspaceId },
      search: { q: q.trim() },
    });
  };
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="gap-2 p-3 sm:max-w-lg" data-testid="quick-find">
        <DialogHeader>
          <DialogTitle className="sr-only">{t('search.quick.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('search.quick.hint')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus
            value={q}
            placeholder={t('search.quick.placeholder')}
            aria-label={t('search.quick.placeholder')}
            className="border-0 shadow-none focus-visible:ring-0"
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, count - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const item = items[index];
                if (item) open(item.id);
                else if (q.trim()) fullSearch();
              }
            }}
          />
        </div>
        <ul role="listbox" className="grid max-h-80 gap-0.5 overflow-y-auto">
          {!q.trim() && recentItems.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{t('search.quick.hint')}</li>
          )}
          {!q.trim() && recentItems.length > 0 && (
            <li className="px-2 pt-1 text-xs font-medium text-muted-foreground">
              {t('search.quick.recent')}
            </li>
          )}
          {debounced && !results.isFetching && !content.isFetching && items.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{t('search.quick.empty')}</li>
          )}
          {items.map((item, i) => (
            <li key={item.id}>
              {i === titleItems.length + recentItems.length && contentItems.length > 0 && (
                <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  {t('search.quick.inContent')}
                </p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                onClick={() => open(item.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                  i === index ? 'bg-accent' : 'hover:bg-accent/60',
                )}
              >
                <PageIcon icon={item.icon} />
                <span className="truncate">{item.title || t('pages.untitled')}</span>
                {item.path.length > 0 && (
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {item.path.join(' / ')}
                  </span>
                )}
              </button>
            </li>
          ))}
          {q.trim() && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={index === items.length}
                onClick={fullSearch}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground',
                  index === items.length ? 'bg-accent' : 'hover:bg-accent/60',
                )}
              >
                <Search className="size-4" aria-hidden="true" />
                {t('search.quick.fullSearch', { q: q.trim() })}
              </button>
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
