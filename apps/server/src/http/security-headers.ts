// SPDX-License-Identifier: AGPL-3.0-only
import helmet from 'helmet';
import type { Config } from '../config/config.js';

/** Strict CSP and security headers (ARCHITECTURE §13). */
export function securityHeaders(config: Config) {
  const https = config.publicUrl.startsWith('https:');
  const s3 = config.s3.publicUrl ? [new URL(config.s3.publicUrl).origin] : [];
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Radix positions popovers with inline styles.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', ...s3],
        mediaSrc: ["'self'", 'blob:', ...s3],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(https && { upgradeInsecureRequests: [] }),
      },
    },
    strictTransportSecurity: https ? { maxAge: 15_552_000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });
}
