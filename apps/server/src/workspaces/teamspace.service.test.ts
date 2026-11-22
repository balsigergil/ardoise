// SPDX-License-Identifier: AGPL-3.0-only
import { newId, type MutationInput } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../testing/harness.js';
import type { UserRecord } from '../store/store.js';

/** Creates a teamspace through the `teamspace.create` mutation. */
async function createTs(
  h: Harness,
  actor: UserRecord,
  workspaceId: string,
  input: Omit<MutationInput['teamspace.create'], 'id'>,
) {
  const id = newId();
  await h.mutate(actor, workspaceId, 'teamspace.create', { id, ...input });
  return { id };
}

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

describe('teamspaces (reads and mutations)', () => {
  it('only owners and admins create teamspaces', async () => {
    const { h, owner, member, ws } = await setup();
    await expect(createTs(h, member, ws.id, { name: 'Eng' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    const ts = await createTs(h, owner, ws.id, {
      name: 'Eng',
      visibility: 'closed',
      defaultLevel: 'can_view',
    });
    expect(await h.teamspaces.get(owner, ws.id, ts.id)).toMatchObject({
      name: 'Eng',
      myRole: 'owner',
      canManage: true,
      memberCount: 1,
      defaultLevel: 'can_view',
    });
  });

  it('lists teamspaces by visibility', async () => {
    const { h, owner, member, guest, ws } = await setup();
    await createTs(h, owner, ws.id, { name: 'Open', visibility: 'open' });
    await createTs(h, owner, ws.id, { name: 'Closed', visibility: 'closed' });
    const priv = await createTs(h, owner, ws.id, {
      name: 'Private',
      visibility: 'private',
    });
    const names = async (u: typeof owner) =>
      (await h.teamspaces.list(u, ws.id, { limit: 10 })).items.map((t) => t.name);
    expect(await names(owner)).toEqual(['Acme', 'Closed', 'Open', 'Private']);
    expect(await names(member)).toEqual(['Acme', 'Closed', 'Open']);
    expect(await names(guest)).toEqual([]);
    const mine = async (u: typeof owner) =>
      (await h.teamspaces.list(u, ws.id, { limit: 10, mine: true })).items.map((t) => t.name);
    expect(await mine(owner)).toEqual(['Acme', 'Closed', 'Open', 'Private']);
    expect(await mine(member)).toEqual([]);
    await expect(h.teamspaces.get(member, ws.id, priv.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await h.mutate(owner, ws.id, 'teamspace.addMember', {
      teamspaceId: priv.id,
      userId: member.id,
    });
    expect(await names(member)).toEqual(['Acme', 'Closed', 'Open', 'Private']);
  });

  it('lets members join open teamspaces only', async () => {
    const { h, owner, member, guest, ws } = await setup();
    const open = await createTs(h, owner, ws.id, { name: 'Open' });
    const closed = await createTs(h, owner, ws.id, {
      name: 'Closed',
      visibility: 'closed',
    });
    await h.mutate(member, ws.id, 'teamspace.join', { teamspaceId: open.id });
    await expect(
      h.mutate(member, ws.id, 'teamspace.join', { teamspaceId: open.id }),
    ).rejects.toMatchObject({
      code: 'already_member',
    });
    await expect(
      h.mutate(member, ws.id, 'teamspace.join', { teamspaceId: closed.id }),
    ).rejects.toMatchObject({
      code: 'teamspace_join_forbidden',
    });
    await expect(
      h.mutate(guest, ws.id, 'teamspace.join', { teamspaceId: open.id }),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await h.teamspaces.get(member, ws.id, open.id)).myRole).toBe('member');
  });

  it('adds members (never guests), changes roles and keeps an owner', async () => {
    const { h, owner, member, guest, ws } = await setup();
    const ts = await createTs(h, owner, ws.id, { name: 'Eng', visibility: 'closed' });
    await expect(
      h.mutate(owner, ws.id, 'teamspace.addMember', { teamspaceId: ts.id, userId: guest.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await h.mutate(owner, ws.id, 'teamspace.addMember', {
      teamspaceId: ts.id,
      userId: member.id,
      role: 'owner',
    });
    await expect(
      h.mutate(owner, ws.id, 'teamspace.addMember', { teamspaceId: ts.id, userId: member.id }),
    ).rejects.toMatchObject({
      code: 'already_member',
    });
    // A teamspace owner who is a plain workspace member manages the teamspace.
    await h.mutate(member, ws.id, 'teamspace.setMemberRole', {
      teamspaceId: ts.id,
      userId: owner.id,
      role: 'member',
    });
    await expect(
      h.mutate(member, ws.id, 'teamspace.setMemberRole', {
        teamspaceId: ts.id,
        userId: member.id,
        role: 'member',
      }),
    ).rejects.toMatchObject({
      code: 'last_teamspace_owner',
    });
    await expect(
      h.mutate(member, ws.id, 'teamspace.removeMember', { teamspaceId: ts.id, userId: member.id }),
    ).rejects.toMatchObject({
      code: 'last_teamspace_owner',
    });
    await h.mutate(member, ws.id, 'teamspace.removeMember', {
      teamspaceId: ts.id,
      userId: owner.id,
    });
    const members = await h.teamspaces.listMembers(member, ws.id, ts.id, { limit: 10 });
    expect(members.items.map((m) => [m.email, m.role])).toEqual([['member@x.test', 'owner']]);
  });

  it('updates settings for managers only', async () => {
    const { h, owner, member, ws } = await setup();
    const ts = await createTs(h, owner, ws.id, { name: 'Eng' });
    await h.mutate(member, ws.id, 'teamspace.join', { teamspaceId: ts.id });
    await expect(
      h.mutate(member, ws.id, 'teamspace.update', { id: ts.id, name: 'X' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    const epoch = h.store.data.permEpochs.get(ws.id) ?? 0;
    await h.mutate(owner, ws.id, 'teamspace.update', {
      id: ts.id,
      name: 'Engineering',
      description: 'Builders',
      visibility: 'private',
      defaultLevel: 'can_comment',
    });
    expect(await h.teamspaces.get(owner, ws.id, ts.id)).toMatchObject({
      name: 'Engineering',
      description: 'Builders',
      visibility: 'private',
      memberCount: 2,
    });
    expect(h.store.data.permEpochs.get(ws.id)).toBe(epoch + 1);
  });

  it('paginates teamspaces', async () => {
    const { h, owner, ws } = await setup();
    for (const name of ['A', 'B', 'C']) await createTs(h, owner, ws.id, { name });
    const first = await h.teamspaces.list(owner, ws.id, { limit: 2 });
    const second = await h.teamspaces.list(owner, ws.id, { limit: 2, cursor: first.nextCursor! });
    expect([...first.items, ...second.items].map((t) => t.name)).toEqual(['A', 'Acme', 'B', 'C']);
  });
});
