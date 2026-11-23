// SPDX-License-Identifier: AGPL-3.0-only
/** Uploads and file URLs for the editor (ARCHITECTURE §4.7). */
import { isErrorCode, type FileDto } from '@ardoise/shared';
import { createContext, use } from 'react';
import { ApiError, currentCsrfToken } from '@/lib/api';

/** Builds URLs of files embedded in a page: signed-in users or a public link. */
export interface FileUrls {
  file(fileId: string): string;
  thumbnail(fileId: string): string;
}

export function workspaceFileUrls(workspaceId: string): FileUrls {
  return {
    file: (id) => `/files/${workspaceId}/${id}`,
    thumbnail: (id) => `/files/${workspaceId}/${id}?thumb=1`,
  };
}

export function publicFileUrls(token: string): FileUrls {
  return {
    file: (id) => `/api/public/${token}/files/${id}`,
    thumbnail: (id) => `/api/public/${token}/files/${id}?thumb=1`,
  };
}

export const FileUrlsContext = createContext<FileUrls | null>(null);

export function useFileUrls(): FileUrls | null {
  return use(FileUrlsContext);
}

/** Uploads one file to a page (multipart, CSRF header). */
export async function uploadFile(
  workspaceId: string,
  pageId: string,
  file: File,
): Promise<FileDto> {
  const form = new FormData();
  form.append('file', file, file.name);
  const headers: Record<string, string> = { accept: 'application/json' };
  const csrf = currentCsrfToken();
  if (csrf) headers['x-csrf-token'] = csrf;
  let res: Response;
  try {
    res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/files`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: form,
    });
  } catch {
    throw new ApiError(0, 'internal_error');
  }
  if (!res.ok) {
    let code: unknown;
    try {
      code = ((await res.json()) as { error?: { code?: string } }).error?.code;
    } catch {
      code = undefined;
    }
    throw new ApiError(
      res.status,
      isErrorCode(code) ? code : res.status === 413 ? 'file_too_large' : 'internal_error',
    );
  }
  return (await res.json()) as FileDto;
}

/** Human-readable size (B, KB, MB, GB) in the given locale. */
export function formatSize(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
