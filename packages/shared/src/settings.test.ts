// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { generalSettingsSchema, limitsSchema, parseSettings } from './settings.js';

describe('instance settings', () => {
  it('fills the documented defaults (PRODUCT §3)', () => {
    expect(parseSettings(limitsSchema, undefined)).toEqual({
      maxUploadSizeMb: 100,
      maxDocumentSizeMb: 10,
      trashRetentionDays: 30,
      historyRetentionDays: null,
      offlineRowsPerDatabase: 50,
      invitationExpiryDays: 7,
    });
    expect(parseSettings(generalSettingsSchema, {})).toEqual({
      workspaceInvitationsEnabled: true,
      workspaceCreation: 'all_users',
    });
  });
  it('keeps stored values', () => {
    expect(parseSettings(limitsSchema, { invitationExpiryDays: 3 }).invitationExpiryDays).toBe(3);
  });
  it('falls back to defaults when the stored value is invalid', () => {
    expect(parseSettings(limitsSchema, { invitationExpiryDays: -1 }).invitationExpiryDays).toBe(7);
  });
});
