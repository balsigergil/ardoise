// SPDX-License-Identifier: AGPL-3.0-only
/** Scoped reads of the page tree (ARCHITECTURE §7), ingested into the sync store. */
import {
  positionAt,
  type PageDetailDto,
  type PageDto,
  type PageListDto,
  type PageParent,
  type RecentDto,
  type SharingDto,
} from '@ardoise/shared';
import type { SyncStore } from '@ardoise/sync';
import { queryOptions } from '@tanstack/react-query';
import { api, pageQuery } from '@/lib/api';

export const TREE_PAGE_SIZE = 100;

export function childrenPath(workspaceId: string, parent: PageParent): string {
  switch (parent.kind) {
    case 'teamspace':
      return `/api/workspaces/${workspaceId}/teamspaces/${parent.id}/pages`;
    case 'private':
      return `/api/workspaces/${workspaceId}/private/pages`;
    default:
      return `/api/workspaces/${workspaceId}/pages/${parent.id}/children`;
  }
}

/** Fetches one page of children and ingests it; returns the next cursor. */
export async function loadChildren(
  store: SyncStore,
  parent: PageParent,
  cursor: string | null,
): Promise<string | null> {
  const list = await api.get<PageListDto>(
    `${childrenPath(store.workspaceId, parent)}${pageQuery({ cursor, limit: TREE_PAGE_SIZE })}`,
  );
  store.ingestChildren(parent, list.items, list.seq, {
    first: cursor === null,
    complete: cursor === null && list.nextCursor === null,
  });
  return list.nextCursor;
}

export const pageDetailQuery = (workspaceId: string, pageId: string) =>
  queryOptions({
    queryKey: ['workspaces', workspaceId, 'pages', pageId],
    queryFn: () => api.get<PageDetailDto>(`/api/workspaces/${workspaceId}/pages/${pageId}`),
  });

export const sharingQuery = (workspaceId: string, pageId: string) =>
  queryOptions({
    queryKey: ['workspaces', workspaceId, 'pages', pageId, 'sharing'],
    queryFn: () => api.get<SharingDto>(`/api/workspaces/${workspaceId}/pages/${pageId}/sharing`),
  });

export async function loadFavorites(store: SyncStore): Promise<void> {
  const list = await api.get<PageListDto & { positions: Record<string, string> }>(
    `/api/workspaces/${store.workspaceId}/favorites`,
  );
  store.ingest(
    [
      ...list.items.map((p) => ({
        type: 'page' as const,
        id: p.id,
        op: 'upsert' as const,
        data: p,
      })),
      ...Object.entries(list.positions).map(([pageId, position]) => ({
        type: 'favorite' as const,
        id: pageId,
        op: 'upsert' as const,
        data: { pageId, position },
      })),
    ],
    list.seq,
  );
}

export async function loadShared(store: SyncStore, cursor: string | null) {
  const list = await api.get<PageListDto>(
    `/api/workspaces/${store.workspaceId}/shared/pages${pageQuery({ cursor, limit: TREE_PAGE_SIZE })}`,
  );
  store.ingest(
    list.items.map((p) => ({ type: 'page' as const, id: p.id, op: 'upsert' as const, data: p })),
    list.seq,
  );
  return list;
}

export const recentsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: ['workspaces', workspaceId, 'recents'],
    queryFn: () =>
      api.get<{ seq: number; items: RecentDto[] }>(`/api/workspaces/${workspaceId}/recents`),
  });

export function touchRecent(workspaceId: string, pageId: string): Promise<void> {
  return api.put(`/api/workspaces/${workspaceId}/recents/${pageId}`, {});
}

/** Position for appending at the end of a sibling list. */
export function endPosition(siblings: readonly PageDto[]): string {
  return positionAt(siblings, siblings.length);
}

/** Display title: never empty. */
export function pageTitle(page: Pick<PageDto, 'title'> | undefined, untitled: string): string {
  const title = page?.title.trim();
  return title ? title : untitled;
}
