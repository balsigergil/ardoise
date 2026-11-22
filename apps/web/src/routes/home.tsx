// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">{t('home.title')}</h1>
      <p className="mt-4 text-muted-foreground">{t('home.body')}</p>
    </div>
  );
}
