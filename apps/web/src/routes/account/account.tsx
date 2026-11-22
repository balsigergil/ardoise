// SPDX-License-Identifier: AGPL-3.0-only
import { supportedLanguages, type Language } from '@ardoise/i18n';
import { PASSWORD_MIN_LENGTH, type MeDto, type SessionListItemDto } from '@ardoise/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/app-shell';
import { Field, FormError, FormNotice, SubmitButton } from '@/components/forms/form';
import { formValues } from '@/lib/form';
import { OptionSelect } from '@/components/role-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useLogout } from '@/auth/use-logout';
import { useMe, useUpdateMeInCache } from '@/auth/session';
import { changeLanguage } from '@/i18n/i18n';
import { api } from '@/lib/api';
import { themePreferences, type ThemePreference } from '@/theme/theme';
import { useTheme } from '@/theme/theme-context';

function ProfileCard() {
  const { t } = useTranslation();
  const me = useMe();
  const update = useUpdateMeInCache();
  const save = useMutation({
    mutationFn: (name: string) => api.patch<MeDto>('/api/me', { name }),
    onSuccess: update,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.profile')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(formValues(event.currentTarget, 'name').name);
          }}
        >
          <FormError error={save.error} />
          {save.isSuccess && <FormNotice>{t('common.saved')}</FormNotice>}
          <Field
            label={t('auth.fields.name')}
            name="name"
            defaultValue={me.name}
            required
            maxLength={100}
          />
          <Field
            label={t('auth.fields.email')}
            value={me.email}
            readOnly
            disabled
            hint={t('account.emailHint')}
          />
          <SubmitButton pending={save.isPending}>{t('common.save')}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

function PreferencesCard() {
  const { t, i18n } = useTranslation();
  const { preference, setPreference } = useTheme();
  const update = useUpdateMeInCache();
  const save = (patch: { locale?: Language; theme?: ThemePreference }) =>
    void api.patch<MeDto>('/api/me', patch).then(update);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.preferences')}</CardTitle>
      </CardHeader>
      <CardContent className="grid max-w-md gap-4">
        <div className="grid gap-2">
          <Label>{t('preferences.language.label')}</Label>
          <OptionSelect
            value={i18n.language as Language}
            options={supportedLanguages}
            labelPrefix="preferences.language"
            ariaLabel={t('preferences.language.label')}
            onChange={(locale) => {
              void changeLanguage(i18n, locale);
              save({ locale });
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label>{t('preferences.theme.label')}</Label>
          <OptionSelect
            value={preference}
            options={themePreferences}
            labelPrefix="preferences.theme"
            ariaLabel={t('preferences.theme.label')}
            onChange={(theme) => {
              setPreference(theme);
              save({ theme });
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post('/api/me/password', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.password')}</CardTitle>
        <CardDescription>{t('account.passwordHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const v = formValues(form, 'currentPassword', 'newPassword', 'confirmation');
            setMismatch(v.newPassword !== v.confirmation);
            if (v.newPassword === v.confirmation)
              change.mutate(
                { currentPassword: v.currentPassword, newPassword: v.newPassword },
                { onSuccess: () => form.reset() },
              );
          }}
        >
          <FormError error={change.error} />
          {mismatch && <FormNotice>{t('auth.fields.passwordMismatch')}</FormNotice>}
          {change.isSuccess && <FormNotice>{t('account.passwordChanged')}</FormNotice>}
          <Field
            label={t('account.currentPassword')}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
          <Field
            label={t('auth.fields.newPassword')}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            hint={t('auth.fields.passwordHint', { count: PASSWORD_MIN_LENGTH })}
          />
          <Field
            label={t('auth.fields.confirmPassword')}
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
          />
          <SubmitButton pending={change.isPending}>{t('account.changePassword')}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionListItemDto[]>('/api/auth/sessions'),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sessions'] });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api/auth/sessions/${id}`),
    onSettled: refresh,
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.post('/api/auth/sessions/revoke-others'),
    onSettled: refresh,
  });
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.sessions')}</CardTitle>
        <CardDescription>{t('account.sessionsHint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {sessions.isPending && <Skeleton className="h-16" />}
        <FormError error={sessions.error ?? revoke.error ?? revokeOthers.error} />
        {sessions.data?.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
            data-testid="session-row"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{s.userAgent ?? t('account.unknownDevice')}</div>
              <div className="text-xs text-muted-foreground">
                {t('account.lastSeen', { date: date.format(new Date(s.lastSeenAt)) })}
                {s.ip ? ` · ${s.ip}` : ''}
              </div>
            </div>
            {s.current ? (
              <Badge>{t('account.currentSession')}</Badge>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                {t('account.revoke')}
              </Button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => revokeOthers.mutate()}
            disabled={(sessions.data?.length ?? 0) < 2}
          >
            {t('account.revokeOthers')}
          </Button>
          <Button variant="outline" onClick={() => logout.mutate()}>
            {t('auth.logout')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AccountPage() {
  const { t } = useTranslation();
  return (
    <PageContainer title={t('account.title')}>
      <div className="grid gap-6">
        <ProfileCard />
        <PreferencesCard />
        <PasswordCard />
        <SessionsCard />
      </div>
    </PageContainer>
  );
}
