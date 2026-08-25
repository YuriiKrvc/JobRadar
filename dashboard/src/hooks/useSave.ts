import { useCallback, useRef, useState } from 'react';

export interface SaveState<T> {
  run: (value: T) => Promise<void>;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

/**
 * No optimistic updates: PUT, then let the caller refetch. On failure the form
 * keeps the user's input and stays dirty, so nothing is silently lost.
 */
export function useSave<T>(save: (value: T) => Promise<unknown>): SaveState<T> {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveRef = useRef(save);
  saveRef.current = save;

  const run = useCallback(async (value: T) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveRef.current(value);
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  return { run, saving, error, saved };
}
