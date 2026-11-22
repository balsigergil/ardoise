// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">{t('errors.notFound.title')}</h1>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/">{t('errors.notFound.back')}</Link>
      </Button>
    </div>
  );
}
