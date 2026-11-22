// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { i18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { createAppRouter } from '@/router';
import { ThemeProvider } from '@/theme/theme-provider';

export function App({
  i18n,
  router,
  queryClient,
}: {
  i18n: i18n;
  router: ReturnType<typeof createAppRouter>;
  queryClient: QueryClient;
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
