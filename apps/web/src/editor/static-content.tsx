// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only rendering of page content without a collab connection (public pages, ADR
 * 0009 §10): the same schema and node views as the editor, fed with editor JSON.
 */
import type { PageIcon } from '@ardoise/shared';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { registry } from './editor-utils';
import { EditorEnvContext, type EditorEnv } from './env';
import { createExtensions } from './extensions';
import type { FileUrls } from './files';

export interface StaticContentProps {
  doc: { type: 'doc'; content?: unknown[] };
  pageId: string;
  fileUrls: FileUrls;
  pageHref: (pageId: string) => string | null;
  /** Pages the reader can open (titles for page links and mentions). */
  knownPages: ReadonlyMap<string, { id: string; title: string; icon: PageIcon }>;
}

export function StaticContent({ doc, pageId, fileUrls, pageHref, knownPages }: StaticContentProps) {
  const { t } = useTranslation();
  const env = useMemo<EditorEnv>(
    () => ({
      workspaceId: null,
      pageId,
      fileUrls,
      upload: null,
      preview: null,
      pageHref,
      knownPages,
    }),
    [pageId, fileUrls, pageHref, knownPages],
  );
  const editor = useEditor(
    {
      extensions: createExtensions({
        registry,
        session: null,
        user: null,
        translate: (key) => t(key as never),
        placeholder: '',
        decorationLabels: {
          checkbox: t('editor.todo.checkbox'),
          expand: t('editor.toggle.expand'),
          collapse: t('editor.toggle.collapse'),
          changeIcon: t('editor.callout.icon'),
        },
        collapsedStorage: null,
      }),
      content: doc as JSONContent,
      editable: false,
      editorProps: {
        attributes: { class: 'ardoise-editor ardoise-static', 'data-testid': 'static-content' },
      },
    },
    [doc],
  );
  return (
    <EditorEnvContext value={env}>
      <EditorContent editor={editor} />
    </EditorEnvContext>
  );
}
