// SPDX-License-Identifier: AGPL-3.0-only
/** A dialog to pick a page through quick find (link to page, move blocks to). */
import type { QuickFindItemDto } from '@ardoise/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageIcon } from '@/components/page-tree/page-icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { quickFindQuery, useDebounced } from './search-queries';

export function PagePicker({
  workspaceId,
  title,
  exclude,
  onPick,
  onClose,
}: {
  workspaceId: string;
  title: string;
  exclude?: string;
  onPick: (page: QuickFindItemDto) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const debounced = useDebounced(q);
  const results = useQuery(quickFindQuery(workspaceId, debounced));
  const items = (results.data?.items ?? []).filter((i) => i.id !== exclude);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-2 p-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          placeholder={t('search.quick.placeholder')}
          aria-label={t('search.quick.placeholder')}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, items.length - 1));
            if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
            if (e.key === 'Enter' && items[index]) onPick(items[index]);
          }}
        />
        <ul className="grid max-h-72 gap-0.5 overflow-y-auto" role="listbox">
          {debounced && items.length === 0 && !results.isFetching && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{t('search.quick.empty')}</li>
          )}
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                onClick={() => onPick(item)}
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
        </ul>
      </DialogContent>
    </Dialog>
  );
}
