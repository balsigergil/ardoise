// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drag handle and block menu (PRODUCT §6.1). The menu lists the actions the registry
 * declares for the block type; with a multi-block selection, actions apply to every
 * selected block.
 */
import {
  BLOCK_COLORS,
  blockStartingAt,
  COLORS,
  createTextBlock,
  deleteBlocks,
  duplicateBlocks,
  insertBlocksAfter,
  setBlockColor,
  turnInto,
  type BlockRef,
  type EditorRegistry,
} from '@ardoise/editor';
import type { Editor } from '@tiptap/core';
import { NodeSelection, type Command } from '@tiptap/pm/state';
import { GripVertical, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { startBlockDrag, type HandleState } from '../extensions/drag-handle';
import type { Store } from '../extensions/menu-store';
import { RegistryIcon } from './icons';
import { useStore } from '../extensions/menu-store';
import { swatchClass, targetBlocks } from './block-targets';

export interface BlockMenuHandlers {
  /** Opens the "move to" picker for these blocks. */
  moveTo(blocks: BlockRef[]): void;
  copyLink(blockId: string): void;
  /** A child page block deleted from the menu also trashes its page. */
  trashPage(pageId: string): void;
}

export function BlockHandle({
  editor,
  store,
  registry,
  handlers,
}: {
  editor: Editor;
  store: Store<HandleState>;
  registry: EditorRegistry;
  handlers: BlockMenuHandlers;
}) {
  const { t } = useTranslation();
  const state = useStore(store);
  const [menu, setMenu] = useState<{ pos: number; rect: DOMRect } | null>(null);
  const hovered = state.hovered;
  if (!editor.isEditable || (!hovered && !menu)) return null;
  const anchor = menu?.rect ?? hovered!.rect;
  const pos = menu?.pos ?? hovered!.pos;

  const run = (command: Command) => {
    command(editor.state, editor.view.dispatch);
    editor.view.focus();
  };

  const addBelow = () => {
    const block = blockStartingAt(editor.state.doc, pos);
    if (!block) return;
    const view = editor.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    insertBlocksAfter([createTextBlock(view.state.schema, 'paragraph')], false)(
      view.state,
      view.dispatch,
    );
    view.focus();
    // Opens the slash menu in the new block.
    view.dispatch(view.state.tr.insertText('/'));
  };

  const blocks = menu ? targetBlocks(editor, menu.pos) : [];
  const first = blocks[0];
  const actions = first ? registry.actionsFor(first.node.type.name) : [];
  const turnTargets = registry.turnIntoItems();

  return (
    <>
      <div
        className="ardoise-block-handle fixed z-30 flex items-center"
        style={{ left: anchor.left - 46, top: anchor.top + Math.min(anchor.height, 28) / 2 - 12 }}
      >
        <button
          type="button"
          className="ardoise-handle-button"
          aria-label={t('editor.handle.add')}
          onClick={addBelow}
        >
          <Plus className="size-4" />
        </button>
        <DropdownMenu
          open={!!menu}
          onOpenChange={(open) => {
            if (!open) {
              setMenu(null);
              store.set((s) => ({ ...s, hovered: null }));
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              draggable
              className="ardoise-handle-button cursor-grab"
              aria-label={t('editor.handle.drag')}
              onClick={() => {
                if (!hovered) return;
                const targets = targetBlocks(editor, hovered.pos);
                if (targets.length === 1) {
                  editor.view.dispatch(
                    editor.state.tr.setSelection(
                      NodeSelection.create(editor.state.doc, hovered.pos),
                    ),
                  );
                }
                setMenu({ pos: hovered.pos, rect: hovered.rect });
              }}
              onPointerDown={(e) => e.preventDefault()}
              onDragStart={(e) => {
                if (!hovered) return;
                const targets = targetBlocks(editor, hovered.pos);
                const from = targets[0]!.pos;
                const last = targets.at(-1)!;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData(
                  'text/plain',
                  editor.state.doc.textBetween(from, last.pos + last.node.nodeSize, '\n'),
                );
                const dom = editor.view.nodeDOM(hovered.pos);
                if (dom instanceof HTMLElement) e.dataTransfer.setDragImage(dom, 0, 0);
                startBlockDrag(editor.view, store, hovered.pos, {
                  from,
                  to: last.pos + last.node.nodeSize,
                });
              }}
            >
              <GripVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="left"
            className="w-60"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {actions.map((action) => {
              switch (action.id) {
                case 'turnInto':
                  return (
                    <DropdownMenuSub key={action.id}>
                      <DropdownMenuSubTrigger>
                        <RegistryIcon id={action.icon} />
                        {t(action.labelKey as never)}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                        {turnTargets.map((item) => (
                          <DropdownMenuItem
                            key={item.id}
                            onSelect={() => run(turnInto(item.block, { ...item.attrs }, blocks))}
                          >
                            <RegistryIcon id={item.icon} />
                            {t(item.labelKey as never)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                case 'color':
                  return (
                    <DropdownMenuSub key={action.id}>
                      <DropdownMenuSubTrigger>
                        <RegistryIcon id={action.icon} />
                        {t(action.labelKey as never)}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-96 overflow-y-auto">
                        <DropdownMenuItem onSelect={() => run(setBlockColor(null, blocks))}>
                          {t('editor.menu.defaultColor')}
                        </DropdownMenuItem>
                        <DropdownMenuLabel>{t('editor.menu.colorText')}</DropdownMenuLabel>
                        {COLORS.map((c) => (
                          <DropdownMenuItem key={c} onSelect={() => run(setBlockColor(c, blocks))}>
                            <span
                              className={cn('size-4 rounded border', swatchClass(c))}
                              aria-hidden="true"
                            />
                            {t(`editor.colors.${c}`)}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuLabel>{t('editor.menu.colorBackground')}</DropdownMenuLabel>
                        {BLOCK_COLORS.filter((c) => c.endsWith('_background')).map((c) => (
                          <DropdownMenuItem key={c} onSelect={() => run(setBlockColor(c, blocks))}>
                            <span
                              className={cn('size-4 rounded border', swatchClass(c))}
                              aria-hidden="true"
                            />
                            {t(
                              `editor.colors.${c.replace('_background', '') as (typeof COLORS)[number]}`,
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                case 'duplicate':
                  return (
                    <DropdownMenuItem key={action.id} onSelect={() => run(duplicateBlocks(blocks))}>
                      <RegistryIcon id={action.icon} />
                      {t(action.labelKey as never)}
                      <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  );
                case 'moveTo':
                  return (
                    <DropdownMenuItem key={action.id} onSelect={() => handlers.moveTo(blocks)}>
                      <RegistryIcon id={action.icon} />
                      {t(action.labelKey as never)}
                    </DropdownMenuItem>
                  );
                case 'copyLink': {
                  const blockId = first?.node.attrs['blockId'] as string | null;
                  if (!blockId || blocks.length > 1) return null;
                  return (
                    <DropdownMenuItem key={action.id} onSelect={() => handlers.copyLink(blockId)}>
                      <RegistryIcon id={action.icon} />
                      {t(action.labelKey as never)}
                    </DropdownMenuItem>
                  );
                }
                case 'delete':
                  return (
                    <div key={action.id}>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          for (const b of blocks) {
                            if (b.node.type.name === 'childPage' && b.node.attrs['pageId']) {
                              handlers.trashPage(String(b.node.attrs['pageId']));
                            }
                          }
                          run(deleteBlocks(blocks));
                        }}
                      >
                        <RegistryIcon id={action.icon} />
                        {t(action.labelKey as never)}
                      </DropdownMenuItem>
                    </div>
                  );
                default:
                  return null;
              }
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {state.drop && (
        <div
          aria-hidden="true"
          className={cn(
            'ardoise-drop-indicator pointer-events-none fixed z-30 bg-primary/70',
            state.drop.placement === 'left' || state.drop.placement === 'right' ? 'w-1' : 'h-1',
          )}
          style={
            state.drop.placement === 'left'
              ? {
                  left: state.drop.rect.left - 4,
                  top: state.drop.rect.top,
                  height: state.drop.rect.height,
                }
              : state.drop.placement === 'right'
                ? {
                    left: state.drop.rect.right,
                    top: state.drop.rect.top,
                    height: state.drop.rect.height,
                  }
                : {
                    left: state.drop.rect.left + (state.drop.placement === 'child' ? 48 : 0),
                    width: state.drop.rect.width - (state.drop.placement === 'child' ? 48 : 0),
                    top:
                      state.drop.placement === 'before'
                        ? state.drop.rect.top - 2
                        : state.drop.rect.bottom - 2,
                  }
          }
        />
      )}
    </>
  );
}
