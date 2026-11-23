// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';
import {
  decodeEntities,
  LinkPreviewService,
  parsePreview,
  type FetchedPage,
} from './link-preview.service.js';

const html = (head: string) => `<!doctype html><html><head>${head}</head><body>x</body></html>`;

describe('parsePreview', () => {
  it('prefers Open Graph tags and decodes entities', () => {
    const preview = parsePreview(
      html(
        `<title>Fallback</title><meta property="og:title" content="Caf&eacute; &amp; Co"><meta name="description" content="  A   place &#x2014; nice ">
         <meta property="og:site_name" content="Example">`,
      ),
      new URL('https://example.test/a'),
    );
    expect(preview).toEqual({
      title: 'Caf&eacute; & Co',
      description: 'A place — nice',
      siteName: 'Example',
    });
  });

  it('falls back to <title> and the host name', () => {
    expect(
      parsePreview(html('<title>Hello\n world</title>'), new URL('https://site.test/')),
    ).toEqual({
      title: 'Hello world',
      description: '',
      siteName: 'site.test',
    });
  });

  it('decodes numeric entities only within range', () => {
    expect(decodeEntities('&#65;&#x42;&#0;&bogus;')).toBe('AB&#0;&bogus;');
  });
});

describe('LinkPreviewService', () => {
  async function setup(pages: Record<string, FetchedPage | Error>) {
    const h = createHarness();
    const user = await h.createUser();
    const ws = await h.createWorkspace(user);
    const fetched: string[] = [];
    const service = new LinkPreviewService(h.store, { consume: () => Promise.resolve() }, (url) => {
      fetched.push(url.href);
      const page = pages[url.href];
      if (!page) return Promise.reject(new Error('unreachable'));
      return page instanceof Error ? Promise.reject(page) : Promise.resolve(page);
    });
    return { h, user, ws, service, fetched };
  }

  it('follows a few redirects and returns the preview', async () => {
    const { service, user, ws, fetched } = await setup({
      'https://short.test/x': {
        status: 301,
        contentType: 'text/html',
        location: 'https://site.test/page',
        body: '',
      },
      'https://site.test/page': {
        status: 200,
        contentType: 'text/html',
        body: html('<title>Target</title>'),
      },
    });
    expect(await service.preview(user, ws.id, 'https://short.test/x')).toEqual({
      url: 'https://short.test/x',
      title: 'Target',
      description: '',
      siteName: 'site.test',
    });
    expect(fetched).toEqual(['https://short.test/x', 'https://site.test/page']);
  });

  it('fails cleanly on blocked or unreachable targets and on redirect loops', async () => {
    const loop: FetchedPage = {
      status: 302,
      contentType: 'text/html',
      location: 'https://loop.test/',
      body: '',
    };
    const { service, user, ws } = await setup({
      'https://loop.test/': loop,
      'https://blocked.test/': new Error('address not allowed'),
      'https://nothtml.test/': { status: 200, contentType: 'application/pdf', body: '' },
    });
    for (const url of [
      'https://loop.test/',
      'https://blocked.test/',
      'https://nothtml.test/',
      'https://down.test/',
    ]) {
      await expect(service.preview(user, ws.id, url), url).rejects.toMatchObject({
        code: 'preview_unavailable',
      });
    }
  });

  it('refuses redirects to other schemes and URLs with credentials', async () => {
    const { service, user, ws, fetched } = await setup({
      'https://a.test/': {
        status: 302,
        contentType: 'text/html',
        location: 'file:///etc/passwd',
        body: '',
      },
    });
    await expect(service.preview(user, ws.id, 'https://a.test/')).rejects.toMatchObject({
      code: 'preview_unavailable',
    });
    await expect(service.preview(user, ws.id, 'https://u:p@a.test/')).rejects.toMatchObject({
      code: 'preview_unavailable',
    });
    expect(fetched).toEqual(['https://a.test/']);
  });

  it('is for workspace members only', async () => {
    const { h, service, ws } = await setup({});
    const stranger = await h.createUser();
    await expect(service.preview(stranger, ws.id, 'https://a.test/')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
