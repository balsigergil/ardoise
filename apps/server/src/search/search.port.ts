// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Search engine port (ARCHITECTURE §11). The Postgres adapter is the default; the port
 * leaves room for another engine later. Results are candidates: permission filtering
 * happens in `SearchService`.
 */

export interface TitleCandidate {
  pageId: string;
}

export interface SearchFilters {
  teamspaceId?: string;
  createdBy?: string;
  editedAfter?: Date;
  editedBefore?: Date;
  titleOnly?: boolean;
}

/** Keyset position in ranked results. */
export interface RankCursor {
  rank: number;
  pageId: string;
}

export interface TextCandidate {
  pageId: string;
  rank: number;
  /** Matches wrapped in SNIPPET_START / SNIPPET_END; plain text otherwise. */
  snippet: string;
}

export interface SearchPort {
  /** Live pages whose title matches `q` (accent-insensitive), best first. */
  quickFind(
    workspaceId: string,
    q: string,
    offset: number,
    limit: number,
  ): Promise<TitleCandidate[]>;
  /** Full-text matches, best first, after `cursor`. */
  search(
    workspaceId: string,
    q: string,
    filters: SearchFilters,
    cursor: RankCursor | null,
    limit: number,
  ): Promise<TextCandidate[]>;
}
