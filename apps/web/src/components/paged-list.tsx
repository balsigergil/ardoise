// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { usePagedList } from '@/hooks/use-paged-list';

export function PagedList<T>({
  list,
  render,
  empty,
}: {
  list: ReturnType<typeof usePagedList<T>>;
  render: (items: T[]) => ReactNode;
  empty: string;
}) {
  const { t } = useTranslation();
  if (list.isPending) return <Skeleton className="h-24 w-full" />;
  if (list.error) return <FormError error={list.error} />;
  const items = list.data.pages.flatMap((p) => p.items);
  if (items.length === 0)
    return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="grid gap-3">
      {render(items)}
      {list.hasNextPage && (
        <Button
          variant="outline"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {t('common.loadMore')}
        </Button>
      )}
    </div>
  );
}
