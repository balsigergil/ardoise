// SPDX-License-Identifier: AGPL-3.0-only
import { hash, verify } from '@node-rs/argon2';

// `Algorithm.Argon2id` is an ambient const enum, not importable with verbatimModuleSyntax.
const ARGON2ID = 2;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

/** argon2id with the OWASP baseline: 19 MiB, 2 iterations, 1 lane. */
export const argon2Hasher: PasswordHasher = {
  hash: (password) =>
    hash(password, { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
  verify: async (passwordHash, password) => {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  },
};
