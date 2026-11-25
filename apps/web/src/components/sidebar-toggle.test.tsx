// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { InlineSidebarTrigger, SidebarTriggerSlot } from '@/components/sidebar-toggle';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { createI18n } from '@/i18n/i18n';

function Shell({ inline }: { inline: boolean }) {
  return (
    <I18nextProvider i18n={createI18n('en')}>
      <SidebarProvider>
        <SidebarTrigger data-testid="sidebar-collapse" />
        <SidebarTriggerSlot>
          {inline && (
            <nav data-testid="bar">
              <InlineSidebarTrigger />
            </nav>
          )}
        </SidebarTriggerSlot>
      </SidebarProvider>
    </I18nextProvider>
  );
}

const toggles = () => screen.getAllByRole('button', { name: 'Toggle sidebar' });

describe('sidebar toggle placement', () => {
  it('shows only the sidebar button while the sidebar is open', () => {
    render(<Shell inline />);
    expect(toggles()).toHaveLength(1);
    expect(screen.queryByTestId('sidebar-open')).toBeNull();
  });

  it('shows the inline button, not the corner one, once collapsed', () => {
    render(<Shell inline />);
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(screen.getByTestId('bar').querySelector('button')).not.toBeNull();
    expect(screen.queryByTestId('sidebar-open')).toBeNull();
  });

  it('falls back to the corner button in views without a breadcrumb', () => {
    render(<Shell inline={false} />);
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(screen.getByTestId('sidebar-open')).toBeTruthy();
  });
});
