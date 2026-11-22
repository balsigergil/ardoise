// SPDX-License-Identifier: AGPL-3.0-only
import type { SessionDto } from '@ardoise/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Field, FormError, SubmitButton } from '@/components/forms/form';
import { formValues } from '@/lib/form';
import { PublicLayout } from '@/components/public-layout';
import { applySession } from '@/auth/session';
import { api } from '@/lib/api';
import { safeRedirect } from '@/lib/redirect';

export function LoginPage({ redirect }: { redirect?: string | undefined }) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const login = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post<SessionDto>('/api/auth/login', body),
    onSuccess: (session) => {
      applySession(queryClient, session);
      router.history.push(safeRedirect(redirect) ?? '/');
    },
  });

  return (
    <PublicLayout title={t('auth.login.title')} description={t('auth.login.description')}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate(formValues(event.currentTarget, 'email', 'password'));
        }}
      >
        <FormError error={login.error} />
        <Field
          label={t('auth.fields.email')}
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
        />
        <Field
          label={t('auth.fields.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <SubmitButton pending={login.isPending}>{t('auth.login.submit')}</SubmitButton>
        <Link
          to="/forgot-password"
          className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('auth.login.forgot')}
        </Link>
      </form>
    </PublicLayout>
  );
}
