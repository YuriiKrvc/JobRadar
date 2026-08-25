import { useEffect, useState } from 'react';
import { saveProfile } from '../api/settings';
import { useSave } from '../hooks/useSave';
import { ChipInput } from './ChipInput';
import type { ProfileInput } from '../api/types';

// ProfileSchema types these as free strings, not an enum, so these are hints
// rather than a fixed set.
const EMPLOYMENT_SUGGESTIONS = ['full-time', 'part-time', 'contract', 'internship'];

interface Props {
  initial: ProfileInput;
  onSaved: () => void;
}

export function ProfileForm({ initial, onSaved }: Props) {
  const [draft, setDraft] = useState<ProfileInput>(initial);
  useEffect(() => { setDraft(initial); }, [initial]);

  const save = useSave<ProfileInput>(saveProfile);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function set<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <section className="settings-section">
      <h2>Profile</h2>

      <ChipInput
        id="excluded-locations" label="Excluded locations"
        value={draft.excludedLocations}
        onChange={(v) => set('excludedLocations', v)}
        disabled={save.saving}
      />

      <ChipInput
        id="employment-types" label="Allowed employment types"
        value={draft.allowedEmploymentTypes}
        onChange={(v) => set('allowedEmploymentTypes', v)}
        suggestions={EMPLOYMENT_SUGGESTIONS}
        disabled={save.saving}
      />

      <div className="field">
        <label htmlFor="min-salary">Minimum salary (USD)</label>
        <input
          id="min-salary" type="number" min={1}
          value={draft.minSalaryUsd ?? ''}
          disabled={save.saving}
          // An empty field means "no minimum", which is null — not 0, which
          // ProfileSchema would reject as non-positive.
          onChange={(e) => set('minSalaryUsd', e.target.value === '' ? null : Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label htmlFor="timezone">Timezone</label>
        <input id="timezone" value={draft.timezone}
          disabled={save.saving}
          onChange={(e) => set('timezone', e.target.value)} />
      </div>

      <div className="settings-actions">
        <button type="button" disabled={!dirty || save.saving}
          onClick={async () => { if (await save.run(draft)) onSaved(); }}>
          {save.saving ? 'Saving…' : 'Save profile'}
        </button>
        {save.error && <span className="state" role="alert">{save.error}</span>}
        {save.saved && !dirty && <span className="state">Saved</span>}
      </div>
    </section>
  );
}
