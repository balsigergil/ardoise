// SPDX-License-Identifier: AGPL-3.0-only
/**
 * React node views of blocks that need interaction (PRODUCT §6.2). Each view renders its
 * own body and a `NodeViewContent` slot for the block's `children` (ADR 0009 §1).
 */
import { outlineOf } from '@ardoise/editor';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import {
  Bookmark as BookmarkIcon,
  Check,
  Copy,
  Download,
  FileText,
  ImageIcon,
  Link2,
  Paperclip,
  Puzzle,
  WrapText,
} from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageIcon } from '@/components/page-tree/page-icon';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useEditorEnv, usePageRef } from '../env';
import { CODE_LANGUAGES } from '../extensions/code-highlight';
import { formatSize } from '../files';
import { renderMath } from './math';

type Props = ReactNodeViewProps<HTMLElement>;

/** The `children` slot under an atom-like block. */
function Children() {
  return <NodeViewContent className="ardoise-children-slot" />;
}

function useUploadError() {
  const { t } = useTranslation();
  return (error: unknown) =>
    toast.error(
      error instanceof ApiError
        ? t(`errors.codes.${error.code}`)
        : t('errors.codes.internal_error'),
    );
}

function Placeholder({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      contentEditable={false}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md bg-muted px-3 py-3 text-left text-sm text-muted-foreground hover:bg-accent disabled:cursor-default disabled:hover:bg-muted"
    >
      {icon}
      {label}
    </button>
  );
}

function pickFile(accept: string, onFile: (file: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  });
  input.click();
}

// --- code ---------------------------------------------------------------------------

export function CodeBlockView({ node, updateAttributes, editor }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const language = String(node.attrs['language'] ?? 'plain');
  const wrap = !!node.attrs['wrap'];
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className="ardoise-code-block" data-wrap={wrap}>
      <div className="ardoise-code-toolbar" contentEditable={false}>
        <select
          aria-label={t('editor.code.language')}
          value={CODE_LANGUAGES.includes(language) ? language : 'plain'}
          disabled={!editable}
          onChange={(e) => updateAttributes({ language: e.target.value })}
          className="rounded bg-transparent px-1 text-xs text-muted-foreground"
        >
          {CODE_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l === 'plain' ? t('editor.code.plain') : l}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            className="ardoise-icon-button"
            aria-pressed={wrap}
            aria-label={t('editor.code.wrap')}
            disabled={!editable}
            onClick={() => updateAttributes({ wrap: !wrap })}
          >
            <WrapText className="size-3.5" />
          </button>
          <button
            type="button"
            className="ardoise-icon-button"
            aria-label={t('editor.code.copy')}
            onClick={() =>
              void navigator.clipboard?.writeText(node.firstChild?.textContent ?? '').then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

// --- image and file -------------------------------------------------------------------

export function ImageView({ node, updateAttributes, editor, selected }: Props) {
  const { t } = useTranslation();
  const env = useEditorEnv();
  const onError = useUploadError();
  const [uploading, setUploading] = useState(false);
  const fileId = node.attrs['fileId'] as string | null;
  const width = node.attrs['width'] as number | null;
  const caption = String(node.attrs['caption'] ?? '');
  const editable = editor.isEditable;
  const frame = useRef<HTMLDivElement>(null);
  const upload = () =>
    env.upload &&
    pickFile('image/*', (file) => {
      setUploading(true);
      env.upload!(file)
        .then((dto) => updateAttributes({ fileId: dto.id }))
        .catch(onError)
        .finally(() => setUploading(false));
    });
  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const box = frame.current?.parentElement?.getBoundingClientRect();
    if (!box) return;
    const move = (e: PointerEvent) => {
      const fraction = Math.min(1, Math.max(0.15, (e.clientX - box.left) / box.width));
      if (frame.current) frame.current.style.width = `${fraction * 100}%`;
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      updateAttributes({
        width:
          Math.round(Math.min(1, Math.max(0.15, (e.clientX - box.left) / box.width)) * 100) / 100,
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <NodeViewWrapper className="ardoise-media">
      {fileId ? (
        <figure contentEditable={false} className="my-1">
          <div
            ref={frame}
            className={cn('group relative', selected && 'ring-2 ring-ring')}
            style={{ width: width ? `${width * 100}%` : undefined, maxWidth: '100%' }}
          >
            <img
              src={env.fileUrls.file(fileId)}
              alt={caption}
              loading="lazy"
              className="block w-full rounded-md"
              draggable={false}
            />
            {editable && (
              <span
                role="separator"
                aria-label={t('editor.image.resize')}
                onPointerDown={startResize}
                className="absolute top-1/2 right-1 h-10 w-1.5 -translate-y-1/2 cursor-ew-resize rounded bg-foreground/40 opacity-0 group-hover:opacity-100"
              />
            )}
          </div>
          {(editable || caption) && (
            <input
              aria-label={t('editor.image.caption')}
              placeholder={t('editor.image.caption')}
              value={caption}
              readOnly={!editable}
              onChange={(e) => updateAttributes({ caption: e.target.value })}
              className="mt-1 w-full bg-transparent text-sm text-muted-foreground outline-none"
            />
          )}
        </figure>
      ) : (
        <Placeholder
          icon={<ImageIcon className="size-4" />}
          label={uploading ? t('editor.image.uploading') : t('editor.image.upload')}
          disabled={!editable || uploading || !env.upload}
          onClick={upload}
        />
      )}
      <Children />
    </NodeViewWrapper>
  );
}

export function FileView({ node, updateAttributes, editor }: Props) {
  const { t, i18n } = useTranslation();
  const env = useEditorEnv();
  const onError = useUploadError();
  const [uploading, setUploading] = useState(false);
  const fileId = node.attrs['fileId'] as string | null;
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className="ardoise-media">
      {fileId ? (
        <a
          contentEditable={false}
          href={env.fileUrls.file(fileId)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          download
        >
          <Paperclip className="size-4 text-muted-foreground" />
          <span className="truncate">
            {String(node.attrs['name'] || t('editor.file.untitled'))}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatSize(Number(node.attrs['size'] ?? 0), i18n.language)}
          </span>
          <Download
            className="ml-auto size-4 text-muted-foreground"
            aria-label={t('editor.file.download')}
          />
        </a>
      ) : (
        <Placeholder
          icon={<Paperclip className="size-4" />}
          label={uploading ? t('editor.image.uploading') : t('editor.file.upload')}
          disabled={!editable || uploading || !env.upload}
          onClick={() =>
            env.upload &&
            pickFile('*/*', (file) => {
              setUploading(true);
              env.upload!(file)
                .then((dto) => updateAttributes({ fileId: dto.id, name: dto.name, size: dto.size }))
                .catch(onError)
                .finally(() => setUploading(false));
            })
          }
        />
      )}
      <Children />
    </NodeViewWrapper>
  );
}

// --- equations ------------------------------------------------------------------------

export function MathEditor({
  value,
  onCommit,
  onCancel,
  multiline,
}: {
  value: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  multiline: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  return (
    <div
      contentEditable={false}
      className="mt-1 grid gap-1 rounded-md border bg-popover p-2 shadow-sm"
    >
      <textarea
        autoFocus
        aria-label={t('editor.equation.source')}
        value={draft}
        rows={multiline ? 3 : 1}
        placeholder={t('editor.equation.placeholder')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !multiline)) {
            e.preventDefault();
            onCommit(draft);
          }
        }}
        onBlur={() => onCommit(draft)}
        className="w-full resize-y bg-transparent font-mono text-sm outline-none"
      />
    </div>
  );
}

export function EquationView({ node, updateAttributes, editor, selected }: Props) {
  const { t } = useTranslation();
  const latex = String(node.attrs['latex'] ?? '');
  const [editingState, setEditing] = useState(false);
  const editable = editor.isEditable;
  const { html, error } = useMemo(() => renderMath(latex, true), [latex]);
  // A new, empty equation opens its editor as soon as it is selected.
  const editing = editingState || (editable && selected && !latex);
  return (
    <NodeViewWrapper className="ardoise-equation">
      <div
        contentEditable={false}
        role="button"
        tabIndex={-1}
        onClick={() => editable && setEditing(true)}
        className={cn('rounded-md px-2 py-2 text-center hover:bg-accent', selected && 'bg-accent')}
      >
        {!latex ? (
          <span className="text-sm text-muted-foreground">{t('editor.equation.empty')}</span>
        ) : error ? (
          <code className="text-sm text-destructive" title={t('editor.equation.invalid')}>
            {latex}
          </code>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
      {editing && (
        <MathEditor
          value={latex}
          multiline
          onCancel={() => setEditing(false)}
          onCommit={(value) => {
            setEditing(false);
            if (value !== latex) updateAttributes({ latex: value });
          }}
        />
      )}
      <Children />
    </NodeViewWrapper>
  );
}

// --- page links -----------------------------------------------------------------------

function PageChip({
  pageId,
  child,
  currentPageId,
}: {
  pageId: string | null;
  child: boolean;
  currentPageId: string;
}) {
  const { t } = useTranslation();
  const env = useEditorEnv();
  const ref = usePageRef(pageId);
  const href = pageId ? env.pageHref(pageId) : null;
  let label: string;
  let note: string | null = null;
  if (ref.status === 'ok') {
    label = ref.page.title || t('pages.untitled');
    if (ref.trashed) note = t('editor.pageLink.deleted');
    else if (child && !(ref.page.parentKind === 'page' && ref.page.parentId === currentPageId))
      note = t('editor.pageLink.moved');
  } else if (ref.status === 'loading') {
    label = '…';
  } else {
    label = t('editor.pageLink.noAccess');
  }
  const body = (
    <>
      {ref.status === 'ok' ? (
        <PageIcon icon={ref.page.icon} />
      ) : (
        <FileText className="size-4 text-muted-foreground" />
      )}
      <span
        className={cn(
          'truncate',
          child ? 'font-medium' : 'underline decoration-muted-foreground/40 underline-offset-4',
          (ref.status !== 'ok' || note) && 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      {!child && <Link2 className="size-3.5 text-muted-foreground" aria-hidden="true" />}
      {note && <span className="text-xs text-muted-foreground">({note})</span>}
    </>
  );
  return href && ref.status === 'ok' ? (
    <a
      contentEditable={false}
      href={href}
      data-page-link={pageId}
      className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
    >
      {body}
    </a>
  ) : (
    <div contentEditable={false} className="flex items-center gap-2 px-1 py-1">
      {body}
    </div>
  );
}

export function PageLinkView({ node }: Props) {
  const env = useEditorEnv();
  return (
    <NodeViewWrapper className="ardoise-page-link">
      <PageChip
        pageId={node.attrs['pageId'] as string | null}
        child={false}
        currentPageId={env.pageId}
      />
      <Children />
    </NodeViewWrapper>
  );
}

export function ChildPageView({ node }: Props) {
  const env = useEditorEnv();
  return (
    <NodeViewWrapper className="ardoise-page-link">
      <PageChip pageId={node.attrs['pageId'] as string | null} child currentPageId={env.pageId} />
      <Children />
    </NodeViewWrapper>
  );
}

// --- table of contents ------------------------------------------------------------------

export function TableOfContentsView({ editor }: Props) {
  const { t } = useTranslation();
  const subscribe = useMemo(
    () => (listener: () => void) => {
      editor.on('update', listener);
      return () => void editor.off('update', listener);
    },
    [editor],
  );
  const doc = useSyncExternalStore(subscribe, () => editor.state.doc);
  const entries = useMemo(() => outlineOf(doc), [doc]);
  const scrollTo = (pos: number) => {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <NodeViewWrapper className="ardoise-toc">
      <nav
        contentEditable={false}
        aria-label={t('editor.blocks.tableOfContents')}
        className="grid gap-0.5 rounded-md py-1"
      >
        {entries.length === 0 && (
          <p className="px-2 text-sm text-muted-foreground">{t('editor.toc.empty')}</p>
        )}
        {entries.map((entry) => (
          <button
            key={`${entry.pos}-${entry.blockId}`}
            type="button"
            onClick={() => scrollTo(entry.pos)}
            className="truncate rounded px-2 py-0.5 text-left text-sm text-muted-foreground underline-offset-4 hover:bg-accent hover:text-foreground"
            style={{ paddingLeft: `${0.5 + (entry.level - 1) * 1.25}rem` }}
          >
            {entry.text || t('editor.toc.untitled')}
          </button>
        ))}
      </nav>
      <Children />
    </NodeViewWrapper>
  );
}

// --- bookmark -------------------------------------------------------------------------

export function BookmarkView({ node, updateAttributes, editor }: Props) {
  const { t } = useTranslation();
  const env = useEditorEnv();
  const url = String(node.attrs['url'] ?? '');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const editable = editor.isEditable;
  const submit = () => {
    const value = draft.trim();
    if (!/^https?:\/\//i.test(value) || !env.preview) return;
    setLoading(true);
    env
      .preview(value)
      .then((p) =>
        updateAttributes({
          url: value,
          title: p.title,
          description: p.description,
          siteName: p.siteName,
        }),
      )
      .catch(() => {
        // Without a preview the bookmark still links to the URL.
        updateAttributes({
          url: value,
          title: '',
          description: '',
          siteName: new URL(value).hostname,
        });
        toast(t('errors.codes.preview_unavailable'));
      })
      .finally(() => setLoading(false));
  };
  return (
    <NodeViewWrapper className="ardoise-bookmark">
      {url ? (
        <a
          contentEditable={false}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="grid gap-0.5 rounded-md border px-3 py-2 hover:bg-accent"
        >
          <span className="truncate text-sm font-medium">{String(node.attrs['title'] || url)}</span>
          {node.attrs['description'] ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {String(node.attrs['description'])}
            </span>
          ) : null}
          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <BookmarkIcon className="size-3" aria-hidden="true" />
            {String(node.attrs['siteName'] || url)}
          </span>
        </a>
      ) : (
        <form
          contentEditable={false}
          className="flex gap-2 rounded-md bg-muted p-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            type="url"
            value={draft}
            disabled={!editable || loading}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('editor.bookmark.placeholder')}
            aria-label={t('editor.bookmark.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <button
            type="submit"
            disabled={!editable || loading}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
          >
            {t('editor.bookmark.create')}
          </button>
        </form>
      )}
      <Children />
    </NodeViewWrapper>
  );
}

// --- reserved plugin types (PLUGINS.md §6.3) --------------------------------------------

export function PluginBlockView({ node }: Props) {
  const { t } = useTranslation();
  return (
    <NodeViewWrapper className="ardoise-plugin">
      <div
        contentEditable={false}
        className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
      >
        <Puzzle className="size-4" aria-hidden="true" />
        <span>{t('editor.plugin.missing', { plugin: String(node.attrs['plugin'] || '?') })}</span>
        {node.attrs['text'] ? (
          <span className="truncate text-foreground">{String(node.attrs['text'])}</span>
        ) : null}
      </div>
      <Children />
    </NodeViewWrapper>
  );
}

export function PluginContainerView({ node }: Props) {
  const { t } = useTranslation();
  return (
    <NodeViewWrapper className="ardoise-plugin-container rounded-md border border-dashed px-2 pt-1">
      <div
        contentEditable={false}
        className="flex items-center gap-1 text-xs text-muted-foreground"
      >
        <Puzzle className="size-3" aria-hidden="true" />
        {t('editor.plugin.missing', { plugin: String(node.attrs['plugin'] || '?') })}
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
