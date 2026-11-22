// SPDX-License-Identifier: AGPL-3.0-only
/** Pinned images; keep in sync with docker/docker-compose.yml. */
export const images = {
  postgres: 'postgres:17.12-alpine',
  valkey: 'valkey/valkey:9.2.0-alpine',
  rustfs: 'rustfs/rustfs:1.0.6',
} as const;
