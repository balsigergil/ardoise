// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { workspaceQuery } from '@/lib/queries';

export function WorkspaceHomePage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const workspace = useQuery(workspaceQuery(workspaceId)).data;
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">{t('home.title')}</h1>
      {workspace && <p className="mt-2 text-lg">{workspace.name}</p>}
      <p className="mt-4 text-muted-foreground">{t('home.body')}</p>
    </div>
  );
}
