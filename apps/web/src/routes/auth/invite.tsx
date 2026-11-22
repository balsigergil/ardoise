// SPDX-License-Identifier: AGPL-3.0-only
import {
  PASSWORD_MIN_LENGTH,
  type AcceptedInvitationDto,
  type InvitationPreviewDto,
} from '@ardoise/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FormError, FormNotice, SubmitButton } from '@/components/forms/form';
import { formValues } from '@/lib/form';
import { PublicLayout } from '@/components/public-layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { applySession, useSession } from '@/auth/session';
import { useHashToken } from '@/hooks/use-hash-token';
import { api } from '@/lib/api';

export function InvitePage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const token = useHashToken();
  const [mismatch, setMismatch] = useState(false);

  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.post<InvitationPreviewDto>('/api/invitations/preview', { token }),
    enabled: token !== undefined,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: (body: { name?: string; password?: string }) =>
      api.post<AcceptedInvitationDto>('/api/invitations/accept', {
        token,
        locale: i18n.language,
        ...body,
      }),
    onSuccess: ({ session: next, workspaceId }) => {
      applySession(queryClient, next);
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      if (workspaceId)
        void router.navigate({ to: '/w/$workspaceId', params: { workspaceId }, replace: true });
      else void router.navigate({ to: '/', replace: true });
    },
  });

  const invitation = preview.data;
  const title = invitation?.workspaceName
    ? t('auth.invite.titleWorkspace', { workspace: invitation.workspaceName })
    : t('auth.invite.title');
  const description = invitation
    ? invitation.inviterName
      ? t('auth.invite.invitedBy', { inviter: invitation.inviterName, email: invitation.email })
      : t('auth.invite.invitedAs', { email: invitation.email })
    : undefined;

  let content;
  if (!token) content = <FormNotice>{t('errors.codes.invitation_not_found')}</FormNotice>;
  else if (preview.isPending) content = <Skeleton className="h-32 w-full" />;
  else if (preview.error) content = <FormError error={preview.error} />;
  else if (invitation?.hasAccount) {
    const signedInAsInvitee = session?.user.email === invitation.email;
    content = signedInAsInvitee ? (
      <div className="grid gap-4">
        <FormError error={accept.error} />
        <Button onClick={() => accept.mutate({})} disabled={accept.isPending}>
          {t('auth.invite.join')}
        </Button>
      </div>
    ) : (
      <div className="grid gap-4">
        <FormNotice>{t('auth.invite.signInFirst', { email: invitation.email })}</FormNotice>
        <Button asChild>
          <Link to="/login" search={{ redirect: `/invite#token=${token}` }}>
            {t('auth.login.submit')}
          </Link>
        </Button>
      </div>
    );
  } else if (invitation) {
    content = (
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const { name, password, confirmation } = formValues(
            event.currentTarget,
            'name',
            'password',
            'confirmation',
          );
          setMismatch(password !== confirmation);
          if (password === confirmation) accept.mutate({ name, password });
        }}
      >
        <FormError error={accept.error} />
        {mismatch && <FormNotice>{t('auth.fields.passwordMismatch')}</FormNotice>}
        <Field label={t('auth.fields.email')} value={invitation.email} readOnly disabled />
        <Field
          label={t('auth.fields.name')}
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          autoFocus
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
          label={t('auth.fields.confirmPassword')}
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
        />
        <SubmitButton pending={accept.isPending}>{t('auth.invite.createAccount')}</SubmitButton>
      </form>
    );
  }

  return (
    <PublicLayout title={title} description={description}>
      {content}
    </PublicLayout>
  );
}
