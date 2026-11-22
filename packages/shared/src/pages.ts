// SPDX-License-Identifier: AGPL-3.0-only
/** Page model shared by the server, the sync store and the UI (ARCHITECTURE §4.3). */
import { z } from 'zod';

export const pageKinds = ['page', 'database', 'row'] as const;
export type PageKind = (typeof pageKinds)[number];

/** Top-level pages hang off a teamspace or a private section (ADR 0006). */
export const rootKinds = ['teamspace', 'private'] as const;
export type RootKind = (typeof rootKinds)[number];

export const parentKinds = ['teamspace', 'private', 'page', 'database'] as const;
export type ParentKind = (typeof parentKinds)[number];

export const pageWidths = ['normal', 'full'] as const;
export type PageWidth = (typeof pageWidths)[number];

export const pageFonts = ['default', 'serif', 'mono'] as const;
export type PageFont = (typeof pageFonts)[number];

/** Solid and gradient covers; uploaded images arrive with files in M3. */
export const coverColors = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export const coverGradients = ['dawn', 'dusk', 'ocean', 'forest'] as const;

export const pageIconSchema = z
  .object({ type: z.literal('emoji'), value: z.string().trim().min(1).max(16) })
  .nullable();
export type PageIcon = z.infer<typeof pageIconSchema>;

export const pageCoverSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('color'), value: z.enum(coverColors) }),
    z.object({ type: z.literal('gradient'), value: z.enum(coverGradients) }),
  ])
  .nullable();
export type PageCover = z.infer<typeof pageCoverSchema>;

export const pageTitleSchema = z.string().max(2000);

export const MAX_PAGE_DEPTH = 1000;

export interface PageParent {
  kind: ParentKind;
  id: string;
}

/** The synced page entity. `path` stays server-only (ADR 0003). */
export interface PageDto {
  id: string;
  kind: PageKind;
  parentKind: ParentKind;
  parentId: string;
  position: string;
  title: string;
  icon: PageIcon;
  cover: PageCover;
  width: PageWidth;
  font: PageFont;
  isLocked: boolean;
  restrictInheritance: boolean;
  isInline: boolean;
  isTemplate: boolean;
  moveState: 'moving' | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  deletedAt: string | null;
  deletedRootId: string | null;
  /** Server-known at read time; clients keep it up to date from the children they see. */
  hasChildren: boolean;
}

export function isRootParent(kind: ParentKind): kind is RootKind {
  return kind === 'teamspace' || kind === 'private';
}

/** The key under which a parent's children are listed. */
export function parentKey(parent: PageParent): string {
  return `${parent.kind}:${parent.id}`;
}
