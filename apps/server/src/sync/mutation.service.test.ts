// SPDX-License-Identifier: AGPL-3.0-only
import { newId, positionBetween } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';

async function setup() {
  const h = createHarness();
  const owner = await h.createUser();
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  return { h, owner, ws, ts };
}

const pos = positionBetween(null, null);

describe('MutationService', () => {
  it('applies a mutation, appends entries with gap-free seqs and pokes once per batch', async () => {
    const { h, owner, ws, ts } = await setup();
    const a = newId();
    const b = newId();
    const results = await h.mutations.push(owner, [
      {
        id: newId(),
        workspaceId: ws.id,
        name: 'page.create',
        args: { id: a, parent: { kind: 'teamspace', id: ts }, position: pos },
        clientTime: '',
      },
      {
        id: newId(),
        workspaceId: ws.id,
        name: 'page.create',
        args: { id: b, parent: { kind: 'page', id: a }, position: pos },
        clientTime: '',
      },
    ]);
    expect(results.map((r) => [r.status, r.seq])).toEqual([
      ['applied', 1],
      ['applied', 2],
    ]);
    expect(h.store.sync.changeLog.map((r) => [r.seq, r.entityType, r.entityId])).toEqual([
      [1, 'page', a],
      [2, 'page', b],
    ]);
    expect(h.bus.published).toEqual([{ type: 'poke', workspaceId: ws.id, seq: 2 }]);
  });

  it('is idempotent: a duplicate id returns the original result without new entries', async () => {
    const { h, owner, ws, ts } = await setup();
    const id = newId();
    const page = newId();
    const args = { id: page, parent: { kind: 'teamspace' as const, id: ts }, position: pos };
    const first = await h.tryMutate(owner, ws.id, 'page.create', args, id);
    const again = await h.tryMutate(owner, ws.id, 'page.create', args, id);
    expect(again).toEqual(first);
    expect(h.store.sync.changeLog).toHaveLength(1);
  });

  it('records rejections so retries get the same answer', async () => {
    const { h, owner, ws } = await setup();
    const id = newId();
    const missing = { id: newId(), title: 'x' };
    const first = await h.tryMutate(owner, ws.id, 'page.update', missing, id);
    expect(first).toEqual({ id, status: 'rejected', code: 'not_found' });
    expect(await h.tryMutate(owner, ws.id, 'page.update', missing, id)).toEqual(first);
    expect(h.store.sync.changeLog).toHaveLength(0);
  });

  it('rejects invalid args without failing the rest of the batch', async () => {
    const { h, owner, ws, ts } = await setup();
    const results = await h.mutations.push(owner, [
      {
        id: newId(),
        workspaceId: ws.id,
        name: 'page.create',
        args: { id: 'nope' },
        clientTime: '',
      },
      {
        id: newId(),
        workspaceId: ws.id,
        name: 'page.create',
        args: { id: newId(), parent: { kind: 'teamspace', id: ts }, position: pos },
        clientTime: '',
      },
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'applied']);
    expect(results[0]!.code).toBe('validation_failed');
  });

  it('answers not_found to non-members and records nothing', async () => {
    const { h, ws, ts } = await setup();
    const stranger = await h.createUser();
    const result = await h.tryMutate(stranger, ws.id, 'page.create', {
      id: newId(),
      parent: { kind: 'teamspace', id: ts },
      position: pos,
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(h.store.sync.applied.size).toBe(0);
  });

  it('bumps the permission epoch for access changes only', async () => {
    const { h, owner, ws, ts } = await setup();
    const epoch = () => h.store.data.permEpochs.get(ws.id) ?? 0;
    const page = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts });
    const before = epoch();
    await h.mutate(owner, ws.id, 'page.update', { id: page, title: 'Renamed' });
    expect(epoch()).toBe(before);
    await h.mutate(owner, ws.id, 'permission.setRestrict', { pageId: page, restrict: true });
    expect(epoch()).toBe(before + 1);
  });
});
