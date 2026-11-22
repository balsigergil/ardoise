// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';

const smtp = {
  host: 'mail.test',
  port: 465,
  secure: true,
  user: 'bot',
  from: 'Ardoise <bot@mail.test>',
};

describe('InstanceSettingsService', () => {
  it('merges partial updates and validates them', async () => {
    const h = createHarness();
    const updated = await h.settings.update({ limits: { maxUploadSizeMb: 250 } });
    expect(updated.limits).toMatchObject({ maxUploadSizeMb: 250, trashRetentionDays: 30 });
    await expect(h.settings.update({ limits: { maxUploadSizeMb: -1 } })).rejects.toThrow();
  });

  it('prefers admin SMTP settings over the environment and never returns the password', async () => {
    const h = createHarness();
    expect((await h.settings.smtpDto()).source).toBe('env');
    const dto = await h.settings.updateSmtp({ ...smtp, password: 's3cret' });
    expect(dto).toEqual({ source: 'admin', settings: smtp, hasPassword: true });
    expect(JSON.stringify([...h.store.data.settings.values()])).not.toContain('s3cret');
    expect((await h.settings.effectiveSmtp())?.password).toBe('s3cret');

    // Omitting the password keeps it; null clears it.
    await h.settings.updateSmtp({ ...smtp, port: 2525 });
    expect((await h.settings.effectiveSmtp())?.password).toBe('s3cret');
    expect((await h.settings.updateSmtp({ ...smtp, password: null })).hasPassword).toBe(false);

    expect((await h.settings.clearSmtp()).source).toBe('env');
  });

  it('reports mail as disabled without any SMTP settings', async () => {
    const h = createHarness({ smtp: undefined });
    expect(await h.settings.smtpDto()).toEqual({
      source: 'none',
      settings: null,
      hasPassword: false,
    });
    expect(await h.mail.isEnabled()).toBe(false);
    await expect(h.mail.send('a@b.test', { kind: 'test' }, 'en')).rejects.toMatchObject({
      code: 'mail_not_configured',
    });
  });
});
