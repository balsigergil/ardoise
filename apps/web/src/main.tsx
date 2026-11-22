// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { createQueryClient } from '@/lib/query-client';
import { browserI18n } from '@/i18n/i18n';
import { createAppRouter } from '@/router';
import { applyTheme, parseThemePreference, resolveTheme, THEME_STORAGE_KEY } from '@/theme/theme';
import { safeStorage } from '@/lib/storage';
import './index.css';

// Apply the theme before the first render to avoid a flash of the wrong theme.
applyTheme(
  document.documentElement,
  resolveTheme(
    parseThemePreference(safeStorage.get(THEME_STORAGE_KEY)),
    globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  ),
);

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

const queryClient = createQueryClient();

createRoot(root).render(
  <StrictMode>
    <App i18n={browserI18n()} router={createAppRouter(queryClient)} queryClient={queryClient} />
  </StrictMode>,
);
