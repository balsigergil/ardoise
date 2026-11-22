// SPDX-License-Identifier: AGPL-3.0-only
import { newId, uuidToLabel, type PermissionLevel } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import type { PageRecord } from '../store/store.js';
import { createHarness } from '../testing/harness.js';
import { ancestryIds, PermissionService, type PermissionCache } from './permission.service.js';

class MapCache implements PermissionCache {
  readonly map = new Map<string, PermissionLevel>();
  gets = 0;
  get(keys: readonly string[]) {
    this.gets++;
    return Promise.resolve(keys.map((k) => this.map.get(k) ?? null));
  }
  set(entries: readonly [string, PermissionLevel][]) {
    for (const [k, v] of entries) this.map.set(k, v);
    return Promise.resolve();
  }
}

function record(id: string, path: string, moveState: 'moving' | null = null): PageRecord {
  return { id, path, moveState } as PageRecord;
}

describe('ancestryIds', () => {
  it('reads ancestry from the path', () => {
    const [a, b, c] = [newId(), newId(), newId()];
    const page = record(c, [a, b, c].map(uuidToLabel).join('.'));
    expect(ancestryIds(page, new Map())).toEqual([a, b, c]);
  });

  it("uses a moving root's old path for the whole subtree", () => {
    const [oldParent, newParent, root, child] = [newId(), newId(), newId(), newId()];
    const l = uuidToLabel;
    const movingRoot = record(root, `${l(oldParent)}.${l(root)}`, 'moving');
    const byId = new Map([[root, movingRoot]]);
    // A descendant already rewritten under the new parent keeps the old ancestry.
    const rewritten = record(child, `${l(newParent)}.${l(root)}.${l(child)}`);
    expect(ancestryIds(rewritten, byId)).toEqual([oldParent, root, child]);
    const notYet = record(child, `${l(oldParent)}.${l(root)}.${l(child)}`);
    expect(ancestryIds(notYet, byId)).toEqual([oldParent, root, child]);
  });
});

describe('PermissionService cache', () => {
  it('caches levels per epoch and recomputes after a bump', async () => {
    const h = createHarness();
    const cache = new MapCache();
    const permissions = new PermissionService(h.store, cache);
    const owner = await h.createUser();
    const ws = await h.createWorkspace(owner);
    const ts = await h.defaultTeamspace(ws.id);
    const pageId = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts });
    const page = (await h.store.pages.findById(ws.id, pageId))!;
    const subject = await permissions.subject(ws.id, owner.id);
    expect(await permissions.level(ws.id, subject, page)).toBe('full_access');
    expect([...cache.map.keys()]).toEqual([
      `perm:${ws.id}:${h.store.data.permEpochs.get(ws.id) ?? 0}:${owner.id}:${pageId}`,
    ]);
    // A cached value is served as is.
    cache.map.set([...cache.map.keys()][0]!, 'can_view');
    expect(await permissions.level(ws.id, subject, page)).toBe('can_view');
    await h.store.workspaces.bumpPermEpoch(ws.id);
    expect(await permissions.level(ws.id, subject, page)).toBe('full_access');
    // Inside transactions (a store is passed) the cache is bypassed.
    const gets = cache.gets;
    await permissions.level(ws.id, subject, page, h.store);
    expect(cache.gets).toBe(gets);
  });

  it('gives no access to non-members without loading chains', async () => {
    const h = createHarness();
    const permissions = new PermissionService(h.store, new MapCache());
    const subject = await permissions.subject(newId(), newId());
    expect(subject.workspaceRole).toBeUndefined();
    expect(
      await permissions.levels(newId(), subject, [record(newId(), uuidToLabel(newId()))]),
    ).toEqual(new Map([[expect.any(String), 'no_access']]));
  });
});
