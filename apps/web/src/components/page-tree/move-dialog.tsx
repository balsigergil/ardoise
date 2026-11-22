// SPDX-License-Identifier: AGPL-3.0-only
/** "Move to": the keyboard- and touch-friendly alternative to drag and drop. */
import type { PageDto, PageParent } from '@ardoise/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/auth/session';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WorkspaceIcon } from '@/components/workspace-switcher';
import { pageTitle } from '@/lib/pages';
import { myTeamspacesQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useSyncContext } from '@/sync/context';
import { useSyncSelector } from '@/sync/hooks';
import { usePageActions } from './page-actions';
import { PageIcon } from './page-icon';
import {
  expansionKey,
  flattenChildren,
  isSelfOrAncestor,
  parentsToLoad,
  type TreeRow,
} from './tree-model';
import { useChildLoads } from './use-tree-state';

type Destination = { parent: PageParent; label: string };

export function MovePageDialog({ page, onClose }: { page: PageDto; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const { store, refreshToken } = useSyncContext();
  const teamspaceList = useQuery(myTeamspacesQuery(store.workspaceId)).data;
  const { loads, ensure } = useChildLoads(store, refreshToken);
  const actions = usePageActions();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Destination | null>(null);

  const roots = useMemo(
    (): { parent: PageParent; label: string; icon: string | null }[] => [
      ...(teamspaceList?.items ?? []).map((ts) => ({
        parent: { kind: 'teamspace' as const, id: ts.id },
        label: ts.name,
        icon: ts.icon,
      })),
      {
        parent: { kind: 'private' as const, id: me.id },
        label: t('sidebar.sections.private'),
        icon: null,
      },
    ],
    [teamspaceList, me.id, t],
  );

  const rows = useSyncSelector((s) => {
    const out: (
      TreeRow | { kind: 'root'; key: string; root: (typeof roots)[number]; open: boolean }
    )[] = [];
    for (const root of roots) {
      const key = `root:${root.parent.kind}:${root.parent.id}`;
      const open = expanded.has(key);
      out.push({ kind: 'root', key, root, open });
      if (open) out.push(...flattenChildren(s, root.parent, 1, 'move', expanded, loads));
    }
    return out;
  });

  const toLoad = useMemo(
    () => parentsToLoad(rows.filter((r): r is TreeRow => r.kind !== 'root')),
    [rows],
  );
  useEffect(() => ensure(toLoad), [toLoad, ensure]);

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const isSelected = (parent: PageParent) =>
    selected?.parent.kind === parent.kind && selected.parent.id === parent.id;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('pages.moveTitle', { title: pageTitle(page, t('pages.untitled')) })}
          </DialogTitle>
          <DialogDescription>{t('pages.moveHint')}</DialogDescription>
        </DialogHeader>
        <div
          className="max-h-[50vh] overflow-auto rounded-md border p-1"
          role="listbox"
          aria-label={t('pages.destinations')}
        >
          {rows.map((row) => {
            if (row.kind === 'root') {
              return (
                <div key={row.key} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex size-6 items-center justify-center rounded hover:bg-accent"
                    aria-label={row.open ? t('pages.collapse') : t('pages.expand')}
                    aria-expanded={row.open}
                    onClick={() => toggle(row.key)}
                  >
                    <ChevronRight
                      className={cn('size-3.5 transition-transform', row.open && 'rotate-90')}
                    />
                  </button>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected(row.root.parent)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent',
                      isSelected(row.root.parent) && 'bg-accent font-medium',
                    )}
                    onClick={() => setSelected({ parent: row.root.parent, label: row.root.label })}
                  >
                    {row.root.parent.kind === 'private' ? (
                      <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <WorkspaceIcon icon={row.root.icon} name={row.root.label} />
                    )}
                    <span className="truncate">{row.root.label}</span>
                  </button>
                </div>
              );
            }
            if (row.kind !== 'page')
              return (
                <p
                  key={row.key}
                  className="py-1 text-xs text-muted-foreground"
                  style={{ paddingLeft: 8 + row.depth * 16 }}
                >
                  {row.kind === 'loading'
                    ? t('status.loading')
                    : row.kind === 'more'
                      ? t('pages.loadMore')
                      : t('pages.noSubpages')}
                </p>
              );
            const disabled = isSelfOrAncestor(store, page.id, row.page.id);
            const target: PageParent = { kind: 'page', id: row.page.id };
            const title = pageTitle(row.page, t('pages.untitled'));
            return (
              <div
                key={row.key}
                className="flex items-center gap-1"
                style={{ paddingLeft: row.depth * 16 }}
              >
                <button
                  type="button"
                  className={cn(
                    'flex size-6 items-center justify-center rounded hover:bg-accent',
                    !row.expandable && 'invisible',
                  )}
                  aria-label={row.expanded ? t('pages.collapse') : t('pages.expand')}
                  onClick={() => toggle(expansionKey('move', row.page.id))}
                >
                  <ChevronRight
                    className={cn('size-3.5 transition-transform', row.expanded && 'rotate-90')}
                  />
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected(target)}
                  aria-disabled={disabled}
                  disabled={disabled}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent disabled:opacity-50',
                    isSelected(target) && 'bg-accent font-medium',
                  )}
                  onClick={() => setSelected({ parent: target, label: title })}
                >
                  <PageIcon icon={row.page.icon} />
                  <span className="truncate">{title}</span>
                </button>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!selected}
            onClick={() => {
              if (selected && actions.move(page, selected.parent)) onClose();
            }}
          >
            {selected ? t('pages.moveHere', { name: selected.label }) : t('pages.moveTo')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
