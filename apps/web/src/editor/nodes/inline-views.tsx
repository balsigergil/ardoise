// SPDX-License-Identifier: AGPL-3.0-only
/** Inline node views: mentions (person, page, date) and inline equations. */
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useEditorEnv, useMembers, usePageRef } from '../env';
import { MathEditor } from './block-views';
import { formatMentionDate } from './format';
import { renderMath } from './math';

type Props = ReactNodeViewProps<HTMLElement>;

function UserMention({ id }: { id: string | null }) {
  const { t } = useTranslation();
  const env = useEditorEnv();
  const members = useMembers(env.workspaceId);
  const member = members.data?.items.find((m) => m.userId === id);
  return (
    <span className="ardoise-mention">@{member?.name ?? t('editor.mention.unknownUser')}</span>
  );
}

function PageMention({ id }: { id: string | null }) {
  const { t } = useTranslation();
  const env = useEditorEnv();
  const ref = usePageRef(id);
  const href = id ? env.pageHref(id) : null;
  const label =
    ref.status === 'ok'
      ? ref.page.title || t('pages.untitled')
      : ref.status === 'loading'
        ? '…'
        : t('editor.pageLink.noAccess');
  return href && ref.status === 'ok' ? (
    <a href={href} data-page-link={id} className="ardoise-mention">
      {label}
    </a>
  ) : (
    <span className="ardoise-mention text-muted-foreground">{label}</span>
  );
}

export function MentionView({ node }: Props) {
  const { i18n } = useTranslation();
  const kind = node.attrs['kind'] as string;
  const id = node.attrs['id'] as string | null;
  return (
    <NodeViewWrapper as="span" className="ardoise-mention-wrapper">
      {kind === 'user' ? (
        <UserMention id={id} />
      ) : kind === 'page' ? (
        <PageMention id={id} />
      ) : (
        <span className="ardoise-mention">
          {formatMentionDate(String(node.attrs['date'] ?? ''), i18n.language).label}
        </span>
      )}
    </NodeViewWrapper>
  );
}

export function InlineEquationView({ node, updateAttributes, editor, selected }: Props) {
  const { t } = useTranslation();
  const latex = String(node.attrs['latex'] ?? '');
  const [editing, setEditing] = useState(!latex && editor.isEditable);
  const { html, error } = useMemo(() => renderMath(latex, false), [latex]);
  return (
    <NodeViewWrapper as="span" className={cn('ardoise-inline-equation', selected && 'bg-accent')}>
      <span role="button" tabIndex={-1} onClick={() => editor.isEditable && setEditing(true)}>
        {!latex ? (
          <span className="text-muted-foreground">{t('editor.equation.inlineEmpty')}</span>
        ) : error ? (
          <code className="text-destructive">{latex}</code>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </span>
      {editing && (
        <span className="absolute z-20 w-72">
          <MathEditor
            value={latex}
            multiline={false}
            onCancel={() => setEditing(false)}
            onCommit={(value) => {
              setEditing(false);
              if (value !== latex) updateAttributes({ latex: value });
            }}
          />
        </span>
      )}
    </NodeViewWrapper>
  );
}
