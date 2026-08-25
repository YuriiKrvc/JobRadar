import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApi } from '../src/hooks/useApi';

describe('useApi', () => {
  it('starts loading, then exposes data', async () => {
    const { result } = renderHook(() => useApi(async () => 42));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(42);
    expect(result.current.error).toBeNull();
  });

  it('exposes the error message on failure and leaves data null', async () => {
    const { result } = renderHook(() => useApi(async () => { throw new Error('boom'); }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.data).toBeNull();
  });

  it('reload re-invokes the loader', async () => {
    let n = 0;
    const { result } = renderHook(() => useApi(async () => ++n));
    await waitFor(() => expect(result.current.data).toBe(1));
    await act(async () => { result.current.reload(); });
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it('clears a previous error on a successful reload', async () => {
    let shouldFail = true;
    const { result } = renderHook(() => useApi(async () => {
      if (shouldFail) throw new Error('first failed');
      return 'ok';
    }));
    await waitFor(() => expect(result.current.error).toBe('first failed'));
    shouldFail = false;
    await act(async () => { result.current.reload(); });
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(result.current.error).toBeNull();
  });
});
