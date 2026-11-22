// SPDX-License-Identifier: AGPL-3.0-only
import type { WorkspaceDto } from '@ardoise/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/app-shell';
import { Field, FormError, FormNotice, SubmitButton } from '@/components/forms/form';
import { formValues } from '@/lib/form';
import { instanceInfoQuery, useMe } from '@/auth/session';
import { api } from '@/lib/api';
import { workspacesQuery } from '@/lib/queries';

export function NewWorkspaceForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const info = useQuery(instanceInfoQuery).data;
  const create = useMutation({
    mutationFn: (body: { name: string; icon: string | null }) =>
      api.post<WorkspaceDto>('/api/workspaces', body),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: workspacesQuery.queryKey });
      void router.navigate({ to: '/w/$workspaceId', params: { workspaceId: workspace.id } });
    },
  });
  if (info?.workspaceCreation === 'super_admins' && !me.isSuperAdmin)
    return <FormNotice>{t('errors.codes.workspace_creation_disabled')}</FormNotice>;
  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const { name, icon } = formValues(event.currentTarget, 'name', 'icon');
        create.mutate({ name, icon: icon.trim() || null });
      }}
    >
      <FormError error={create.error} />
      <Field label={t('workspace.fields.name')} name="name" required maxLength={100} autoFocus />
      <Field
        label={t('workspace.fields.icon')}
        name="icon"
        maxLength={16}
        hint={t('workspace.fields.iconHint')}
      />
      <SubmitButton pending={create.isPending}>{t('workspace.create')}</SubmitButton>
    </form>
  );
}

export function NewWorkspacePage() {
  const { t } = useTranslation();
  return (
    <PageContainer title={t('workspace.create')}>
      <NewWorkspaceForm />
    </PageContainer>
  );
}

/** Shown when the user belongs to no workspace yet. */
export function NoWorkspacePage() {
  const { t } = useTranslation();
  return (
    <PageContainer title={t('workspace.none.title')}>
      <p className="mb-6 text-muted-foreground">{t('workspace.none.body')}</p>
      <NewWorkspaceForm />
    </PageContainer>
  );
}
