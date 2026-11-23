// SPDX-License-Identifier: AGPL-3.0-only
/** Repositories for page content: Yjs documents, files and projections (M3). */

export interface DocumentRecord {
  workspaceId: string;
  docName: string;
  pageId: string;
  state: Uint8Array;
  stateVector: Uint8Array;
  size: number;
  updatedAt: Date;
}

export interface DocumentsRepo {
  find(workspaceId: string, docName: string): Promise<DocumentRecord | undefined>;
  upsert(record: DocumentRecord): Promise<void>;
}

export type FileStatus = 'pending' | 'ready';

export interface FileRecord {
  workspaceId: string;
  id: string;
  pageId: string;
  s3Key: string;
  name: string;
  mime: string;
  size: number;
  status: FileStatus;
  thumbnailKey: string | null;
  uploadedBy: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface FilesRepo {
  insert(file: FileRecord): Promise<void>;
  findById(workspaceId: string, id: string): Promise<FileRecord | undefined>;
  update(
    workspaceId: string,
    id: string,
    patch: Partial<Pick<FileRecord, 'status' | 'thumbnailKey' | 'size' | 'deletedAt'>>,
  ): Promise<void>;
  /** Marks the files of every page under `path` deleted (page purge). */
  markDeletedUnder(workspaceId: string, path: string, at: Date): Promise<number>;
  /** Deleted files older than `before`, oldest first, across workspaces. */
  listDeleted(before: Date, limit: number): Promise<FileRecord[]>;
  deleteRows(workspaceId: string, ids: readonly string[]): Promise<void>;
}

export type LinkKind = 'link' | 'mention' | 'synced_ref';

export interface BacklinkRow {
  sourcePageId: string;
  kinds: LinkKind[];
}

export interface ProjectionRepo {
  /** Writes the body text (title kept), creating the row with `title` when missing. */
  upsertContent(
    workspaceId: string,
    pageId: string,
    title: string,
    plainText: string,
  ): Promise<void>;
  /** Writes the title (body kept), creating the row when missing. */
  setTitle(workspaceId: string, pageId: string, title: string): Promise<void>;
  replaceLinks(
    workspaceId: string,
    pageId: string,
    links: readonly { pageId: string; kind: LinkKind }[],
  ): Promise<void>;
  /** Replaces the mentions; returns those that were not there before. */
  replaceUserMentions(
    workspaceId: string,
    pageId: string,
    mentions: readonly { userId: string; blockId: string | null }[],
  ): Promise<{ userId: string; blockId: string | null }[]>;
  /** Pages linking to `targetPageId`, ordered by source id, `limit` + 1 rows at most. */
  backlinks(
    workspaceId: string,
    targetPageId: string,
    after: string | null,
    limit: number,
  ): Promise<BacklinkRow[]>;
}
