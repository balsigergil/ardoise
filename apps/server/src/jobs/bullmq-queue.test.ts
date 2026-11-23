// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { debounceWindow } from './bullmq-queue.js';

describe('debounceWindow', () => {
  it('merges enqueues of one window and runs at its end', () => {
    const a = debounceWindow('p', 5000, 10_000);
    const b = debounceWindow('p', 5000, 14_999);
    expect(a.jobId).toBe(b.jobId);
    expect(10_000 + a.delay).toBe(15_050);
    expect(14_999 + b.delay).toBe(15_050);
    expect(debounceWindow('p', 5000, 15_000).jobId).not.toBe(a.jobId);
    expect(debounceWindow('projection:w:page:x', 5000, 0).jobId).toBe('projection_w_page_x_0');
  });
});
