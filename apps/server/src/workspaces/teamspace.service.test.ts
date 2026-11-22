// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';

async function setup() {
  const h = createHarness();
  const owner = await h.createUser({ email: 'owner@x.test' });
  const member = await h.createUser({ email: 'member@x.test' });
  const guest = await h.createUser({ email: 'guest@x.test' });
  const ws = await h.createWorkspace(owner);
  await h.addMember(ws.id, member, 'member');
  await h.addMember(ws.id, guest, 'guest');
  return { h, owner, member, guest, ws };
}

describe('TeamspaceService', () => {
  it('only owners and admins create teamspaces', async () => {
    const { h, owner, member, ws } = await setup();
    await expect(h.teamspaces.create(member, ws.id, { name: 'Eng' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    const ts = await h.teamspaces.create(owner, ws.id, {
      name: 'Eng',
      visibility: 'closed',
      defaultLevel: 'can_view',
    });
    expect(ts).toMatchObject({
      name: 'Eng',
      myRole: 'owner',
      canManage: true,
      memberCount: 1,
      defaultLevel: 'can_view',
    });
  });

  it('lists teamspaces by visibility', async () => {
    const { h, owner, member, guest, ws } = await setup();
    await h.teamspaces.create(owner, ws.id, { name: 'Open', visibility: 'open' });
    await h.teamspaces.create(owner, ws.id, { name: 'Closed', visibility: 'closed' });
    const priv = await h.teamspaces.create(owner, ws.id, {
      name: 'Private',
      visibility: 'private',
    });
    const names = async (u: typeof owner) =>
      (await h.teamspaces.list(u, ws.id, { limit: 10 })).items.map((t) => t.name);
    expect(await names(owner)).toEqual(['Closed', 'Open', 'Private']);
    expect(await names(member)).toEqual(['Closed', 'Open']);
    expect(await names(guest)).toEqual([]);
    await expect(h.teamspaces.get(member, ws.id, priv.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await h.teamspaces.addMember(owner, ws.id, priv.id, { userId: member.id });
    expect(await names(member)).toEqual(['Closed', 'Open', 'Private']);
  });

  it('lets members join open teamspaces only', async () => {
    const { h, owner, member, guest, ws } = await setup();
    const open = await h.teamspaces.create(owner, ws.id, { name: 'Open' });
    const closed = await h.teamspaces.create(owner, ws.id, {
      name: 'Closed',
      visibility: 'closed',
    });
    await h.teamspaces.join(member, ws.id, open.id);
    await expect(h.teamspaces.join(member, ws.id, open.id)).rejects.toMatchObject({
      code: 'already_member',
    });
    await expect(h.teamspaces.join(member, ws.id, closed.id)).rejects.toMatchObject({
      code: 'teamspace_join_forbidden',
    });
    await expect(h.teamspaces.join(guest, ws.id, open.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await h.teamspaces.get(member, ws.id, open.id)).myRole).toBe('member');
  });

  it('adds members (never guests), changes roles and keeps an owner', async () => {
    const { h, owner, member, guest, ws } = await setup();
    const ts = await h.teamspaces.create(owner, ws.id, { name: 'Eng', visibility: 'closed' });
    await expect(
      h.teamspaces.addMember(owner, ws.id, ts.id, { userId: guest.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await h.teamspaces.addMember(owner, ws.id, ts.id, { userId: member.id, role: 'owner' });
    await expect(
      h.teamspaces.addMember(owner, ws.id, ts.id, { userId: member.id }),
    ).rejects.toMatchObject({
      code: 'already_member',
    });
    // A teamspace owner who is a plain workspace member manages the teamspace.
    await h.teamspaces.changeRole(member, ws.id, ts.id, owner.id, 'member');
    await expect(
      h.teamspaces.changeRole(member, ws.id, ts.id, member.id, 'member'),
    ).rejects.toMatchObject({
      code: 'last_teamspace_owner',
    });
    await expect(h.teamspaces.removeMember(member, ws.id, ts.id, member.id)).rejects.toMatchObject({
      code: 'last_teamspace_owner',
    });
    await h.teamspaces.removeMember(member, ws.id, ts.id, owner.id);
    const members = await h.teamspaces.listMembers(member, ws.id, ts.id, { limit: 10 });
    expect(members.items.map((m) => [m.email, m.role])).toEqual([['member@x.test', 'owner']]);
  });

  it('updates settings for managers only', async () => {
    const { h, owner, member, ws } = await setup();
    const ts = await h.teamspaces.create(owner, ws.id, { name: 'Eng' });
    await h.teamspaces.join(member, ws.id, ts.id);
    await expect(h.teamspaces.update(member, ws.id, ts.id, { name: 'X' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    const epoch = h.store.data.permEpochs.get(ws.id) ?? 0;
    const updated = await h.teamspaces.update(owner, ws.id, ts.id, {
      name: 'Engineering',
      description: 'Builders',
      visibility: 'private',
      defaultLevel: 'can_comment',
    });
    expect(updated).toMatchObject({
      name: 'Engineering',
      description: 'Builders',
      visibility: 'private',
      memberCount: 2,
    });
    expect(h.store.data.permEpochs.get(ws.id)).toBe(epoch + 1);
  });

  it('paginates teamspaces', async () => {
    const { h, owner, ws } = await setup();
    for (const name of ['A', 'B', 'C']) await h.teamspaces.create(owner, ws.id, { name });
    const first = await h.teamspaces.list(owner, ws.id, { limit: 2 });
    const second = await h.teamspaces.list(owner, ws.id, { limit: 2, cursor: first.nextCursor! });
    expect([...first.items, ...second.items].map((t) => t.name)).toEqual(['A', 'B', 'C']);
  });
});
