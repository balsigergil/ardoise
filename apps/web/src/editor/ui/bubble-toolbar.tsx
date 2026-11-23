// SPDX-License-Identifier: AGPL-3.0-only
/** Inline formatting toolbar over a text selection (PRODUCT §6.1). */
import { COLORS, isSafeHref, selectedBlocks, turnInto, type EditorRegistry } from '@ardoise/editor';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  Palette,
  Sigma,
  Strikethrough,
  Underline,
  Unlink,
} from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { swatchClass } from './block-targets';
import { RegistryIcon } from './icons';

function useEditorTick(editor: Editor): number {
  return useSyncExternalStore(
    (listener) => {
      editor.on('transaction', listener);
      return () => void editor.off('transaction', listener);
    },
    () =>
      editor.state.selection.from * 1e6 +
      editor.state.selection.to +
      editor.state.doc.content.size / 1e9,
  );
}

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded hover:bg-accent',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function BubbleToolbar({ editor, registry }: { editor: Editor; registry: EditorRegistry }) {
  const { t } = useTranslation();
  useEditorTick(editor);
  const [linking, setLinking] = useState<string | null>(null);
  const chain = () => editor.chain().focus();
  const marks: [string, ReactNode, string][] = [
    ['bold', <Bold key="b" className="size-4" />, t('editor.bubble.bold')],
    ['italic', <Italic key="i" className="size-4" />, t('editor.bubble.italic')],
    ['underline', <Underline key="u" className="size-4" />, t('editor.bubble.underline')],
    ['strike', <Strikethrough key="s" className="size-4" />, t('editor.bubble.strike')],
    ['code', <Code key="c" className="size-4" />, t('editor.bubble.code')],
  ];
  const linkHref = editor.getAttributes('link')['href'] as string | undefined;
  const commitLink = (value: string) => {
    const href = value.trim();
    if (!href) chain().unsetMark('link').run();
    else if (isSafeHref(href)) chain().extendMarkRange('link').setMark('link', { href }).run();
    setLinking(null);
  };
  const toInlineEquation = () => {
    const { from, to } = editor.state.selection;
    const latex = editor.state.doc.textBetween(from, to, ' ');
    chain().insertContentAt({ from, to }, { type: 'inlineEquation', attrs: { latex } }).run();
  };
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ state, from, to }) => {
        if (!editor.isEditable || from === to || state.selection instanceof NodeSelection)
          return false;
        const { $from } = state.selection;
        return $from.parent.type.name === 'blockText' || $from.parent.type.name === 'tableCell';
      }}
      className="z-40 flex items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {linking !== null ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            commitLink(linking);
          }}
        >
          <input
            autoFocus
            value={linking}
            onChange={(e) => setLinking(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setLinking(null)}
            placeholder={t('editor.bubble.linkPlaceholder')}
            aria-label={t('editor.bubble.linkPlaceholder')}
            className="w-56 bg-transparent px-1 text-sm outline-none"
          />
        </form>
      ) : (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded px-1.5 text-sm hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
              >
                {t('editor.bubble.turnInto')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-80 overflow-y-auto">
              {registry.turnIntoItems().map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => {
                    turnInto(
                      item.block,
                      { ...item.attrs },
                      selectedBlocks(editor.state),
                    )(editor.state, editor.view.dispatch);
                    editor.view.focus();
                  }}
                >
                  <RegistryIcon id={item.icon} />
                  {t(item.labelKey as never)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {marks.map(([name, icon, label]) => (
            <ToolButton
              key={name}
              label={label}
              active={editor.isActive(name)}
              onClick={() => chain().toggleMark(name).run()}
            >
              {icon}
            </ToolButton>
          ))}
          <ToolButton
            label={t('editor.bubble.link')}
            active={!!linkHref}
            onClick={() => setLinking(linkHref ?? '')}
          >
            <LinkIcon className="size-4" />
          </ToolButton>
          {linkHref && (
            <ToolButton
              label={t('editor.bubble.removeLink')}
              onClick={() => chain().extendMarkRange('link').unsetMark('link').run()}
            >
              <Unlink className="size-4" />
            </ToolButton>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('editor.bubble.color')}
                className="flex size-7 items-center justify-center rounded hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
              >
                <Palette className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-96 overflow-y-auto">
              <DropdownMenuItem
                onSelect={() => chain().unsetMark('textColor').unsetMark('backgroundColor').run()}
              >
                {t('editor.menu.defaultColor')}
              </DropdownMenuItem>
              <DropdownMenuLabel>{t('editor.menu.colorText')}</DropdownMenuLabel>
              {COLORS.map((c) => (
                <DropdownMenuItem
                  key={c}
                  onSelect={() => chain().setMark('textColor', { color: c }).run()}
                >
                  <span
                    className={cn('size-4 rounded border', swatchClass(c))}
                    aria-hidden="true"
                  />
                  {t(`editor.colors.${c}`)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuLabel>{t('editor.menu.colorBackground')}</DropdownMenuLabel>
              {COLORS.map((c) => (
                <DropdownMenuItem
                  key={`bg-${c}`}
                  onSelect={() => chain().setMark('backgroundColor', { color: c }).run()}
                >
                  <span
                    className={cn('size-4 rounded border', swatchClass(`${c}_background`))}
                    aria-hidden="true"
                  />
                  {t(`editor.colors.${c}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolButton label={t('editor.bubble.equation')} onClick={toInlineEquation}>
            <Sigma className="size-4" />
          </ToolButton>
        </>
      )}
    </BubbleMenu>
  );
}
