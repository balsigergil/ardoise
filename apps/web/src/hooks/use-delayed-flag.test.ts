// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedFlag } from './use-delayed-flag';

describe('useDelayedFlag', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns true only after the delay', () => {
    const { result } = renderHook(() => useDelayedFlag(true, 3000));
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it('never turns true when the state ends before the delay', () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedFlag(on, 3000), {
      initialProps: { on: true },
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender({ on: false });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });

  it('resets as soon as the state ends, and restarts the delay', () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedFlag(on, 3000), {
      initialProps: { on: true },
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
    rerender({ on: true });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(false);
  });
});
