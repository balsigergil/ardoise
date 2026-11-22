// SPDX-License-Identifier: AGPL-3.0-only
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** A 256-bit random token, base64url (43 characters). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored as SHA-256 hex digests (ARCHITECTURE §13). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'ardoise', purpose, 32));
}

/** Keyed helpers derived from `ARDOISE_SECRET_KEY`, one subkey per purpose. */
export class SecretKeyring {
  private readonly encryptionKey: Buffer;
  private readonly csrfKey: Buffer;

  constructor(secretKey: string) {
    this.encryptionKey = deriveKey(secretKey, 'secrets:v1');
    this.csrfKey = deriveKey(secretKey, 'csrf:v1');
  }

  /** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  /** Throws when the value was not produced with this key or was tampered with. */
  decrypt(value: string): string {
    const [version, iv, tag, data] = value.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined)
      throw new Error('unsupported secret format');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** CSRF token bound to a session id: no storage needed. */
  csrfToken(sessionId: string): string {
    return createHmac('sha256', this.csrfKey).update(sessionId).digest('base64url');
  }

  verifyCsrfToken(sessionId: string, token: string | undefined): boolean {
    return typeof token === 'string' && safeEqual(this.csrfToken(sessionId), token);
  }
}
