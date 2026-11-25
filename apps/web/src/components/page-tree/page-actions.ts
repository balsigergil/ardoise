// SPDX-License-Identifier: AGPL-3.0-only
import {
  newId,
  positionAt,
  positionBetween,
  type MutationParent,
  type PageDto,
  type PageParent,
} from '@ardoise/shared';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useSyncStore } from '@/sync/hooks';

/** Database parents (rows) arrive in M4; tree mutations target pages and section roots. */
function mutationParent(parent: PageParent): MutationParent | undefined {
  return parent.kind === 'database' ? undefined : { kind: parent.kind, id: parent.id };
}

/** Page actions shared by the sidebar, the page view and dialogs (all mutations). */
export function usePageActions() {
  const store = useSyncStore();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const report = useCallback(
    (result: { ok: true } | { ok: false; code: string }) => {
      if (!result.ok) toast.error(t(`errors.codes.${result.code}` as never));
      return result.ok;
    },
    [t],
  );

  /**
   * Creates an empty page at the end of `parent` and opens it. Under a page, the server
   * appends a child page block to the parent's content unless `inlineBlock` says the
   * caller (the editor's `/page`) inserts the block itself.
   */
  const create = useCallback(
    (parent: PageParent, options: { inlineBlock?: boolean } = {}) => {
      const id = newId();
      const target = mutationParent(parent);
      if (!target) return undefined;
      const siblings = store.children(parent);
      const ok = report(
        store.mutate('page.create', {
          id,
          parent: target,
          position: positionAt(siblings, siblings.length),
          ...(options.inlineBlock && { appendBlock: false }),
        }),
      );
      if (ok)
        void navigate({
          to: '/w/$workspaceId/p/$pageId',
          params: { workspaceId: store.workspaceId, pageId: id },
        });
      return ok ? id : undefined;
    },
    [store, navigate, report],
  );

  const toggleFavorite = useCallback(
    (page: PageDto) => {
      if (store.get('favorite', page.id)) {
        report(store.mutate('favorite.remove', { pageId: page.id }));
        return;
      }
      const favorites = store.all('favorite').sort((a, b) => (a.position < b.position ? -1 : 1));
      const last = favorites.at(-1)?.position ?? null;
      report(
        store.mutate('favorite.add', { pageId: page.id, position: positionBetween(last, null) }),
      );
    },
    [store, report],
  );

  const duplicate = useCallback(
    (page: PageDto) => {
      const parent: PageParent = { kind: page.parentKind, id: page.parentId };
      const siblings = store.children(parent);
      const index = siblings.findIndex((p) => p.id === page.id);
      report(
        store.mutate('page.duplicate', {
          id: page.id,
          newId: newId(),
          position: positionAt(siblings, index < 0 ? siblings.length : index + 1),
        }),
      );
    },
    [store, report],
  );

  const move = useCallback(
    (page: PageDto, parent: PageParent, position?: string) => {
      const target = mutationParent(parent);
      if (!target) return false;
      const siblings = store.children(parent).filter((p) => p.id !== page.id);
      return report(
        store.mutate('page.move', {
          id: page.id,
          parent: target,
          position: position ?? positionAt(siblings, siblings.length),
        }),
      );
    },
    [store, report],
  );

  const trash = useCallback(
    (page: PageDto) => {
      const ok = report(store.mutate('page.trash', { id: page.id }));
      if (ok) toast(t('pages.trashed'));
      return ok;
    },
    [store, report, t],
  );

  return { create, toggleFavorite, duplicate, move, trash, report };
}
