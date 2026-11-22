// SPDX-License-Identifier: AGPL-3.0-only
import type { Language } from '@ardoise/i18n';
import { DomainError } from '@ardoise/shared';
import nodemailer from 'nodemailer';
import type {
  EffectiveSmtp,
  InstanceSettingsService,
} from '../settings/instance-settings.service.js';
import { renderMail, type MailTemplate, type RenderedMail } from './templates.js';

export interface OutgoingMail extends RenderedMail {
  from: string;
  to: string;
}

export type MailTransport = (smtp: EffectiveSmtp, mail: OutgoingMail) => Promise<void>;

export const nodemailerTransport: MailTransport = async (smtp, mail) => {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transport.sendMail(mail);
  } finally {
    transport.close();
  }
};

export interface MailLogger {
  warn(message: string): void;
}

/** `mail` module (ARCHITECTURE §3): SMTP via nodemailer, i18n templates. */
export class MailService {
  constructor(
    private readonly settings: InstanceSettingsService,
    private readonly publicUrl: string,
    private readonly transport: MailTransport,
    private readonly logger: MailLogger,
  ) {}

  async isEnabled(): Promise<boolean> {
    return (await this.settings.effectiveSmtp()) !== undefined;
  }

  /** Throws `mail_not_configured` or `mail_failed`. The error detail is logged, not returned. */
  async send(to: string, template: MailTemplate, language: Language): Promise<void> {
    const smtp = await this.settings.effectiveSmtp();
    if (!smtp) throw new DomainError('mail_not_configured');
    const rendered = renderMail(template, language, this.publicUrl);
    try {
      await this.transport(smtp, { ...rendered, from: smtp.from, to });
    } catch (error) {
      this.logger.warn(
        `email delivery failed (${template.kind}): ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new DomainError('mail_failed');
    }
  }

  /** Best effort: returns whether the email was sent. */
  async trySend(to: string, template: MailTemplate, language: Language): Promise<boolean> {
    try {
      await this.send(to, template, language);
      return true;
    } catch (error) {
      if (error instanceof DomainError) return false;
      throw error;
    }
  }
}
