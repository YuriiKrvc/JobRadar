import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSave } from '../src/hooks/useSave';

describe('useSave', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useSave(async () => {}));
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.saved).toBe(false);
  });

  it('reports saved after a successful run', async () => {
    const save = vi.fn(async () => {});
    const { result } = renderHook(() => useSave(save));

    await act(async () => { await result.current.run('value'); });

    expect(save).toHaveBeenCalledWith('value');
    await waitFor(() => expect(result.current.saved).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it('captures the error message and stays unsaved', async () => {
    const { result } = renderHook(() => useSave(async () => {
      throw new Error('minSalaryUsd: must be positive');
    }));

    await act(async () => { await result.current.run('value'); });

    expect(result.current.error).toBe('minSalaryUsd: must be positive');
    expect(result.current.saved).toBe(false);
    expect(result.current.saving).toBe(false);
  });

  it('clears a previous error on the next successful run', async () => {
    let fail = true;
    const { result } = renderHook(() => useSave(async () => {
      if (fail) throw new Error('nope');
    }));

    await act(async () => { await result.current.run('a'); });
    expect(result.current.error).toBe('nope');

    fail = false;
    await act(async () => { await result.current.run('b'); });
    expect(result.current.error).toBeNull();
  });

  it('reset clears error and saved without running a save', async () => {
    const save = vi.fn(async () => { throw new Error('nope'); });
    const { result } = renderHook(() => useSave(save));

    await act(async () => { await result.current.run('a'); });
    expect(result.current.error).toBe('nope');

    act(() => { result.current.reset(); });

    expect(result.current.error).toBeNull();
    expect(result.current.saved).toBe(false);
    expect(result.current.saving).toBe(false);
    // reset does not itself call the save function again.
    expect(save).toHaveBeenCalledTimes(1);
  });
});
