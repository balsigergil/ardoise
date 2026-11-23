// SPDX-License-Identifier: AGPL-3.0-only
/** M3 contracts: backlinks, search, files, link previews and public page content. */
import { z } from 'zod';
import type { PageIcon } from '../pages.js';

/** A page as shown in result lists (backlinks, search, mentions). */
export interface PageRefDto {
  id: string;
  title: string;
  icon: PageIcon;
}

export interface BacklinkDto {
  page: PageRefDto;
  /** `link` (link to page, child page, in-app URL) and/or `mention`. */
  kinds: ('link' | 'mention' | 'synced_ref')[];
}

export interface BacklinksDto {
  items: BacklinkDto[];
  nextCursor: string | null;
}

export const backlinksQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type BacklinksQuery = z.infer<typeof backlinksQuerySchema>;

// --- search ----------------------------------------------------------------------

export const quickFindQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type QuickFindQuery = z.infer<typeof quickFindQuerySchema>;

export interface QuickFindItemDto extends PageRefDto {
  /** Titles of the ancestors, nearest last (for disambiguation). */
  path: string[];
}

export interface QuickFindDto {
  items: QuickFindItemDto[];
}

const isoDate = z.iso.datetime({ offset: true });

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  teamspaceId: z.uuid().optional(),
  createdBy: z.uuid().optional(),
  editedAfter: isoDate.optional(),
  editedBefore: isoDate.optional(),
  titleOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SearchQueryInput = z.input<typeof searchQuerySchema>;

export interface SearchResultDto extends QuickFindItemDto {
  /**
   * Highlighted excerpt: plain text where matches are wrapped in `\u0002` … `\u0003`
   * (never HTML, so it can be rendered safely).
   */
  snippet: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface SearchResultsDto {
  items: SearchResultDto[];
  nextCursor: string | null;
}

/** Markers around matches in snippets (start of text / end of text control characters). */
export const SNIPPET_START = '\u0002';
export const SNIPPET_END = '\u0003';

// --- files -----------------------------------------------------------------------

export interface FileDto {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** True for images that get a thumbnail (once generated). */
  isImage: boolean;
}

// --- link previews (bookmarks) ------------------------------------------------------

export const linkPreviewSchema = z.object({ url: z.url({ protocol: /^https?$/ }).max(2048) });
export type LinkPreviewInput = z.input<typeof linkPreviewSchema>;

export interface LinkPreviewDto {
  url: string;
  title: string;
  description: string;
  siteName: string;
}

// --- public pages ----------------------------------------------------------------

export interface PublicContentDto {
  /** Editor JSON of the page body (ADR 0009 §10). */
  doc: { type: 'doc'; content?: unknown[] };
}
