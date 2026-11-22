// SPDX-License-Identifier: AGPL-3.0-only
import { RouterProvider } from '@tanstack/react-router';
import type { i18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { createAppRouter } from '@/router';
import { ThemeProvider } from '@/theme/theme-provider';

export function App({ i18n, router }: { i18n: i18n; router: ReturnType<typeof createAppRouter> }) {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
