import type { Messages } from '@ardoise/i18n';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: { common: Messages };
  }
}
