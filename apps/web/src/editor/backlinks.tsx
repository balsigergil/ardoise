// SPDX-License-Identifier: AGPL-3.0-only
/** Backlinks panel (ROADMAP M3): pages that link to or mention this one. */
import type { BacklinksDto } from '@ardoise/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageIcon } from '@/components/page-tree/page-icon';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

function backlinksQuery(workspaceId: string, pageId: string) {
  return {
    queryKey: ['workspaces', workspaceId, 'pages', pageId, 'backlinks'],
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      api.get<BacklinksDto>(
        `/api/workspaces/${workspaceId}/pages/${pageId}/backlinks?limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: BacklinksDto) => last.nextCursor,
  };
}

export function Backlinks({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const query = useInfiniteQuery(backlinksQuery(workspaceId, pageId));
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (!query.data || items.length === 0) return null;
  const count = items.length;
  return (
    <section
      className="mt-8 border-t pt-3"
      aria-label={t('editor.backlinks.title', { count })}
      data-testid="backlinks"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn('size-4 transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
        {t('editor.backlinks.title', { count })}
        {query.hasNextPage && '+'}
      </button>
      {open && (
        <ul className="mt-1 grid gap-0.5">
          {items.map((item) => (
            <li key={item.page.id}>
              <Link
                to="/w/$workspaceId/p/$pageId"
                params={{ workspaceId, pageId: item.page.id }}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
              >
                <PageIcon icon={item.page.icon} />
                <span className="truncate">{item.page.title || t('pages.untitled')}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {item.kinds
                    .map((k) =>
                      k === 'mention' ? t('editor.backlinks.mention') : t('editor.backlinks.link'),
                    )
                    .join(', ')}
                </span>
              </Link>
            </li>
          ))}
          {query.hasNextPage && (
            <Button
              variant="link"
              className="justify-self-start"
              onClick={() => void query.fetchNextPage()}
            >
              {t('editor.backlinks.more')}
            </Button>
          )}
        </ul>
      )}
    </section>
  );
}
