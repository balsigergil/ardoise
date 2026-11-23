// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page body editor (PRODUCT §6): Tiptap bound to the page's Yjs document through
 * Hocuspocus, with the slash menu, mentions, drag handles, block menu, formatting
 * toolbar, table controls and presence. Read-only follows the server (view access,
 * locked page) and the page state given by the page view.
 */
import {
  findBlock,
  insertBlocksAfter,
  normalize,
  type BlockRef,
  type SlashItem,
} from '@ardoise/editor';
import {
  newId,
  presenceColor,
  type CollabUser,
  type FileDto,
  type LinkPreviewDto,
  type PageDto,
  type QuickFindDto,
} from '@ardoise/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { AlertTriangle, CloudOff, Eye, Lock } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { EmojiPicker } from '@/components/emoji-picker';
import { usePageActions } from '@/components/page-tree/page-actions';
import { api, ApiError } from '@/lib/api';
import { useSyncStore } from '@/sync/hooks';
import { openDocument, type DocSession } from './collab';
import { appendBlocks, childPageIds, dateItems, registry } from './editor-utils';
import { EditorEnvContext, type EditorEnv } from './env';
import { localCollapsedStorage } from './extensions/decorations';
import { emptyHandleState, type HandleState } from './extensions/drag-handle';
import { createExtensions } from './extensions';
import { closedSuggestion, createStore, type SuggestionState } from './extensions/menu-store';
import type { MentionItem } from './extensions/suggestions';
import { uploadFile, workspaceFileUrls } from './files';
import { BlockHandle } from './ui/block-handle';
import { BubbleToolbar } from './ui/bubble-toolbar';
import { PagePicker } from './ui/page-picker';
import { MentionPopup, SlashPopup } from './ui/popups';
import { Presence } from './ui/presence';
import { TableToolbar } from './ui/table-toolbar';

function useSession(workspaceId: string, pageId: string, user: CollabUser): DocSession {
  const session = useMemo(
    () => openDocument(workspaceId, pageId, user),
    [workspaceId, pageId, user],
  );
  useEffect(() => () => session.destroy(), [session]);
  useSyncExternalStore(session.subscribe, () => `${session.status}:${session.readOnly}`);
  return session;
}

export interface PageEditorProps {
  workspaceId: string;
  page: PageDto;
  /** The user can edit, the page is not locked or trashed (the page view decides). */
  editable: boolean;
  locked: boolean;
  me: { id: string; name: string };
  /** Pages shown by child page blocks of the content. */
  onChildPagesChange?: (ids: ReadonlySet<string>) => void;
}

export function PageEditor({
  workspaceId,
  page,
  editable,
  locked,
  me,
  onChildPagesChange,
}: PageEditorProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const store = useSyncStore();
  const actions = usePageActions();
  const user = useMemo<CollabUser>(
    () => ({ id: me.id, name: me.name, color: presenceColor(me.id) }),
    [me.id, me.name],
  );
  const session = useSession(workspaceId, page.id, user);
  const stores = useMemo(
    () => ({
      slash: createStore<SuggestionState<SlashItem>>(closedSuggestion()),
      mention: createStore<SuggestionState<MentionItem>>(closedSuggestion()),
      handle: createStore<HandleState>(emptyHandleState),
    }),
    [],
  );
  const [picker, setPicker] = useState<
    { mode: 'link' } | { mode: 'move'; blocks: BlockRef[] } | null
  >(null);
  const [callout, setCallout] = useState<{ pos: number; rect: DOMRect } | null>(null);

  const upload = useMemo(
    () =>
      (file: File): Promise<FileDto> =>
        uploadFile(workspaceId, page.id, file),
    [workspaceId, page.id],
  );
  const env = useMemo<EditorEnv>(
    () => ({
      workspaceId,
      pageId: page.id,
      fileUrls: workspaceFileUrls(workspaceId),
      upload,
      preview: (url) =>
        api.post<LinkPreviewDto>(`/api/workspaces/${workspaceId}/link-preview`, { url }),
      pageHref: (id) => `/w/${workspaceId}/p/${id}`,
    }),
    [workspaceId, page.id, upload],
  );

  const insertFiles = (editor: Editor, files: File[]) => {
    for (const file of files) {
      const toastId = toast.loading(t('editor.upload.uploading', { name: file.name }));
      upload(file)
        .then((dto) => {
          const schema = editor.state.schema;
          const node = dto.isImage
            ? schema.nodes['image']!.create({ blockId: newId(), fileId: dto.id })
            : schema.nodes['file']!.create({
                blockId: newId(),
                fileId: dto.id,
                name: dto.name,
                size: dto.size,
              });
          insertBlocksAfter([node])(editor.state, editor.view.dispatch);
          toast.success(t('editor.upload.done', { name: dto.name }), { id: toastId });
        })
        .catch((error: unknown) =>
          toast.error(
            error instanceof ApiError
              ? t(`errors.codes.${error.code}`)
              : t('errors.codes.internal_error'),
            { id: toastId },
          ),
        );
    }
  };

  const pick = (accept: string, onFiles: (files: File[]) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => input.files?.length && onFiles([...input.files]));
    input.click();
  };

  const onSlashAction = (action: string, _item: SlashItem, editor: Editor) => {
    const schema = editor.state.schema;
    switch (action) {
      case 'createPage': {
        const id = actions.create({ kind: 'page', id: page.id });
        if (id)
          insertBlocksAfter([schema.nodes['childPage']!.create({ blockId: newId(), pageId: id })])(
            editor.state,
            editor.view.dispatch,
          );
        return;
      }
      case 'pickPage':
        setPicker({ mode: 'link' });
        return;
      case 'uploadImage':
        pick('image/*', (files) => insertFiles(editor, files));
        return;
      case 'uploadFile':
        pick('*/*', (files) => insertFiles(editor, files));
        return;
      case 'bookmark':
        insertBlocksAfter([schema.nodes['bookmark']!.create({ blockId: newId() })])(
          editor.state,
          editor.view.dispatch,
        );
        return;
      case 'mentionUser':
      case 'mentionPage':
        editor.chain().focus().insertContent('@').run();
        return;
      case 'mentionDate': {
        const [today] = dateItems('', (k) => t(k as never));
        editor
          .chain()
          .focus()
          .insertContent({ type: 'mention', attrs: { kind: 'date', id: null, date: today!.date } })
          .run();
        return;
      }
      case 'inlineEquation':
        editor
          .chain()
          .focus()
          .insertContent({ type: 'inlineEquation', attrs: { latex: '' } })
          .run();
        return;
    }
  };

  const mentionSearch = async (query: string): Promise<MentionItem[]> => {
    const q = normalize(query.trim());
    const members = await queryClient
      .fetchQuery({
        queryKey: ['workspaces', workspaceId, 'members', 'mentions'],
        queryFn: () =>
          api.get<{ items: { userId: string; name: string; email: string }[] }>(
            `/api/workspaces/${workspaceId}/members?limit=100`,
          ),
        staleTime: 5 * 60_000,
      })
      .catch(() => ({ items: [] }));
    const people = members.items
      .filter((m) => !q || normalize(m.name).includes(q) || normalize(m.email).includes(q))
      .slice(0, 5)
      .map((m): MentionItem => ({
        kind: 'user',
        id: m.userId,
        date: null,
        label: m.name,
        detail: m.email,
      }));
    const pages = q
      ? await api
          .get<QuickFindDto>(
            `/api/workspaces/${workspaceId}/search/quick?q=${encodeURIComponent(query.trim())}&limit=5`,
          )
          .then((r) =>
            r.items.map((p): MentionItem => ({
              kind: 'page',
              id: p.id,
              date: null,
              label: p.title || t('pages.untitled'),
              detail: p.path.join(' / '),
            })),
          )
          .catch(() => [])
      : [];
    return [...people, ...pages, ...dateItems(query, (k) => t(k as never)).slice(0, 3)];
  };

  const editor = useEditor(
    {
      extensions: createExtensions({
        registry,
        session,
        user,
        translate: (key) => t(key as never),
        placeholder: t('editor.placeholder'),
        decorationLabels: {
          checkbox: t('editor.todo.checkbox'),
          expand: t('editor.toggle.expand'),
          collapse: t('editor.toggle.collapse'),
          changeIcon: t('editor.callout.icon'),
        },
        collapsedStorage: localCollapsedStorage(page.id),
        stores,
        onSlashAction,
        mentionSearch,
        onFiles: (files) => editor && insertFiles(editor, files),
        onCalloutIcon: (pos, anchor) => setCallout({ pos, rect: anchor.getBoundingClientRect() }),
      }),
      editable: false,
      editorProps: {
        attributes: {
          class: 'ardoise-editor',
          'aria-label': t('editor.placeholder'),
          'data-testid': 'page-editor',
        },
      },
    },
    [session],
  );

  const canWrite =
    editable && !session.readOnly && session.status !== 'denied' && session.status !== 'connecting';
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isEditable === canWrite) return;
    editor.setEditable(canWrite);
    editor.view.dispatch(editor.state.tr.setMeta('editableChanged', true));
  }, [editor, canWrite]);

  useEffect(() => {
    if (!editor || !onChildPagesChange) return;
    let last = '';
    const report = () => {
      const ids = childPageIds(editor.state.doc);
      const key = [...ids].sort().join(',');
      if (key !== last) {
        last = key;
        onChildPagesChange(ids);
      }
    };
    report();
    editor.on('update', report);
    return () => void editor.off('update', report);
  }, [editor, onChildPagesChange]);

  // Scroll to `#block-<id>` once the content is there.
  useEffect(() => {
    if (!editor || session.status !== 'synced') return;
    const match = /^#block-([0-9a-f-]{36})$/.exec(window.location.hash);
    if (!match) return;
    const pos = findBlock(editor.state.doc, match[1]!);
    if (pos < 0) return;
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ block: 'center' });
      dom.classList.add('is-linked-block');
      setTimeout(() => dom.classList.remove('is-linked-block'), 2000);
    }
  }, [editor, session.status]);

  // A denied session drops the page detail: the page view shows the no-access screen.
  useEffect(() => {
    if (session.status === 'denied')
      void queryClient.invalidateQueries({
        queryKey: ['workspaces', workspaceId, 'pages', page.id],
      });
  }, [session.status, queryClient, workspaceId, page.id]);

  const moveBlocksToPage = (targetId: string, blocks: BlockRef[]) => {
    if (!editor || blocks.length === 0) return;
    const target = openDocument(workspaceId, targetId, user);
    const nodes = blocks.map((b) => b.node);
    const done = target.subscribe(() => {
      if (target.status === 'synced' && !target.readOnly) {
        done();
        appendBlocks(target.doc, nodes);
        const from = blocks[0]!.pos;
        const last = blocks.at(-1)!;
        editor
          .chain()
          .focus()
          .deleteRange({ from, to: last.pos + last.node.nodeSize })
          .run();
        toast.success(t('editor.menu.moved'));
        // Let the update reach the server before closing the document.
        setTimeout(() => target.destroy(), 1000);
      } else if (target.status === 'denied' || target.readOnly) {
        done();
        target.destroy();
        toast.error(t('errors.codes.forbidden'));
      }
    });
  };

  const onEditorClick = (event: React.MouseEvent) => {
    const link = (event.target as HTMLElement).closest('a[data-page-link]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const id = link.getAttribute('data-page-link')!;
    void navigate({ to: '/w/$workspaceId/p/$pageId', params: { workspaceId, pageId: id } });
  };

  const banner =
    session.status === 'denied'
      ? { icon: <AlertTriangle className="size-4" />, text: t('editor.status.denied') }
      : session.status === 'too_large'
        ? { icon: <AlertTriangle className="size-4" />, text: t('editor.status.tooLarge') }
        : session.status === 'offline'
          ? { icon: <CloudOff className="size-4" />, text: t('editor.status.offline') }
          : locked
            ? { icon: <Lock className="size-4" />, text: t('editor.status.locked') }
            : session.readOnly
              ? { icon: <Eye className="size-4" />, text: t('editor.status.readOnly') }
              : null;

  return (
    <EditorEnvContext value={env}>
      <div
        className="ardoise-editor-frame relative"
        onClickCapture={onEditorClick}
        data-status={session.status}
      >
        <div className="absolute -top-9 right-0">
          <Presence session={session} />
        </div>
        {banner && (
          <p className="mb-2 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            {banner.icon}
            {banner.text}
          </p>
        )}
        {session.status === 'connecting' && !editor?.state.doc.childCount && (
          <p className="text-sm text-muted-foreground">{t('editor.status.connecting')}</p>
        )}
        <EditorContent editor={editor} />
        {editor && canWrite && (
          <>
            <SlashPopup store={stores.slash} />
            <MentionPopup store={stores.mention} />
            <BlockHandle
              editor={editor}
              store={stores.handle}
              registry={registry}
              handlers={{
                moveTo: (blocks) => setPicker({ mode: 'move', blocks }),
                copyLink: (blockId) =>
                  void navigator.clipboard
                    ?.writeText(
                      `${window.location.origin}/w/${workspaceId}/p/${page.id}#block-${blockId}`,
                    )
                    .then(() => toast(t('editor.menu.linkCopied'))),
                trashPage: (pageId) => actions.report(store.mutate('page.trash', { id: pageId })),
              }}
            />
            <BubbleToolbar editor={editor} registry={registry} />
            <TableToolbar editor={editor} />
          </>
        )}
        {picker && editor && (
          <PagePicker
            workspaceId={workspaceId}
            title={
              picker.mode === 'link' ? t('editor.blocks.pageLink') : t('editor.menu.moveToTitle')
            }
            exclude={page.id}
            onClose={() => setPicker(null)}
            onPick={(target) => {
              if (picker.mode === 'link') {
                insertBlocksAfter([
                  editor.state.schema.nodes['pageLink']!.create({
                    blockId: newId(),
                    pageId: target.id,
                  }),
                ])(editor.state, editor.view.dispatch);
              } else {
                moveBlocksToPage(target.id, picker.blocks);
              }
              setPicker(null);
            }}
          />
        )}
        {callout && editor && (
          <EmojiPicker
            open
            onOpenChange={(open) => !open && setCallout(null)}
            trigger={
              <span
                className="fixed size-1"
                style={{ left: callout.rect.left, top: callout.rect.bottom }}
              />
            }
            onSelect={(icon) => {
              editor.view.dispatch(editor.state.tr.setNodeAttribute(callout.pos, 'icon', icon));
              setCallout(null);
            }}
          />
        )}
      </div>
    </EditorEnvContext>
  );
}
