// SPDX-License-Identifier: AGPL-3.0-only
// Based on shadcn/ui (MIT), see THIRD_PARTY_NOTICES.md; themed with Ardoise's provider.
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '@/theme/theme-context';

function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
