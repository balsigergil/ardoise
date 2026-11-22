// SPDX-License-Identifier: AGPL-3.0-only
import { interpolate, lookup, resources, type Language } from '@ardoise/i18n';

export type MailTemplate =
  | {
      kind: 'invitationWorkspace';
      inviter: string;
      workspace: string;
      link: string;
      expiresAt: Date;
    }
  | { kind: 'invitationInstance'; inviter: string; link: string; expiresAt: Date }
  | { kind: 'passwordReset'; email: string; link: string }
  | { kind: 'test' };

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function formatDate(date: Date, language: Language): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

/** Renders a localized email (text + minimal HTML) from the `email` namespace. */
export function renderMail(
  template: MailTemplate,
  language: Language,
  instanceUrl: string,
): RenderedMail {
  const messages = resources[language].email;
  const t = (key: string, vars: Record<string, string> = {}) =>
    interpolate(lookup(messages, key) ?? key, vars);

  const vars: Record<string, string> = { instanceUrl };
  let link: string | undefined;
  if (template.kind === 'invitationWorkspace' || template.kind === 'invitationInstance') {
    vars.inviter = template.inviter;
    vars.date = formatDate(template.expiresAt, language);
    link = template.link;
  }
  if (template.kind === 'invitationWorkspace') vars.workspace = template.workspace;
  if (template.kind === 'passwordReset') {
    vars.email = template.email;
    link = template.link;
  }

  const k = template.kind;
  const paragraphs = [t('greeting'), t(`${k}.body`, vars)];
  const after = k === 'test' ? [] : [t(`${k}.expiry`, vars), t('ignore')];
  const footer = t('footer', vars);
  const action = link ? t(`${k}.action`) : undefined;

  const text = [
    ...paragraphs,
    ...(link && action ? [`${action}: ${link}`] : []),
    ...after,
    '--',
    footer,
  ].join('\n\n');

  const p = (s: string) => `<p>${escapeHtml(s)}</p>`;
  const html = [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">',
    ...paragraphs.map(p),
    link && action ? `<p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p>` : '',
    ...after.map(p),
    `<hr><p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>`,
    '</body></html>',
  ].join('');

  return { subject: t(`${k}.subject`, vars), text, html };
}
