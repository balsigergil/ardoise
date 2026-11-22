// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkReadiness, publicReport, type Probe } from './readiness.js';

const ok = (name: string): Probe => ({ name, check: () => Promise.resolve() });
const failing = (name: string, message: string): Probe => ({
  name,
  check: () => Promise.reject(new Error(message)),
});
const hanging = (name: string, onAbort: () => void = () => {}): Probe => ({
  name,
  check: (signal) =>
    new Promise(() => {
      signal.addEventListener('abort', onAbort);
    }),
});

describe('checkReadiness', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is ok when every probe succeeds', async () => {
    const report = await checkReadiness([ok('database'), ok('valkey')], 1000);
    expect(report.status).toBe('ok');
    expect(Object.keys(report.checks)).toEqual(['database', 'valkey']);
    expect(report.checks.database?.status).toBe('ok');
  });

  it('is an error when one probe fails, and keeps the reason', async () => {
    const report = await checkReadiness([ok('database'), failing('s3', 'NoSuchBucket')], 1000);
    expect(report.status).toBe('error');
    expect(report.checks.s3).toMatchObject({ status: 'error', error: 'NoSuchBucket' });
    expect(report.checks.database?.status).toBe('ok');
  });

  it('times out hanging probes and aborts them', async () => {
    const onAbort = vi.fn();
    const promise = checkReadiness([hanging('valkey', onAbort)], 500);
    await vi.advanceTimersByTimeAsync(500);
    const report = await promise;
    expect(report.checks.valkey).toMatchObject({
      status: 'error',
      error: 'timed out after 500 ms',
    });
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it('measures latency with the given clock', async () => {
    let t = 0;
    const clock = { now: () => (t += 7) };
    const report = await checkReadiness([ok('database')], 1000, clock);
    expect(report.checks.database?.latencyMs).toBe(7);
  });

  it('is ok with no probes', async () => {
    expect((await checkReadiness([], 1000)).status).toBe('ok');
  });
});

describe('publicReport', () => {
  it('strips internal error details', () => {
    const report = publicReport({
      status: 'error',
      checks: {
        database: { status: 'error', latencyMs: 3, error: 'password authentication failed' },
      },
    });
    expect(report).toEqual({
      status: 'error',
      checks: { database: { status: 'error', latencyMs: 3 } },
    });
  });
});
