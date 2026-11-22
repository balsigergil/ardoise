// SPDX-License-Identifier: AGPL-3.0-only
/** Trash (PRODUCT §5): search, restore, delete permanently. */
import type { PageDto, PageListDto } from '@ardoise/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageIcon } from '@/components/page-tree/page-icon';
import { api, pageQuery } from '@/lib/api';
import { pageTitle } from '@/lib/pages';
import { useMutate, useSyncStore } from '@/sync/hooks';
import { useErrorMessage } from '@/lib/form';

export function TrashDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const store = useSyncStore();
  const mutate = useMutate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [q, setQ] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [purging, setPurging] = useState<PageDto | null>(null);
  const queryKey = ['workspaces', store.workspaceId, 'trash', q.trim()];
  const trash = useInfiniteQuery({
    queryKey,
    enabled: open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<PageListDto>(
        `/api/workspaces/${store.workspaceId}/trash${pageQuery({ cursor: pageParam, q, limit: 50 })}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = trash.data?.pages.flatMap((p) => p.items) ?? [];
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
    await queryClient.invalidateQueries({ queryKey: ['workspaces', store.workspaceId, 'trash'] });
  };
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('trash.title')}</DialogTitle>
            <DialogDescription>{t('trash.description')}</DialogDescription>
          </DialogHeader>
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('trash.search')}
            aria-label={t('trash.search')}
          />
          {error !== null && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
          <ul
            className="max-h-[50vh] divide-y overflow-auto rounded-md border"
            data-testid="trash-list"
          >
            {items.length === 0 && (
              <li className="p-4 text-center text-sm text-muted-foreground">
                {trash.isLoading ? t('status.loading') : t('trash.empty')}
              </li>
            )}
            {items.map((page) => (
              <li key={page.id} className="flex items-center gap-2 px-3 py-2">
                <PageIcon icon={page.icon} />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/w/$workspaceId/p/$pageId"
                    params={{ workspaceId: store.workspaceId, pageId: page.id }}
                    className="block truncate text-sm font-medium hover:underline"
                    onClick={() => onOpenChange(false)}
                  >
                    {pageTitle(page, t('pages.untitled'))}
                  </Link>
                  {page.deletedAt && (
                    <span className="text-xs text-muted-foreground">
                      {t('trash.deletedAt', { date: date.format(new Date(page.deletedAt)) })}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('trash.restore')}
                  title={t('trash.restore')}
                  onClick={() => void run(() => mutate('page.restore', { id: page.id }))}
                >
                  <RotateCcw />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('trash.purge')}
                  title={t('trash.purge')}
                  onClick={() => setPurging(page)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {trash.hasNextPage && (
            <Button variant="outline" onClick={() => void trash.fetchNextPage()}>
              {t('pages.loadMore')}
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={purging !== null} onOpenChange={(o) => !o && setPurging(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trash.purgeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('trash.purgeDescription', {
                title: pageTitle(purging ?? undefined, t('pages.untitled')),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const page = purging;
                setPurging(null);
                if (page) void run(() => mutate('page.purge', { id: page.id }));
              }}
            >
              {t('trash.purge')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
