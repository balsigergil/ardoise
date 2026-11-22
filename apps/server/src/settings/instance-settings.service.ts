// SPDX-License-Identifier: AGPL-3.0-only
import {
  generalSettingsSchema,
  limitsSchema,
  parseSettings,
  smtpSettingsSchema,
  type GeneralSettings,
  type InstanceSettingsDto,
  type Limits,
  type SmtpSettingsDto,
  type UpdateInstanceSettingsInput,
  type UpdateSmtpInput,
} from '@ardoise/shared';
import { z } from 'zod';
import type { SecretKeyring } from '../common/crypto.js';
import type { Config } from '../config/config.js';
import type { Store } from '../store/store.js';

export interface EffectiveSmtp {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
  from: string;
}

const storedSmtpSchema = smtpSettingsSchema.extend({ passwordEncrypted: z.string().nullable() });

/** Instance settings (`instance_settings` rows `limits`, `general`, `smtp`). */
export class InstanceSettingsService {
  constructor(
    private readonly store: Store,
    private readonly keyring: SecretKeyring,
    private readonly envSmtp: Config['smtp'],
    private readonly publicUrl: string,
  ) {}

  async limits(): Promise<Limits> {
    return parseSettings(limitsSchema, await this.store.settings.get('limits'));
  }

  async general(): Promise<GeneralSettings> {
    return parseSettings(generalSettingsSchema, await this.store.settings.get('general'));
  }

  async all(): Promise<InstanceSettingsDto> {
    return { limits: await this.limits(), general: await this.general() };
  }

  async update(input: UpdateInstanceSettingsInput): Promise<InstanceSettingsDto> {
    if (input.limits) {
      await this.store.settings.set(
        'limits',
        limitsSchema.parse({ ...(await this.limits()), ...input.limits }),
      );
    }
    if (input.general) {
      await this.store.settings.set(
        'general',
        generalSettingsSchema.parse({ ...(await this.general()), ...input.general }),
      );
    }
    return this.all();
  }

  private async storedSmtp() {
    const parsed = storedSmtpSchema.safeParse(await this.store.settings.get('smtp'));
    return parsed.success ? parsed.data : undefined;
  }

  private defaultFrom(): string {
    return `Ardoise <no-reply@${new URL(this.publicUrl).hostname}>`;
  }

  /** Admin settings override the `SMTP_*` environment (ARCHITECTURE §2). */
  async effectiveSmtp(): Promise<EffectiveSmtp | undefined> {
    const stored = await this.storedSmtp();
    if (stored) {
      const { passwordEncrypted, ...rest } = stored;
      return {
        ...rest,
        password: passwordEncrypted ? this.keyring.decrypt(passwordEncrypted) : undefined,
      };
    }
    const env = this.envSmtp;
    if (!env) return undefined;
    return {
      host: env.host,
      port: env.port,
      secure: env.secure,
      user: env.user,
      password: env.password,
      from: env.from ?? this.defaultFrom(),
    };
  }

  async smtpDto(): Promise<SmtpSettingsDto> {
    const stored = await this.storedSmtp();
    if (stored) {
      const { passwordEncrypted, ...settings } = stored;
      return { source: 'admin', settings, hasPassword: passwordEncrypted !== null };
    }
    const env = this.envSmtp;
    if (!env) return { source: 'none', settings: null, hasPassword: false };
    return {
      source: 'env',
      settings: {
        host: env.host,
        port: env.port,
        secure: env.secure,
        user: env.user,
        from: env.from ?? this.defaultFrom(),
      },
      hasPassword: env.password !== undefined,
    };
  }

  async updateSmtp(input: UpdateSmtpInput): Promise<SmtpSettingsDto> {
    const { password, ...settings } = input;
    const current = await this.storedSmtp();
    const passwordEncrypted =
      password === undefined
        ? (current?.passwordEncrypted ?? null)
        : password === null || password === ''
          ? null
          : this.keyring.encrypt(password);
    await this.store.settings.set(
      'smtp',
      storedSmtpSchema.parse({ ...settings, passwordEncrypted }),
    );
    return this.smtpDto();
  }

  /** Falls back to the environment settings, if any. */
  async clearSmtp(): Promise<SmtpSettingsDto> {
    await this.store.settings.delete('smtp');
    return this.smtpDto();
  }
}
