// SPDX-License-Identifier: AGPL-3.0-only
import { PASSWORD_MIN_LENGTH } from '@ardoise/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FormError, FormNotice, SubmitButton } from '@/components/forms/form';
import { formValues } from '@/lib/form';
import { PublicLayout } from '@/components/public-layout';
import { Button } from '@/components/ui/button';
import { api, tokenFromHash } from '@/lib/api';

export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const request = useMutation({
    mutationFn: (email: string) =>
      api.post('/api/auth/password-reset/request', { email, locale: i18n.language }),
  });
  return (
    <PublicLayout title={t('auth.forgot.title')} description={t('auth.forgot.description')}>
      {request.isSuccess ? (
        <div className="grid gap-4">
          <FormNotice>{t('auth.forgot.sent')}</FormNotice>
          <Button asChild variant="outline">
            <Link to="/login">{t('auth.backToLogin')}</Link>
          </Button>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate(formValues(event.currentTarget, 'email').email);
          }}
        >
          <FormError error={request.error} />
          <Field
            label={t('auth.fields.email')}
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
          />
          <SubmitButton pending={request.isPending}>{t('auth.forgot.submit')}</SubmitButton>
          <Link
            to="/login"
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('auth.backToLogin')}
          </Link>
        </form>
      )}
    </PublicLayout>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [token] = useState(() => tokenFromHash(globalThis.location?.hash ?? ''));
  const [mismatch, setMismatch] = useState(false);
  const confirm = useMutation({
    mutationFn: (password: string) =>
      api.post('/api/auth/password-reset/confirm', { token, password }),
  });
  return (
    <PublicLayout title={t('auth.reset.title')}>
      {!token ? (
        <FormNotice>{t('errors.codes.reset_token_invalid')}</FormNotice>
      ) : confirm.isSuccess ? (
        <div className="grid gap-4">
          <FormNotice>{t('auth.reset.done')}</FormNotice>
          <Button asChild>
            <Link to="/login">{t('auth.login.submit')}</Link>
          </Button>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const { password, confirmation } = formValues(
              event.currentTarget,
              'password',
              'confirmation',
            );
            setMismatch(password !== confirmation);
            if (password === confirmation) confirm.mutate(password);
          }}
        >
          <FormError error={confirm.error} />
          {mismatch && <FormNotice>{t('auth.fields.passwordMismatch')}</FormNotice>}
          <Field
            label={t('auth.fields.newPassword')}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            hint={t('auth.fields.passwordHint', { count: PASSWORD_MIN_LENGTH })}
            autoFocus
          />
          <Field
            label={t('auth.fields.confirmPassword')}
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
          />
          <SubmitButton pending={confirm.isPending}>{t('auth.reset.submit')}</SubmitButton>
        </form>
      )}
    </PublicLayout>
  );
}
