// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What node views need from the page around them: the workspace (null on public
 * pages), file URLs, uploads and link previews. Node views are rendered through portals
 * inside <EditorContent>, so they read it from React context.
 */
import type { FileDto, LinkPreviewDto, MemberDto, Page, PageDto } from '@ardoise/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, use } from 'react';
import { api } from '@/lib/api';
import { pageDetailQuery } from '@/lib/pages';
import { useOptionalSync } from '@/sync/context';
import type { FileUrls } from './files';

export interface EditorEnv {
  workspaceId: string | null;
  pageId: string;
  fileUrls: FileUrls;
  upload: ((file: File) => Promise<FileDto>) | null;
  preview: ((url: string) => Promise<LinkPreviewDto>) | null;
  /** In-app link to a page (public pages link inside the share). */
  pageHref: (pageId: string) => string | null;
  /** Pages known without a request (public pages: the subpages the link covers). */
  knownPages?: ReadonlyMap<string, { id: string; title: string; icon: PageDto['icon'] }>;
}

export const EditorEnvContext = createContext<EditorEnv | null>(null);

export function useEditorEnv(): EditorEnv {
  const env = use(EditorEnvContext);
  if (!env) throw new Error('useEditorEnv outside the page editor');
  return env;
}

export type PageRefState =
  | { status: 'loading' }
  | { status: 'missing' }
  | {
      status: 'ok';
      page: Pick<PageDto, 'id' | 'title' | 'icon' | 'parentKind' | 'parentId'>;
      trashed: boolean;
    };

/** A page referenced from content: from the sync store, else fetched (permission-checked). */
export function usePageRef(pageId: string | null): PageRefState {
  const env = useEditorEnv();
  const sync = useOptionalSync();
  const fromStore = pageId ? sync?.store.get('page', pageId) : undefined;
  const query = useQuery({
    ...pageDetailQuery(env.workspaceId ?? '', pageId ?? ''),
    enabled: !!pageId && !!env.workspaceId && !fromStore,
    retry: false,
    staleTime: 60_000,
  });
  if (!pageId) return { status: 'missing' };
  const known = env.knownPages?.get(pageId);
  if (known) {
    return {
      status: 'ok',
      page: { ...known, parentKind: 'page', parentId: env.pageId },
      trashed: false,
    };
  }
  if (fromStore) {
    return { status: 'ok', page: fromStore, trashed: !!sync?.store.isTrashed(pageId) };
  }
  if (query.data)
    return { status: 'ok', page: query.data.page, trashed: query.data.page.deletedAt !== null };
  if (query.isError || !env.workspaceId) return { status: 'missing' };
  return { status: 'loading' };
}

/** Workspace members (first page), for mentions. */
export function useMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: ['workspaces', workspaceId, 'members', 'mentions'],
    queryFn: () => api.get<Page<MemberDto>>(`/api/workspaces/${workspaceId}/members?limit=100`),
    enabled: !!workspaceId,
    staleTime: 5 * 60_000,
  });
}
