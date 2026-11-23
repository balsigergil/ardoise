// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bookmark previews (PRODUCT §6.2, ADR 0009 §9): title, description and site name of a
 * public web page, fetched by the server through the SSRF guard. Remote images are
 * never used (strict CSP).
 */
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { DomainError, isUuidV7, type LinkPreviewDto } from '@ardoise/shared';
import type { RateLimiter } from '../common/rate-limit.js';
import type { Store, UserRecord } from '../store/store.js';
import { guardedLookup } from './ssrf.js';

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

export interface FetchedPage {
  status: number;
  contentType: string;
  location?: string;
  body: string;
}

/** Fetches one URL (no redirects followed). */
export type PageFetcher = (url: URL) => Promise<FetchedPage>;

/** The real fetcher: guarded DNS, timeout, size cap, HTML only. */
export const guardedFetch: PageFetcher = (url) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        lookup: guardedLookup(),
        timeout: TIMEOUT_MS,
        headers: {
          'user-agent': 'Ardoise link preview',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en, fr;q=0.8',
        },
      },
      (res: IncomingMessage) => {
        const contentType = String(res.headers['content-type'] ?? '');
        const location = res.headers.location;
        if (!/html/i.test(contentType) || (res.statusCode ?? 0) >= 300) {
          res.resume();
          resolve({
            status: res.statusCode ?? 0,
            contentType,
            ...(location && { location }),
            body: '',
          });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('close', () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const clean = (value: string | undefined, max: number) =>
  decodeEntities(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Extracts title, description and site name from the head of an HTML page. */
export function parsePreview(html: string, url: URL): Omit<LinkPreviewDto, 'url'> {
  const head = html.slice(0, 256 * 1024);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\s[^>]*>/gi) ?? []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? title, 300),
    description: clean(
      meta.get('og:description') ?? meta.get('description') ?? meta.get('twitter:description'),
      500,
    ),
    siteName: clean(meta.get('og:site_name'), 100) || url.hostname,
  };
}

export class LinkPreviewService {
  constructor(
    private readonly store: Store,
    private readonly limiter: Pick<RateLimiter, 'consume'>,
    private readonly fetchPage: PageFetcher = guardedFetch,
  ) {}

  async preview(actor: UserRecord, workspaceId: string, rawUrl: string): Promise<LinkPreviewDto> {
    if (
      !isUuidV7(workspaceId) ||
      !(await this.store.workspaces.membership(workspaceId, actor.id))
    ) {
      throw new DomainError('not_found');
    }
    await this.limiter.consume('linkPreviewUser', actor.id);
    let url = new URL(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') break;
      if (url.username || url.password) break;
      let page: FetchedPage;
      try {
        page = await this.fetchPage(url);
      } catch {
        break;
      }
      if (page.status >= 300 && page.status < 400 && page.location) {
        url = new URL(page.location, url);
        continue;
      }
      if (page.status >= 200 && page.status < 300 && page.body) {
        return { url: rawUrl, ...parsePreview(page.body, url) };
      }
      break;
    }
    throw new DomainError('preview_unavailable');
  }
}
