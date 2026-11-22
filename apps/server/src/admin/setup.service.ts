// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError, newId, type SetupInput } from '@ardoise/shared';
import { z } from 'zod';
import type { Clock } from '../common/clock.js';
import { randomToken, safeEqual, type SecretKeyring } from '../common/crypto.js';
import type { AuthService, IssuedSession, RequestMeta } from '../auth/auth.service.js';
import type { PasswordHasher } from '../auth/password-hasher.js';
import type { Store } from '../store/store.js';

const SETUP_KEY = 'setup';
const storedSetupSchema = z.object({ tokenEncrypted: z.string() });

export type SetupState =
  { kind: 'complete' } | { kind: 'bootstrapped'; email: string } | { kind: 'pending'; url: string };

/** First-run setup (PRODUCT §3): logged one-time URL, or env bootstrap. */
export class SetupService {
  constructor(
    private readonly store: Store,
    private readonly keyring: SecretKeyring,
    private readonly hasher: PasswordHasher,
    private readonly auth: AuthService,
    private readonly clock: Clock,
    private readonly publicUrl: string,
  ) {}

  async isRequired(): Promise<boolean> {
    return !(await this.store.users.anySuperAdmin());
  }

  /**
   * Runs at boot on every api node. Creates the env super-admin, or makes sure a setup
   * token exists (stored encrypted, so every node prints the same URL).
   */
  async prepare(bootstrapAdmin?: { email: string; password: string }): Promise<SetupState> {
    const passwordHash = bootstrapAdmin
      ? await this.hasher.hash(bootstrapAdmin.password)
      : undefined;
    return this.store.withLock('setup', async (store) => {
      if (await store.users.anySuperAdmin()) {
        await store.settings.delete(SETUP_KEY);
        return { kind: 'complete' };
      }
      if (bootstrapAdmin && passwordHash) {
        const email = bootstrapAdmin.email.trim().toLowerCase();
        const existing = await store.users.findByEmail(email);
        if (existing)
          await store.users.update(existing.id, { isSuperAdmin: true, disabledAt: null });
        else
          await store.users.insert({
            id: newId(),
            email,
            name: email.split('@')[0] ?? email,
            passwordHash,
            locale: null,
            theme: 'system',
            isSuperAdmin: true,
            disabledAt: null,
            createdAt: this.clock.now(),
          });
        await store.settings.delete(SETUP_KEY);
        return { kind: 'bootstrapped', email };
      }
      const stored = storedSetupSchema.parse(
        await store.settings.setIfAbsent(SETUP_KEY, {
          tokenEncrypted: this.keyring.encrypt(randomToken()),
        }),
      );
      return {
        kind: 'pending',
        url: `${this.publicUrl}/setup#token=${this.keyring.decrypt(stored.tokenEncrypted)}`,
      };
    });
  }

  /** Creates the super-admin and the first workspace, then signs in. */
  async complete(
    input: SetupInput & { email: string },
    meta: RequestMeta,
  ): Promise<IssuedSession & { workspaceId: string }> {
    const passwordHash = await this.hasher.hash(input.password);
    return this.store.withLock('setup', async (store) => {
      if (await store.users.anySuperAdmin()) throw new DomainError('setup_unavailable');
      const parsed = storedSetupSchema.safeParse(await store.settings.get(SETUP_KEY));
      if (!parsed.success) throw new DomainError('setup_unavailable');
      if (!safeEqual(this.keyring.decrypt(parsed.data.tokenEncrypted), input.token))
        throw new DomainError('setup_token_invalid');
      const now = this.clock.now();
      const user = {
        id: newId(),
        email: input.email,
        name: input.name.trim(),
        passwordHash,
        locale: input.locale ?? null,
        theme: 'system' as const,
        isSuperAdmin: true,
        disabledAt: null,
        createdAt: now,
      };
      await store.users.insert(user);
      const workspaceId = newId();
      await store.workspaces.create(
        { id: workspaceId, name: input.workspaceName.trim(), icon: null, createdAt: now },
        user.id,
      );
      await store.settings.delete(SETUP_KEY);
      const issued = await this.auth.createSession(user, meta, store);
      return { ...issued, workspaceId };
    });
  }
}
