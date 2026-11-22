// SPDX-License-Identifier: AGPL-3.0-only
import { PASSWORD_MIN_LENGTH, type SessionDto } from '@ardoise/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FormError, FormNotice, SubmitButton } from '@/components/forms/form';
import { formValues } from '@/lib/form';
import { PublicLayout } from '@/components/public-layout';
import { applySession, setupStatusQuery } from '@/auth/session';
import { api, tokenFromHash } from '@/lib/api';

export function SetupPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [token] = useState(() => tokenFromHash(globalThis.location?.hash ?? ''));
  const setup = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.post<{ session: SessionDto; workspaceId: string }>('/api/setup', {
        ...body,
        token,
        locale: i18n.language,
      }),
    onSuccess: ({ session, workspaceId }) => {
      applySession(queryClient, session);
      queryClient.setQueryData(setupStatusQuery.queryKey, { required: false });
      void router.navigate({ to: '/w/$workspaceId', params: { workspaceId }, replace: true });
    },
  });

  return (
    <PublicLayout title={t('auth.setup.title')} description={t('auth.setup.description')}>
      {!token ? (
        <FormNotice>{t('auth.setup.missingToken')}</FormNotice>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setup.mutate(
              formValues(event.currentTarget, 'name', 'email', 'password', 'workspaceName'),
            );
          }}
        >
          <FormError error={setup.error} />
          <Field
            label={t('auth.fields.name')}
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            autoFocus
          />
          <Field
            label={t('auth.fields.email')}
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <Field
            label={t('auth.fields.password')}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            hint={t('auth.fields.passwordHint', { count: PASSWORD_MIN_LENGTH })}
          />
          <Field
            label={t('auth.setup.workspaceName')}
            name="workspaceName"
            required
            maxLength={100}
          />
          <SubmitButton pending={setup.isPending}>{t('auth.setup.submit')}</SubmitButton>
        </form>
      )}
    </PublicLayout>
  );
}
