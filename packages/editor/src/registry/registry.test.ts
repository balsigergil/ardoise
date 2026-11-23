// SPDX-License-Identifier: AGPL-3.0-only
import { lookup, resources } from '@ardoise/i18n';
import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { lines, sketch, stateOf } from '../__fixtures__/sketch.js';
import { BLOCK_NODES, getEditorSchema } from '../schema/index.js';
import { createCoreRegistry, CORE_ACTIONS } from './core.js';
import { EditorRegistry } from './registry.js';
import { filterSlashItems, normalize, slashCommand } from './slash.js';

const registry = createCoreRegistry();
const en = (key: string) => lookup(resources.en.common, key) ?? key;
const fr = (key: string) => lookup(resources.fr.common, key) ?? key;

describe('core registry', () => {
  it('assembles an extension list whose schema is the persisted schema', () => {
    const schema = getSchema(registry.extensions());
    const reference = getEditorSchema();
    expect(Object.keys(schema.nodes).sort()).toEqual(Object.keys(reference.nodes).sort());
    expect(Object.keys(schema.marks).sort()).toEqual(Object.keys(reference.marks).sort());
    for (const [name, type] of Object.entries(reference.nodes)) {
      expect(schema.nodes[name]!.spec.content, name).toBe(type.spec.content);
      expect(Object.keys(schema.nodes[name]!.spec.attrs ?? {}).sort(), name).toEqual(
        Object.keys(type.spec.attrs ?? {}).sort(),
      );
    }
  });

  it('has a definition for every block node', () => {
    for (const name of BLOCK_NODES) expect(registry.block(name), name).toBeDefined();
  });

  it('has unique slash ids and labels in both languages', () => {
    const items = registry.slashItems();
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    const keys = [
      ...items.map((i) => i.labelKey),
      ...registry.turnIntoItems().map((i) => i.labelKey),
      ...CORE_ACTIONS.map((a) => a.labelKey),
    ];
    for (const key of keys) {
      expect(lookup(resources.en.common, key), key).toBeDefined();
      expect(lookup(resources.fr.common, key), key).toBeDefined();
    }
  });

  it('orders slash items by group', () => {
    const groups = registry.slashItems().map((i) => i.group);
    expect(groups.indexOf('media')).toBeGreaterThan(groups.lastIndexOf('basic'));
    expect(groups.at(-1)).toBe('inline');
  });

  it('offers block actions per block type, and a generic menu for unknown types', () => {
    expect(registry.actionsFor('paragraph').map((a) => a.id)).toContain('color');
    expect(registry.actionsFor('divider').map((a) => a.id)).not.toContain('turnInto');
    expect(registry.actionsFor('somethingElse').map((a) => a.id)).toEqual([
      'duplicate',
      'moveTo',
      'copyLink',
      'delete',
    ]);
  });

  it('rejects duplicate registrations', () => {
    const r = new EditorRegistry([]);
    const def = { name: 'x', source: 'core', extensions: [], slash: [], turnInto: [], actions: [] };
    r.registerBlock(def);
    expect(() => r.registerBlock(def)).toThrow();
    const item = {
      id: 'a',
      labelKey: 'k',
      icon: 'i',
      keywords: [],
      group: 'basic' as const,
      block: 'x',
    };
    r.registerSlashItems([item]);
    expect(() => r.registerSlashItems([item])).toThrow();
  });
});

describe('filterSlashItems', () => {
  const items = registry.slashItems();
  it('matches localized labels without accents, keywords and ids', () => {
    expect(filterSlashItems(items, 'titre', fr)[0]!.id).toBe('heading1');
    expect(filterSlashItems(items, 'equation', fr).map((i) => i.id)).toContain('equation');
    expect(filterSlashItems(items, 'h2', en)[0]!.id).toBe('heading2');
    expect(filterSlashItems(items, 'todo', en)[0]!.id).toBe('todo');
    expect(filterSlashItems(items, 'zzzz', en)).toEqual([]);
    expect(filterSlashItems(items, '', en)).toHaveLength(items.length);
  });

  it('accepts subsequences', () => {
    expect(filterSlashItems(items, 'bkmk', en).map((i) => i.id)).toContain('bookmark');
  });

  it('normalizes', () => {
    expect(normalize('Équation')).toBe('equation');
  });
});

describe('slashCommand', () => {
  const item = (id: string) => registry.slashItems().find((i) => i.id === id)!;
  const run = (source: string, id: string) => {
    let state = stateOf(source);
    expect(slashCommand(item(id))(state, (tr) => (state = state.apply(tr)))).toBe(true);
    state.doc.check();
    return state;
  };

  it('turns an empty paragraph into a text block, keeping its id', () => {
    const state = run('paragraph:id=p |', 'heading2');
    expect(sketch(state, { ids: true, attrs: ['level'] })).toBe('heading:level=2:id=p |');
  });

  it('inserts after a non-empty block', () => {
    expect(sketch(run('paragraph text|', 'todo'))).toBe('paragraph text\ntodo |');
  });

  it('replaces an empty paragraph with a structured block', () => {
    expect(sketch(run('paragraph |', 'columns3'))).toBe(
      lines(`
      columns
        column
          paragraph |
        column
          paragraph
        column
          paragraph
    `),
    );
    const table = run('paragraph |', 'table');
    expect(table.doc.firstChild!.type.name).toBe('table');
    expect(table.doc.firstChild!.childCount).toBe(3);
  });

  it('leaves host actions to the UI', () => {
    expect(slashCommand(item('image'))(stateOf('paragraph |'))).toBe(false);
  });
});
