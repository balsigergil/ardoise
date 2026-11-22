// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMail } from './templates.js';

const expiresAt = new Date('2026-03-08T10:00:00Z');

describe('renderMail', () => {
  it('renders a workspace invitation in English', () => {
    const mail = renderMail(
      {
        kind: 'invitationWorkspace',
        inviter: 'Olivia',
        workspace: 'Acme',
        link: 'https://a.test/invite#token=t',
        expiresAt,
      },
      'en',
      'https://a.test',
    );
    expect(mail.subject).toBe('Olivia invited you to Acme');
    expect(mail.text).toContain('Accept the invitation: https://a.test/invite#token=t');
    expect(mail.text).toContain('March 8, 2026');
    expect(mail.html).toContain('href="https://a.test/invite#token=t"');
  });

  it('renders in French', () => {
    const mail = renderMail(
      { kind: 'passwordReset', email: 'a@b.test', link: 'https://a.test/r#token=t' },
      'fr',
      'https://a.test',
    );
    expect(mail.subject).toBe('Réinitialiser votre mot de passe Ardoise');
    expect(mail.text).toContain('a@b.test');
    expect(mail.text).toContain('https://a.test/r#token=t');
  });

  it('escapes user-provided values in HTML', () => {
    const mail = renderMail(
      {
        kind: 'invitationInstance',
        inviter: '<script>x</script>',
        link: 'https://a.test/i#token=t',
        expiresAt,
      },
      'en',
      'https://a.test',
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&#60;script&#62;');
  });

  it('renders the test email without a link', () => {
    const mail = renderMail({ kind: 'test' }, 'en', 'https://a.test');
    expect(mail.subject).toBe('Ardoise test email');
    expect(mail.html).not.toContain('<a ');
  });

  it('escapes all HTML metacharacters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&#38;&#60;&#62;&#34;&#39;');
  });
});
