// SPDX-License-Identifier: AGPL-3.0-only
/** Explicit DI tokens: providers are never resolved from reflected types (M0 plan). */
export const CONFIG = Symbol('CONFIG');
export const DATABASE = Symbol('DATABASE');
export const VALKEY = Symbol('VALKEY');
export const S3 = Symbol('S3');
export const READINESS_PROBES = Symbol('READINESS_PROBES');
export const STORE = Symbol('STORE');
export const SYNC_BUS = Symbol('SYNC_BUS');
export const JOB_QUEUE = Symbol('JOB_QUEUE');
