import { useEffect, useState } from 'react';
import { useSave } from '../hooks/useSave';
import { SettingsSection } from './SettingsSection';

interface Props {
  id: string;
  label: string;
  blurb: string;
  version: number;
  initial: string;
  onSave: (value: string) => Promise<unknown>;
  onSaved: () => void;
}

export function DocumentEditor({ id, label, blurb, version, initial, onSave, onSaved }: Props) {
  const [value, setValue] = useState(initial);
  // Re-seed when a refetch brings a newer server value.
  useEffect(() => { setValue(initial); }, [initial]);

  const save = useSave<string>(onSave);
  const dirty = value !== initial;

  const words = value.trim() === '' ? 0 : value.trim().split(/\s+/).length;

  return (
    <SettingsSection
      id={id} title={label} blurb={blurb} version={version}
      state={{ dirty, saving: save.saving, saved: save.saved, error: save.error }}
      onSave={async () => {
        // Only a successful save may trigger a refetch. Reloading on failure
        // would clobber the just-rejected edit the user still needs to fix.
        if (await save.run(value)) onSaved();
      }}
    >
      <div className="settings-section-body">
        <div className="doc-editor-meta">
          <label htmlFor={id}>
            CV — markdown. The single most important input: every score is a
            comparison against this text.
          </label>
          <span className="doc-editor-count">{value.length} characters · {words} words</span>
        </div>
        <textarea
          id={id}
          className="input doc-editor-area"
          value={value}
          spellCheck={false}
          disabled={save.saving}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
    </SettingsSection>
  );
}
