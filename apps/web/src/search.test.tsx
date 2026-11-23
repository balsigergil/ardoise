// SPDX-License-Identifier: AGPL-3.0-only
/** M3 search screens: quick find (Ctrl/Cmd+K) and the full search page. */
import type { QuickFindDto, SearchResultsDto } from '@ardoise/shared';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { editedAfter, searchPath, snippetParts } from '@/components/search/snippet';
import { mockApi, renderApp, signedIn, workspace } from '@/test-utils';

const WS = workspace.id;
const PAGE = '0190a000-0000-7000-8000-0000000000c1';

describe('search helpers', () => {
  it('splits snippets into matched parts without HTML', () => {
    expect(snippetParts('a \u0002b\u0003 <i>c</i> \u0002d')).toEqual([
      { text: 'a ', match: false },
      { text: 'b', match: true },
      { text: ' <i>c</i> ', match: false },
      { text: 'd', match: true },
    ]);
    expect(snippetParts('')).toEqual([]);
  });

  it('builds search URLs with filters', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    expect(editedAfter('week', now)).toBe('2026-11-16T12:00:00.000Z');
    expect(editedAfter('', now)).toBeUndefined();
    const path = searchPath(
      WS,
      { q: 'été', titleOnly: true, teamspaceId: 't', createdBy: '', edited: '' },
      'c1',
    );
    expect(path).toBe(
      `/api/workspaces/${WS}/search?q=%C3%A9t%C3%A9&limit=20&titleOnly=true&teamspaceId=t&cursor=c1`,
    );
  });
});

const quick: QuickFindDto = {
  items: [{ id: PAGE, title: 'Roadmap 2026', icon: null, path: ['Plans'] }],
};

describe('quick find', () => {
  it('opens with Ctrl+K, finds titles and opens the page', async () => {
    mockApi({
      ...signedIn(),
      [`GET /api/workspaces/${WS}/search/quick`]: { body: quick },
    });
    const { router } = await renderApp(`/w/${WS}`);
    const user = userEvent.setup();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    const input = await screen.findByLabelText('Search pages…');
    await user.type(input, 'road');
    const option = await screen.findByRole('option', { name: /Roadmap 2026/ });
    expect(option.textContent).toContain('Plans');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/${WS}/p/${PAGE}`));
  });

  it('offers a full-text search of the query', async () => {
    mockApi({
      ...signedIn(),
      [`GET /api/workspaces/${WS}/search/quick`]: { body: { items: [] } },
      [`GET /api/workspaces/${WS}/search`]: { body: { items: [], nextCursor: null } },
    });
    const { router } = await renderApp(`/w/${WS}`);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('search-button'));
    await user.type(await screen.findByLabelText('Search pages…'), 'budget');
    await user.click(await screen.findByRole('option', { name: /Search “budget” in all content/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/${WS}/search`));
    expect(router.state.location.search).toEqual({ q: 'budget' });
  });
});

describe('search page', () => {
  it('shows results with highlighted snippets and sends filters', async () => {
    const results: SearchResultsDto = {
      items: [
        {
          id: PAGE,
          title: 'Budget',
          icon: null,
          path: ['Finance'],
          snippet: 'the \u0002budget\u0003 for 2026',
          updatedAt: '2026-11-01T00:00:00.000Z',
          createdBy: null,
        },
      ],
      nextCursor: null,
    };
    const { calls } = mockApi({
      ...signedIn(),
      [`GET /api/workspaces/${WS}/search`]: { body: results },
      [`GET /api/workspaces/${WS}/members`]: { body: { items: [], nextCursor: null } },
    });
    await renderApp(`/w/${WS}/search?q=budget`, 'fr');
    const mark = await screen.findByText('budget', { selector: 'mark' });
    expect(mark).toBeTruthy();
    expect(screen.getByText('Finance')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Titres uniquement'));
    await waitFor(() => expect(calls.some((c) => c.path.includes('titleOnly=true'))).toBe(true));
  });
});
