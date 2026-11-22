// SPDX-License-Identifier: AGPL-3.0-only
export const adminTabs = ['users', 'invitations', 'workspaces', 'email', 'settings'] as const;
export type AdminTab = (typeof adminTabs)[number];
