// SPDX-License-Identifier: AGPL-3.0-only
export const workspaceSettingsTabs = ['general', 'members', 'invitations', 'teamspaces'] as const;
export type WorkspaceSettingsTab = (typeof workspaceSettingsTabs)[number];
