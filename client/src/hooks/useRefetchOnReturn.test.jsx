import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRefetchOnReturn } from './useRefetchOnReturn';

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

const becomeVisible = () => {
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useRefetchOnReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('does not call refetch on mount', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnReturn(refetch));
    expect(refetch).not.toHaveBeenCalled();
  });

  it('refetches when the document becomes visible again', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnReturn(refetch));
    act(() => { vi.advanceTimersByTime(10000); });
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refetch).not.toHaveBeenCalled();
    act(() => { becomeVisible(); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('refetches when the window gains focus', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnReturn(refetch));
    act(() => { vi.advanceTimersByTime(10000); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('refetches on the interval while visible and stays quiet while hidden', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnReturn(refetch, { intervalMs: 30000 }));
    act(() => { vi.advanceTimersByTime(29999); });
    expect(refetch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(refetch).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    act(() => { vi.advanceTimersByTime(90000); });
    expect(refetch).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    act(() => { vi.advanceTimersByTime(30000); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('never calls more often than minGapMs', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnReturn(refetch, { minGapMs: 8000 }));
    act(() => { vi.advanceTimersByTime(10000); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { becomeVisible(); });
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('does not start a second call while the previous one is in flight', async () => {
    let release;
    const refetch = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    renderHook(() => useRefetchOnReturn(refetch, { minGapMs: 1000 }));
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a refetch that rejects', async () => {
    const refetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    renderHook(() => useRefetchOnReturn(refetch, { minGapMs: 1000 }));
    act(() => { vi.advanceTimersByTime(2000); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('removes its listeners and timers on unmount', () => {
    const refetch = vi.fn();
    const { unmount } = renderHook(() => useRefetchOnReturn(refetch));
    unmount();
    act(() => { vi.advanceTimersByTime(120000); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { becomeVisible(); });
    expect(refetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('calls the latest refetch without resubscribing', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ refetch }) => useRefetchOnReturn(refetch), { initialProps: { refetch: first } });
    const subscriptions = addSpy.mock.calls.filter(([type]) => type === 'focus').length;
    rerender({ refetch: second });
    expect(addSpy.mock.calls.filter(([type]) => type === 'focus').length).toBe(subscriptions);
    act(() => { vi.advanceTimersByTime(10000); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    addSpy.mockRestore();
  });
});
