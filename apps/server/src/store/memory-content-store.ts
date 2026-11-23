// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/require-await -- fakes mirror the async repository interface */
import type {
  DocumentRecord,
  DocumentsRepo,
  FileRecord,
  FilesRepo,
  LinkKind,
  ProjectionRepo,
} from './content-store.js';
import type { MemorySyncData } from './memory-sync-store.js';

export interface MemoryContentData {
  documents: Map<string, DocumentRecord>;
  files: Map<string, FileRecord>;
  search: Map<string, { workspaceId: string; pageId: string; title: string; plainText: string }>;
  links: { workspaceId: string; sourcePageId: string; targetPageId: string; kind: LinkKind }[];
  mentions: { workspaceId: string; pageId: string; userId: string; blockId: string }[];
}

export function emptyContentData(): MemoryContentData {
  return { documents: new Map(), files: new Map(), search: new Map(), links: [], mentions: [] };
}

const k = (ws: string, id: string) => `${ws}/${id}`;

export function memoryDocumentsRepo(d: MemoryContentData): DocumentsRepo {
  return {
    find: async (ws, name) => d.documents.get(k(ws, name)),
    upsert: async (record) => {
      d.documents.set(k(record.workspaceId, record.docName), { ...record });
    },
  };
}

export function memoryFilesRepo(d: MemoryContentData, sync: MemorySyncData): FilesRepo {
  return {
    insert: async (file) => {
      d.files.set(k(file.workspaceId, file.id), { ...file });
    },
    findById: async (ws, id) => d.files.get(k(ws, id)),
    update: async (ws, id, patch) => {
      const file = d.files.get(k(ws, id));
      if (file) d.files.set(k(ws, id), { ...file, ...patch });
    },
    markDeletedUnder: async (ws, path, at) => {
      const pages = new Set(
        [...sync.pages.values()]
          .filter((p) => p.workspaceId === ws && (p.path === path || p.path.startsWith(`${path}.`)))
          .map((p) => p.id),
      );
      let n = 0;
      for (const file of d.files.values()) {
        if (file.workspaceId === ws && !file.deletedAt && pages.has(file.pageId)) {
          file.deletedAt = at;
          n++;
        }
      }
      return n;
    },
    listDeleted: async (before, limit) =>
      [...d.files.values()]
        .filter((f) => f.deletedAt && f.deletedAt < before)
        .sort((a, b) => a.deletedAt!.getTime() - b.deletedAt!.getTime())
        .slice(0, limit),
    deleteRows: async (ws, ids) => {
      for (const id of ids) d.files.delete(k(ws, id));
    },
  };
}

export function memoryProjectionRepo(d: MemoryContentData): ProjectionRepo {
  return {
    upsertContent: async (ws, pageId, title, plainText) => {
      const row = d.search.get(k(ws, pageId));
      d.search.set(k(ws, pageId), {
        workspaceId: ws,
        pageId,
        title: row?.title ?? title,
        plainText,
      });
    },
    setTitle: async (ws, pageId, title) => {
      const row = d.search.get(k(ws, pageId));
      d.search.set(k(ws, pageId), {
        workspaceId: ws,
        pageId,
        title,
        plainText: row?.plainText ?? '',
      });
    },
    replaceLinks: async (ws, pageId, links) => {
      d.links = d.links.filter((l) => !(l.workspaceId === ws && l.sourcePageId === pageId));
      const seen = new Set<string>();
      for (const link of links) {
        const id = `${link.pageId}:${link.kind}`;
        if (seen.has(id)) continue;
        seen.add(id);
        d.links.push({
          workspaceId: ws,
          sourcePageId: pageId,
          targetPageId: link.pageId,
          kind: link.kind,
        });
      }
    },
    replaceUserMentions: async (ws, pageId, mentions) => {
      const mine = (m: { workspaceId: string; pageId: string }) =>
        m.workspaceId === ws && m.pageId === pageId;
      const known = new Set(d.mentions.filter(mine).map((m) => `${m.userId}:${m.blockId}`));
      d.mentions = d.mentions.filter((m) => !mine(m));
      for (const m of mentions)
        d.mentions.push({ workspaceId: ws, pageId, userId: m.userId, blockId: m.blockId ?? '' });
      return mentions.filter((m) => !known.has(`${m.userId}:${m.blockId ?? ''}`));
    },
    backlinks: async (ws, target, after, limit) => {
      const bySource = new Map<string, LinkKind[]>();
      for (const l of d.links) {
        if (l.workspaceId !== ws || l.targetPageId !== target) continue;
        if (after && l.sourcePageId <= after) continue;
        bySource.set(l.sourcePageId, [...(bySource.get(l.sourcePageId) ?? []), l.kind].sort());
      }
      return [...bySource.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .slice(0, limit + 1)
        .map(([sourcePageId, kinds]) => ({ sourcePageId, kinds }));
    },
  };
}
