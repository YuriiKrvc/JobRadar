import { useState, type KeyboardEvent } from 'react';
import s from './settings.module.css';

interface Props {
  id: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  disabled?: boolean;
  help?: string;
}

export function ChipInput({ id, label, value, onChange, suggestions, disabled, help }: Props) {
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  function commit(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    // Enter in a chip field means "add a chip", never "submit the form".
    e.preventDefault();

    const next = draft.trim();
    if (next === '') return;

    // Clear the field only on a successful add. Clearing first made a rejected
    // duplicate look like a silent data loss: the text vanished, no chip
    // appeared, and nothing said why.
    if (value.includes(next)) {
      setHint(`"${next}" is already in the list.`);
      return;
    }

    setHint(null);
    setDraft('');
    onChange([...value, next]);
  }

  return (
    <div className={s.field}>
      <label htmlFor={id}>{label}</label>
      <ul className={s.chips}>
        {value.map((v) => (
          <li key={v} className={s.chip}>
            {v}
            <button type="button" aria-label={`Remove ${v}`} disabled={disabled}
              onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
          </li>
        ))}
      </ul>
      <input
        id={id}
        list={suggestions ? `${id}-suggestions` : undefined}
        value={draft}
        placeholder="Type and press Enter"
        disabled={disabled}
        onChange={(e) => { setDraft(e.target.value); setHint(null); }}
        onKeyDown={commit}
      />
      {hint && <p className={s.state} role="status">{hint}</p>}
      {suggestions && (
        <datalist id={`${id}-suggestions`}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
}
