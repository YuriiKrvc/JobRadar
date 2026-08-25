import { useState, type KeyboardEvent } from 'react';

interface Props {
  id: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  disabled?: boolean;
}

export function ChipInput({ id, label, value, onChange, suggestions, disabled }: Props) {
  const [draft, setDraft] = useState('');

  function commit(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    // Enter in a chip field means "add a chip", never "submit the form".
    e.preventDefault();

    const next = draft.trim();
    setDraft('');
    if (next === '' || value.includes(next)) return;
    onChange([...value, next]);
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <ul className="chips">
        {value.map((v) => (
          <li key={v} className="chip">
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
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={commit}
      />
      {suggestions && (
        <datalist id={`${id}-suggestions`}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
}
