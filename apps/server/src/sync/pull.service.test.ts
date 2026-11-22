// SPDX-License-Identifier: AGPL-3.0-only
import { newId, positionBetween } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import type { UserRecord } from '../store/store.js';
import { createHarness, type Harness } from '../testing/harness.js';

const pos = positionBetween(null, null);

async function setup() {
  const h = createHarness();
  const owner = await h.createUser();
  const member = await h.createUser();
  const outsider = await h.createUser();
  const guest = await h.createUser();
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  await h.addMember(ws.id, member, 'member');
  await h.addMember(ws.id, outsider, 'member');
  await h.addMember(ws.id, guest, 'guest');
  await h.mutate(member, ws.id, 'teamspace.join', { teamspaceId: ts });
  return { h, owner, member, outsider, guest, ws: ws.id, ts };
}

const pull = (h: Harness, user: UserRecord, ws: string, since = 0, limit = 500) =>
  h.pull.pull(user, { workspace: ws, since, limit });
const types = (r: { entries: { type: string }[] }) => r.entries.map((e) => e.type);

describe('PullService', () => {
  it('filters page entries by current view access', async () => {
    const { h, owner, member, outsider, ws, ts } = await setup();
    const page = await h.createPage(owner, ws, { kind: 'teamspace', id: ts }, 'Team page');
    const secret = await h.createPage(owner, ws, { kind: 'private', id: owner.id }, 'Mine');
    const forMember = await pull(h, member, ws);
    expect(forMember.entries.filter((e) => e.type === 'page').map((e) => e.id)).toEqual([page]);
    const forOutsider = await pull(h, outsider, ws);
    expect(forOutsider.entries.filter((e) => e.type === 'page')).toEqual([]);
    // The cursor advances past filtered entries.
    expect(forOutsider.cursor).toBe(forMember.cursor);
    // Granting access makes earlier entries visible on the next pull from 0.
    await h.mutate(owner, ws, 'permission.grant', {
      pageId: secret,
      principal: { kind: 'user', id: outsider.id },
      level: 'can_view',
    });
    const again = await pull(h, outsider, ws);
    expect(again.entries.filter((e) => e.type === 'page').map((e) => e.id)).toEqual([secret]);
    expect(types(again)).toContain('access');
  });

  it('delivers user-private entries to their owner only', async () => {
    const { h, owner, member, ws, ts } = await setup();
    const page = await h.createPage(owner, ws, { kind: 'teamspace', id: ts });
    await h.mutate(owner, ws, 'favorite.add', { pageId: page, position: pos });
    expect(types(await pull(h, owner, ws))).toContain('favorite');
    expect(types(await pull(h, member, ws))).not.toContain('favorite');
  });

  it('always delivers page deletions, without data', async () => {
    const { h, owner, outsider, ws } = await setup();
    const page = await h.createPage(owner, ws, { kind: 'private', id: owner.id });
    await h.mutate(owner, ws, 'page.trash', { id: page });
    await h.mutate(owner, ws, 'page.purge', { id: page });
    const result = await pull(h, outsider, ws);
    expect(result.entries.filter((e) => e.type === 'page')).toEqual([
      expect.objectContaining({ type: 'page', id: page, op: 'delete' }),
    ]);
    expect(result.entries.find((e) => e.op === 'delete')).not.toHaveProperty('data');
  });

  it('follows teamspace visibility and hides the member directory from guests', async () => {
    const { h, owner, member, outsider, guest, ws } = await setup();
    const priv = newId();
    await h.mutate(owner, ws, 'teamspace.create', {
      id: priv,
      name: 'Secret',
      visibility: 'private',
    });
    await h.mutate(owner, ws, 'teamspace.addMember', { teamspaceId: priv, userId: member.id });
    await h.mutate(owner, ws, 'member.setRole', { userId: outsider.id, role: 'admin' });
    const teamspaceIds = (u: UserRecord) =>
      pull(h, u, ws).then((r) => r.entries.filter((e) => e.type === 'teamspace').map((e) => e.id));
    expect(await teamspaceIds(member)).toEqual([priv]);
    // Workspace admins see every teamspace (canSeeTeamspace).
    expect(await teamspaceIds(outsider)).toEqual([priv]);
    expect(await teamspaceIds(guest)).toEqual([]);
    expect(types(await pull(h, member, ws))).toContain('member');
    expect(types(await pull(h, guest, ws))).not.toContain('member');
    expect(types(await pull(h, guest, ws))).toContain('access');
  });

  it('pages through the log', async () => {
    const { h, owner, ws, ts } = await setup();
    for (let i = 0; i < 5; i++)
      await h.createPage(owner, ws, { kind: 'teamspace', id: ts }, `p${i}`);
    const first = await pull(h, owner, ws, 0, 2);
    expect(first.hasMore).toBe(true);
    const second = await pull(h, owner, ws, first.cursor, 1000);
    expect(second.hasMore).toBe(false);
    expect(second.cursor).toBe(await h.store.changeLog.currentSeq(ws));
  });

  it('requires a resync when the cursor is older than the retained log or ahead of it', async () => {
    const { h, owner, ws, ts } = await setup();
    await h.createPage(owner, ws, { kind: 'teamspace', id: ts });
    const current = await h.store.changeLog.currentSeq(ws);
    await expect(pull(h, owner, ws, current + 5)).rejects.toMatchObject({
      code: 'resync_required',
    });
    h.clock.advance(31 * 24 * 60 * 60 * 1000);
    await h.processors.purgeChangeLog();
    await expect(pull(h, owner, ws, 0)).rejects.toMatchObject({ code: 'resync_required' });
    await expect(pull(h, owner, ws, current)).resolves.toMatchObject({ entries: [] });
  });

  it('answers not_found to non-members', async () => {
    const { h, ws } = await setup();
    const stranger = await h.createUser();
    await expect(pull(h, stranger, ws)).rejects.toMatchObject({ code: 'not_found' });
  });
});
