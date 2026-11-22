// SPDX-License-Identifier: AGPL-3.0-only
/** A dependency probe: resolves when the dependency is reachable. */
export interface Probe {
  name: string;
  check(signal: AbortSignal): Promise<void>;
}

export interface ProbeResult {
  status: 'ok' | 'error';
  latencyMs: number;
  /** Internal detail for logs only; never sent to clients. */
  error?: string;
}

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: Record<string, ProbeResult>;
}

export interface Clock {
  now(): number;
}

const systemClock: Clock = { now: () => performance.now() };

/** Runs every probe in parallel, each bounded by `timeoutMs`. */
export async function checkReadiness(
  probes: readonly Probe[],
  timeoutMs: number,
  clock: Clock = systemClock,
): Promise<ReadinessReport> {
  const entries = await Promise.all(
    probes.map(async (probe): Promise<[string, ProbeResult]> => {
      const start = clock.now();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      });
      try {
        await Promise.race([probe.check(controller.signal), timeout]);
        return [probe.name, { status: 'ok', latencyMs: Math.round(clock.now() - start) }];
      } catch (error) {
        return [
          probe.name,
          {
            status: 'error',
            latencyMs: Math.round(clock.now() - start),
            error: error instanceof Error ? error.message : String(error),
          },
        ];
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const checks = Object.fromEntries(entries);
  const status = entries.every(([, r]) => r.status === 'ok') ? 'ok' : 'error';
  return { status, checks };
}

/** Removes internal error details before the report leaves the server. */
export function publicReport(report: ReadinessReport): ReadinessReport {
  return {
    status: report.status,
    checks: Object.fromEntries(
      Object.entries(report.checks).map(([name, { status, latencyMs }]) => [
        name,
        { status, latencyMs },
      ]),
    ),
  };
}
