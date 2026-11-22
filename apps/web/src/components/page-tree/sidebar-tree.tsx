// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sidebar sections (PRODUCT §4): Favorites, Teamspaces, Shared, Private. One flat,
 * virtualized list of rows; trees load one level at a time; native drag and drop.
 */
import type { PageDto, PageParent, TeamspaceDto } from '@ardoise/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronRight,
  Copy,
  FolderInput,
  Loader2,
  MoreHorizontal,
  Plus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/auth/session';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarContent } from '@/components/ui/sidebar';
import { WorkspaceIcon } from '@/components/workspace-switcher';
import { loadFavorites, loadShared, pageTitle } from '@/lib/pages';
import { myTeamspacesQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useSyncContext } from '@/sync/context';
import { useSyncSelector } from '@/sync/hooks';
import { MovePageDialog } from './move-dialog';
import { usePageActions } from './page-actions';
import { PageIcon } from './page-icon';
import {
  computeDrop,
  computeRootDrop,
  dropZone,
  flattenChildren,
  flattenPages,
  parentsToLoad,
  type DropZone,
  type TreeRow,
} from './tree-model';
import { useChildLoads, useExpanded } from './use-tree-state';

export const ROW_HEIGHT = 30;
const DRAG_TYPE = 'application/x-ardoise-page';

type Section = 'favorites' | 'teamspaces' | 'shared' | 'private';

type SidebarRow =
  | TreeRow
  | { kind: 'section'; key: string; section: Section; root?: PageParent }
  | { kind: 'sectionEmpty'; key: string; section: Section }
  | { kind: 'teamspace'; key: string; teamspace: TeamspaceDto; expanded: boolean };

interface DragState {
  pageId: string;
  over?: { key: string; zone: DropZone | 'root' };
}

export function SidebarTree({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const { store, refreshToken } = useSyncContext();
  const { expanded, toggle } = useExpanded(workspaceId);
  const { loads, ensure, more, retry, loadAll } = useChildLoads(store, refreshToken);
  const actions = usePageActions();
  const teamspaces = useQuery(myTeamspacesQuery(workspaceId)).data?.items ?? [];
  const [shared, setShared] = useState<{ ids: string[]; next: string | null }>({
    ids: [],
    next: null,
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [moving, setMoving] = useState<PageDto | null>(null);
  const activePageId = useParams({ strict: false }).pageId;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadFavorites(store).catch(() => undefined);
    void loadShared(store, null)
      .then((list) => setShared({ ids: list.items.map((p) => p.id), next: list.nextCursor }))
      .catch(() => undefined);
  }, [store, refreshToken]);

  const privateRoot: PageParent = { kind: 'private', id: me.id };

  const rows = useSyncSelector((s): SidebarRow[] => {
    const out: SidebarRow[] = [];
    const favorites = s
      .all('favorite')
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
      .map((f) => s.get('page', f.pageId))
      .filter((p): p is PageDto => !!p && !s.isTrashed(p.id));
    out.push({ kind: 'section', key: 'favorites', section: 'favorites' });
    if (favorites.length === 0)
      out.push({ kind: 'sectionEmpty', key: 'favorites:empty', section: 'favorites' });
    else out.push(...flattenPages(s, favorites, 'fav', expanded, loads));

    out.push({ kind: 'section', key: 'teamspaces', section: 'teamspaces' });
    if (teamspaces.length === 0)
      out.push({ kind: 'sectionEmpty', key: 'teamspaces:empty', section: 'teamspaces' });
    for (const ts of teamspaces) {
      const isOpen = !expanded.has(`ts-closed:${ts.id}`);
      out.push({ kind: 'teamspace', key: `ts:${ts.id}`, teamspace: ts, expanded: isOpen });
      if (isOpen)
        out.push(...flattenChildren(s, { kind: 'teamspace', id: ts.id }, 1, 'ts', expanded, loads));
    }

    const sharedPages = shared.ids
      .map((id) => s.get('page', id))
      .filter((p): p is PageDto => !!p && !s.isTrashed(p.id));
    out.push({ kind: 'section', key: 'shared', section: 'shared' });
    if (sharedPages.length === 0)
      out.push({ kind: 'sectionEmpty', key: 'shared:empty', section: 'shared' });
    else out.push(...flattenPages(s, sharedPages, 'shared', expanded, loads));

    out.push({ kind: 'section', key: 'private', section: 'private', root: privateRoot });
    out.push(...flattenChildren(s, privateRoot, 0, 'private', expanded, loads));
    return out;
  });

  const toLoad = useMemo(
    () => parentsToLoad(rows.filter((r): r is TreeRow => 'scope' in r)),
    [rows],
  );
  useEffect(() => ensure(toLoad), [toLoad, ensure]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is used as documented
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialRect: { width: 240, height: 900 },
    getItemKey: (i) => rows[i]!.key,
  });

  // --- drag and drop ----------------------------------------------------------------

  const onDragStart = (e: DragEvent, page: PageDto) => {
    e.dataTransfer.setData(DRAG_TYPE, page.id);
    e.dataTransfer.effectAllowed = 'move';
    setDrag({ pageId: page.id });
  };
  const onDragOver = (e: DragEvent, key: string, zone: DropZone | 'root') => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (drag.over?.key !== key || drag.over.zone !== zone)
      setDrag({ ...drag, over: { key, zone } });
  };
  const finishDrop = async (
    target: { page: PageDto; zone: DropZone; scope: string } | { root: PageParent },
  ) => {
    const dragged = drag ? store.get('page', drag.pageId) : undefined;
    setDrag(null);
    if (!dragged) return;
    if ('root' in target) {
      const drop = computeRootDrop(store, dragged.id, target.root);
      actions.move(dragged, drop.parent, drop.position);
      return;
    }
    if (target.zone === 'inside')
      await loadAll({ kind: 'page', id: target.page.id }).catch(() => undefined);
    const drop = computeDrop(store, dragged.id, target.page, target.zone);
    if (!drop) return;
    actions.move(dragged, drop.parent, drop.position);
    if (target.zone === 'inside') toggle(target.scope, target.page.id, true);
  };

  // --- rendering ----------------------------------------------------------------------

  const renderRow = (row: SidebarRow) => {
    switch (row.kind) {
      case 'section':
        return (
          <div
            className={cn(
              'group/section flex h-full items-center gap-1 px-2 pt-2 text-xs font-medium text-sidebar-foreground/70',
              drag?.over?.key === row.key && 'bg-sidebar-accent',
            )}
            data-testid={`sidebar-section-${row.section}`}
            onDragOver={row.root ? (e) => onDragOver(e, row.key, 'root') : undefined}
            onDrop={
              row.root
                ? (e) => (e.preventDefault(), void finishDrop({ root: row.root! }))
                : undefined
            }
          >
            <span className="flex-1 truncate">{t(`sidebar.sections.${row.section}`)}</span>
            {row.root && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100"
                aria-label={t('pages.newPrivate')}
                onClick={() => actions.create(row.root!)}
              >
                <Plus />
              </Button>
            )}
          </div>
        );
      case 'sectionEmpty':
        return (
          <p className="flex h-full items-center px-3 text-xs text-muted-foreground">
            {t(`sidebar.empty.${row.section}`)}
          </p>
        );
      case 'teamspace': {
        const root: PageParent = { kind: 'teamspace', id: row.teamspace.id };
        return (
          <div
            className={cn(
              'group/row flex h-full items-center gap-1 rounded-md px-1 text-sm hover:bg-sidebar-accent',
              drag?.over?.key === row.key && 'ring-2 ring-sidebar-ring',
            )}
            onDragOver={(e) => onDragOver(e, row.key, 'root')}
            onDrop={(e) => (e.preventDefault(), void finishDrop({ root }))}
          >
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded hover:bg-sidebar-accent-foreground/10"
              aria-label={row.expanded ? t('pages.collapse') : t('pages.expand')}
              aria-expanded={row.expanded}
              onClick={() => toggle('ts-closed', row.teamspace.id)}
            >
              <ChevronRight
                className={cn('size-3.5 transition-transform', row.expanded && 'rotate-90')}
              />
            </button>
            <Link
              to="/w/$workspaceId/teamspaces/$teamspaceId"
              params={{ workspaceId, teamspaceId: row.teamspace.id }}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <WorkspaceIcon icon={row.teamspace.icon} name={row.teamspace.name} />
              <span className="truncate font-medium">{row.teamspace.name}</span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
              aria-label={t('pages.newIn', { name: row.teamspace.name })}
              onClick={() => actions.create(root)}
            >
              <Plus />
            </Button>
          </div>
        );
      }
      case 'loading':
        return (
          <div
            className="flex h-full items-center gap-2 text-xs text-muted-foreground"
            style={{ paddingLeft: indent(row.depth) }}
          >
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            <span>{t('status.loading')}</span>
          </div>
        );
      case 'empty':
        return (
          <p
            className="flex h-full items-center text-xs text-muted-foreground"
            style={{ paddingLeft: indent(row.depth) }}
          >
            {row.parent.kind === 'page' ? t('pages.noSubpages') : t('pages.noPages')}
          </p>
        );
      case 'error':
        return (
          <button
            type="button"
            className="flex h-full items-center text-xs text-destructive underline"
            style={{ paddingLeft: indent(row.depth) }}
            onClick={() => retry(row.parent)}
          >
            {t('pages.loadFailed')}
          </button>
        );
      case 'more':
        return (
          <button
            type="button"
            className="flex h-full items-center text-xs text-muted-foreground hover:underline"
            style={{ paddingLeft: indent(row.depth) }}
            onClick={() => more(row.parent)}
          >
            {t('pages.loadMore')}
          </button>
        );
      case 'page':
        return renderPage(row);
    }
  };

  const renderPage = (row: Extract<SidebarRow, { kind: 'page' }>) => {
    const { page } = row;
    const isFavorite = !!store.get('favorite', page.id);
    const over = drag?.over?.key === row.key ? drag.over.zone : undefined;
    const title = pageTitle(page, t('pages.untitled'));
    return (
      <div
        className={cn(
          'group/row relative flex h-full items-center gap-1 rounded-md pr-1 text-sm hover:bg-sidebar-accent',
          activePageId === page.id && 'bg-sidebar-accent font-medium',
          over === 'inside' && 'ring-2 ring-sidebar-ring',
          drag?.pageId === page.id && 'opacity-50',
        )}
        style={{ paddingLeft: indent(row.depth) }}
        draggable
        onDragStart={(e) => onDragStart(e, page)}
        onDragEnd={() => setDrag(null)}
        onDragOver={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onDragOver(e, row.key, dropZone(e.clientY - rect.top, rect.height || ROW_HEIGHT));
        }}
        onDrop={(e) => {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          void finishDrop({
            page,
            scope: row.scope,
            zone: dropZone(e.clientY - rect.top, rect.height || ROW_HEIGHT),
          });
        }}
        data-testid="tree-row"
        data-page-id={page.id}
      >
        {over === 'before' && <span className="absolute inset-x-1 top-0 h-0.5 bg-sidebar-ring" />}
        {over === 'after' && <span className="absolute inset-x-1 bottom-0 h-0.5 bg-sidebar-ring" />}
        <button
          type="button"
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent-foreground/10',
            !row.expandable && 'invisible',
          )}
          aria-label={row.expanded ? t('pages.collapse') : t('pages.expand')}
          aria-expanded={row.expandable ? row.expanded : undefined}
          tabIndex={row.expandable ? 0 : -1}
          onClick={() => toggle(row.scope, page.id)}
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform', row.expanded && 'rotate-90')}
          />
        </button>
        <Link
          to="/w/$workspaceId/p/$pageId"
          params={{ workspaceId, pageId: page.id }}
          className="flex min-w-0 flex-1 items-center gap-2"
          draggable={false}
        >
          <PageIcon icon={page.icon} />
          <span className={cn('truncate', !page.title.trim() && 'text-muted-foreground')}>
            {title}
          </span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label={t('pages.actionsFor', { title })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => actions.toggleFavorite(page)}>
              {isFavorite ? <StarOff /> : <Star />}
              {isFavorite ? t('pages.removeFavorite') : t('pages.addFavorite')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.duplicate(page)}>
              <Copy />
              {t('pages.duplicate')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMoving(page)}>
              <FolderInput />
              {t('pages.moveTo')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.trash(page)}>
              <Trash2 />
              {t('pages.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          aria-label={t('pages.addSubpage', { title })}
          onClick={() => {
            toggle(row.scope, page.id, true);
            actions.create({ kind: 'page', id: page.id });
          }}
        >
          <Plus />
        </Button>
      </div>
    );
  };

  return (
    <>
      <SidebarContent ref={scrollRef} className="px-2" data-testid="sidebar-tree">
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          role="tree"
          aria-label={t('pages.tree')}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              role="treeitem"
              aria-selected={false}
              style={{
                position: 'absolute',
                top: item.start,
                left: 0,
                right: 0,
                height: item.size,
              }}
            >
              {renderRow(rows[item.index]!)}
            </div>
          ))}
        </div>
        {shared.next && (
          <Button
            variant="link"
            size="sm"
            onClick={() =>
              void loadShared(store, shared.next).then((list) =>
                setShared((s) => ({
                  ids: [...s.ids, ...list.items.map((p) => p.id)],
                  next: list.nextCursor,
                })),
              )
            }
          >
            {t('pages.loadMoreShared')}
          </Button>
        )}
      </SidebarContent>
      {moving && <MovePageDialog page={moving} onClose={() => setMoving(null)} />}
    </>
  );
}

function indent(depth: number): number {
  return 4 + depth * 14;
}
