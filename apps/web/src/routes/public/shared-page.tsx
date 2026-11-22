// SPDX-License-Identifier: AGPL-3.0-only
/** Public link page (PRODUCT §5): read-only, anonymous, never indexed. */
import type { PublicChildrenDto, PublicPageDto } from '@ardoise/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PageIcon } from '@/components/page-tree/page-icon';
import { Skeleton } from '@/components/ui/skeleton';
import { api, pageQuery } from '@/lib/api';
import { pageTitle } from '@/lib/pages';
import { cn } from '@/lib/utils';
import { coverClass } from '@/lib/covers';

/** Adds `<meta name="robots" content="noindex">` while mounted (the server also sends X-Robots-Tag). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

export function SharedPage({ token, pageId }: { token: string; pageId?: string | undefined }) {
  const { t } = useTranslation();
  useNoIndex();
  const base = `/api/public/${encodeURIComponent(token)}`;
  const page = useQuery({
    queryKey: ['public', token, pageId ?? 'root'],
    queryFn: () => api.get<PublicPageDto>(pageId ? `${base}/pages/${pageId}` : base),
    retry: false,
  });
  const children = useQuery({
    queryKey: ['public', token, pageId ?? 'root', 'children'],
    queryFn: () =>
      api.get<PublicChildrenDto>(
        `${base}/pages/${page.data!.page.id}/children${pageQuery({ limit: 100 })}`,
      ),
    enabled: !!page.data?.page.hasChildren,
  });

  useEffect(() => {
    if (page.data) document.title = pageTitle(page.data.page, t('pages.untitled'));
  }, [page.data, t]);

  if (page.error)
    return (
      <main className="mx-auto grid max-w-md gap-2 px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">{t('share.publicUnavailable')}</h1>
        <p className="text-sm text-muted-foreground">{t('share.publicUnavailableHint')}</p>
      </main>
    );
  if (!page.data)
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <Skeleton className="h-10 w-2/3" />
      </main>
    );

  const { page: p, ancestors, rootId } = page.data;
  return (
    <main
      className={cn(
        'min-h-svh bg-background pb-16',
        { serif: 'font-serif', mono: 'font-mono', default: '' }[p.font],
      )}
      data-testid="public-page"
    >
      {ancestors.length > 0 && (
        <nav
          aria-label={t('pages.breadcrumb')}
          className="flex items-center gap-1 border-b px-4 py-2 text-sm text-muted-foreground"
        >
          {ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <Link
                to="/share/$token"
                params={{ token }}
                search={a.id === rootId ? {} : { page: a.id }}
                className="truncate hover:underline"
              >
                {pageTitle(a, t('pages.untitled'))}
              </Link>
              <ChevronRight className="size-3" aria-hidden="true" />
            </span>
          ))}
          <span className="truncate text-foreground">{pageTitle(p, t('pages.untitled'))}</span>
        </nav>
      )}
      {p.cover && <div className={cn('h-40 w-full', coverClass(p.cover))} />}
      <div className={cn('mx-auto px-6 sm:px-12', p.width === 'full' ? 'max-w-none' : 'max-w-3xl')}>
        {p.icon && (
          <div className={cn('text-6xl leading-none', p.cover ? '-mt-8' : 'mt-12')}>
            {p.icon.value}
          </div>
        )}
        <h1 className={cn('text-4xl font-bold', p.icon ? 'mt-4' : 'mt-12')}>
          {pageTitle(p, t('pages.untitled'))}
        </h1>
        {children.data && children.data.items.length > 0 && (
          <ul className="mt-8 grid gap-0.5">
            {children.data.items.map((c) => (
              <li key={c.id}>
                <Link
                  to="/share/$token"
                  params={{ token }}
                  search={{ page: c.id }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <PageIcon icon={c.icon} />
                  <span className="truncate">{pageTitle(c, t('pages.untitled'))}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-12 text-xs text-muted-foreground">{t('share.publicFooter')}</p>
      </div>
    </main>
  );
}
