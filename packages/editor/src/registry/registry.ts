// SPDX-License-Identifier: AGPL-3.0-only
import type { AnyExtension } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';

/**
 * Registries of the editor (ADR 0008, PLUGINS.md §11): block definitions, block-menu
 * actions and editor behaviors. The slash menu, the block menu, the "turn into" list,
 * shortcuts and the editor extension list are all read from here; the core registers
 * its own blocks the same way a plugin will in M9.
 */

/** Group of a slash-menu entry, in display order. */
export const SLASH_GROUPS = ['basic', 'media', 'advanced', 'inline'] as const;
export type SlashGroup = (typeof SLASH_GROUPS)[number];

/** An entry of the slash menu. */
export interface SlashItem {
  /** Unique id, also used in tests and analytics-free telemetry of the menu. */
  id: string;
  /** i18n key of the label (`common` namespace). */
  labelKey: string;
  /** Icon id, mapped to an icon component by the UI. */
  icon: string;
  /** Extra search terms (the localized label is always searched). */
  keywords: readonly string[];
  group: SlashGroup;
  /** Node type inserted (or turned into, for text blocks). */
  block: string;
  attrs?: Readonly<Record<string, unknown>>;
  /** Builds the node for blocks that need more than a type and attributes. */
  create?: (schema: Schema) => PMNode;
  /**
   * A host action (upload a file, create a page, pick a page…). When set, the UI runs the
   * action instead of inserting a node directly.
   */
  action?: string;
  /** Markdown-style hint shown next to the label (`#`, `-`, `[]`…). */
  shortcut?: string;
}

/** A "turn into" target. */
export interface TurnIntoItem {
  id: string;
  labelKey: string;
  icon: string;
  block: string;
  attrs?: Readonly<Record<string, unknown>>;
}

/** A block-menu action. The UI provides the implementation for each id. */
export interface BlockAction {
  id: string;
  labelKey: string;
  icon: string;
  /** Keyboard shortcut hint (display only), e.g. `Mod-D`. */
  shortcut?: string;
  /** Whether the action applies to every block of a multi-block selection. */
  multi: boolean;
}

export interface BlockDefinition {
  /** Node type name (ADR 0009). */
  name: string;
  /** `core`, or the plugin id in M9. */
  source: string;
  /** Tiptap extensions defining the node and its structural parts. */
  extensions: readonly AnyExtension[];
  slash: readonly SlashItem[];
  turnInto: readonly TurnIntoItem[];
  /** Ids of the block-menu actions offered on this block. */
  actions: readonly string[];
}

/** Shortcuts, input rules, paste handling and decorations (PLUGINS.md §4). */
export interface EditorBehavior {
  id: string;
  source: string;
  extension: AnyExtension;
}

export class EditorRegistry {
  private readonly blocks = new Map<string, BlockDefinition>();
  private readonly actions = new Map<string, BlockAction>();
  private readonly behaviors = new Map<string, EditorBehavior>();
  /** Slash items that insert inline content (mentions, inline equations). */
  private readonly inlineItems: SlashItem[] = [];

  /**
   * @param base Extensions that are not blocks: structural nodes, inline nodes, marks
   *   and global attributes.
   */
  constructor(private readonly base: readonly AnyExtension[]) {}

  registerBlock(definition: BlockDefinition): this {
    if (this.blocks.has(definition.name)) {
      throw new Error(`block already registered: ${definition.name}`);
    }
    this.checkSlashIds(definition.slash);
    this.blocks.set(definition.name, definition);
    return this;
  }

  /** Registers slash items that are not tied to a block (inline insertions). */
  registerSlashItems(items: readonly SlashItem[]): this {
    this.checkSlashIds(items);
    this.inlineItems.push(...items);
    return this;
  }

  private checkSlashIds(items: readonly SlashItem[]): void {
    const ids = new Set(this.slashItems().map((item) => item.id));
    for (const item of items) {
      if (ids.has(item.id)) throw new Error(`slash item already registered: ${item.id}`);
      ids.add(item.id);
    }
  }

  registerAction(action: BlockAction): this {
    if (this.actions.has(action.id)) throw new Error(`action already registered: ${action.id}`);
    this.actions.set(action.id, action);
    return this;
  }

  registerBehavior(behavior: EditorBehavior): this {
    if (this.behaviors.has(behavior.id)) {
      throw new Error(`behavior already registered: ${behavior.id}`);
    }
    this.behaviors.set(behavior.id, behavior);
    return this;
  }

  block(name: string): BlockDefinition | undefined {
    return this.blocks.get(name);
  }

  blockList(): BlockDefinition[] {
    return [...this.blocks.values()];
  }

  /** Slash items, grouped in `SLASH_GROUPS` order, then in registration order. */
  slashItems(): SlashItem[] {
    const items = [...this.blockList().flatMap((block) => block.slash), ...this.inlineItems];
    return SLASH_GROUPS.flatMap((group) => items.filter((item) => item.group === group));
  }

  turnIntoItems(): TurnIntoItem[] {
    return this.blockList().flatMap((block) => block.turnInto);
  }

  /** Actions offered on a block type, in the order its definition lists them. */
  actionsFor(name: string): BlockAction[] {
    const definition = this.blocks.get(name);
    if (!definition) return this.genericActions();
    return definition.actions
      .map((id) => this.actions.get(id))
      .filter((a): a is BlockAction => !!a);
  }

  /** Actions for blocks with no definition (unknown types keep a minimal menu). */
  private genericActions(): BlockAction[] {
    return ['duplicate', 'moveTo', 'copyLink', 'delete']
      .map((id) => this.actions.get(id))
      .filter((a): a is BlockAction => !!a);
  }

  behaviorList(): EditorBehavior[] {
    return [...this.behaviors.values()];
  }

  /** The extension list of an editor, assembled from the registry. */
  extensions(): AnyExtension[] {
    const seen = new Set<AnyExtension>();
    const list: AnyExtension[] = [];
    const add = (extension: AnyExtension) => {
      if (seen.has(extension)) return;
      seen.add(extension);
      list.push(extension);
    };
    this.base.forEach(add);
    for (const block of this.blockList()) block.extensions.forEach(add);
    for (const behavior of this.behaviorList()) add(behavior.extension);
    return list;
  }
}
