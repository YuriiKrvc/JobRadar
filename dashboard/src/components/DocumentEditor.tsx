import { useEffect, useState } from 'react';
import { useSave } from '../hooks/useSave';

interface Props {
  id: string;
  label: string;
  initial: string;
  rows?: number;
  onSave: (value: string) => Promise<unknown>;
  onSaved: () => void;
}

export function DocumentEditor({ id, label, initial, rows = 14, onSave, onSaved }: Props) {
  const [value, setValue] = useState(initial);
  // Re-seed when a refetch brings a newer server value.
  useEffect(() => { setValue(initial); }, [initial]);

  const save = useSave<string>(onSave);
  const dirty = value !== initial;

  return (
    <section className="settings-section">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="settings-actions">
        <button
          type="button"
          disabled={!dirty || save.saving}
          onClick={async () => { await save.run(value); onSaved(); }}
        >
          {save.saving ? 'Saving…' : `Save ${label}`}
        </button>
        {save.error && <span className="state" role="alert">{save.error}</span>}
        {save.saved && !dirty && <span className="state">Saved</span>}
      </div>
    </section>
  );
}
