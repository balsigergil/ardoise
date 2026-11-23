// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drizzle schema. Tables arrive with their milestones (M1: instance level and
 * workspaces; M2: pages, permissions, change log...). Conventions: ARCHITECTURE §4.
 */
export * from './instance.js';
export * from './workspaces.js';
export * from './pages.js';
export * from './content.js';
