// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';

const DAY = 24 * 60 * 60 * 1000;

describe('JobProcessors', () => {
  it('purges trash roots past the retention period and logs their deletion', async () => {
    const h = createHarness();
    const owner = await h.createUser();
    const ws = await h.createWorkspace(owner);
    const ts = await h.defaultTeamspace(ws.id);
    const old = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Old');
    const child = await h.createPage(owner, ws.id, { kind: 'page', id: old }, 'Child');
    const recent = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Recent');
    await h.mutate(owner, ws.id, 'page.trash', { id: old });
    h.clock.advance(20 * DAY);
    await h.mutate(owner, ws.id, 'page.trash', { id: recent });
    h.clock.advance(11 * DAY);
    expect(await h.processors.purgeExpiredTrash()).toBe(1);
    expect(await h.store.pages.findById(ws.id, old)).toBeUndefined();
    expect(await h.store.pages.findById(ws.id, child)).toBeUndefined();
    expect(await h.store.pages.findById(ws.id, recent)).toBeDefined();
    expect(h.store.sync.changeLog.at(-1)).toMatchObject({
      entityType: 'page',
      entityId: old,
      op: 'delete',
    });
    expect(h.bus.published.at(-1)).toMatchObject({ type: 'poke', workspaceId: ws.id });
  });

  it('honors the configured retention', async () => {
    const h = createHarness();
    await h.settings.update({ limits: { trashRetentionDays: 60 } });
    const owner = await h.createUser();
    const ws = await h.createWorkspace(owner);
    const page = await h.createPage(owner, ws.id, { kind: 'private', id: owner.id });
    await h.mutate(owner, ws.id, 'page.trash', { id: page });
    h.clock.advance(31 * DAY);
    expect(await h.processors.purgeExpiredTrash()).toBe(0);
  });

  it('purges change-log entries past the horizon', async () => {
    const h = createHarness();
    const owner = await h.createUser();
    const ws = await h.createWorkspace(owner);
    await h.createPage(owner, ws.id, { kind: 'private', id: owner.id });
    h.clock.advance(29 * DAY);
    expect(await h.processors.purgeChangeLog()).toBe(0);
    h.clock.advance(2 * DAY);
    expect(await h.processors.purgeChangeLog()).toBe(1);
  });
});
