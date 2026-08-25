import { useCallback, useRef, useState } from 'react';

export interface SaveState<T> {
  run: (value: T) => Promise<boolean>;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

/**
 * No optimistic updates: PUT, then let the caller refetch. On failure the form
 * keeps the user's input and stays dirty, so nothing is silently lost.
 *
 * `run` never throws — callers don't need try/catch — but it resolves to
 * `true`/`false` so callers can tell success from failure (e.g. to decide
 * whether a refetch is safe to trigger).
 */
export function useSave<T>(save: (value: T) => Promise<unknown>): SaveState<T> {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveRef = useRef(save);
  saveRef.current = save;

  const run = useCallback(async (value: T): Promise<boolean> => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveRef.current(value);
      setSaved(true);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { run, saving, error, saved };
}
