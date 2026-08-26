import { useEffect, useState } from 'react';
import { saveProfile } from '../api/settings';
import { useSave } from '../hooks/useSave';
import { ChipInput } from './ChipInput';
import type { ProfileInput } from '../api/types';
import s from './settings.module.css';

// ProfileSchema types these as free strings, not an enum, so these are hints
// rather than a fixed set.
const EMPLOYMENT_SUGGESTIONS = ['full-time', 'part-time', 'contract', 'internship'];

interface Props {
  initial: ProfileInput;
  onSaved: () => void;
}

export function ProfileForm({ initial, onSaved }: Props) {
  const [draft, setDraft] = useState<ProfileInput>(initial);

  // Compare by VALUE, not identity: `initial` is a fresh object on every
  // /api/settings fetch, so keying the re-seed on identity would reset this
  // form whenever a sibling section saved and triggered a reload — throwing
  // away an unsaved profile edit with no message.
  const initialKey = JSON.stringify(initial);
  useEffect(() => { setDraft(initial); },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the
    // serialised value on purpose; see above.
    [initialKey]);

  const save = useSave<ProfileInput>(saveProfile);
  const dirty = JSON.stringify(draft) !== initialKey;

  function set<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <section className={s.section}>
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

      <ChipInput
        id="blocked-title-words" label="Blocked words — titles"
        help="Reject a posting outright if its title contains one of these words. Checked before the job page is downloaded, so it also saves a request. Whole words only, case-insensitive — php will not match phpstorm."
        value={draft.blockedTitleWords}
        onChange={(v) => set('blockedTitleWords', v)}
        disabled={save.saving}
      />

      <ChipInput
        id="blocked-description-words" label="Blocked words — descriptions"
        help="Reject a posting if its full description contains one of these words. Checked after the job page is downloaded. Use it for deal-breakers in the body text, like “relocation required”. Whole words and phrases, case-insensitive."
        value={draft.blockedDescriptionWords}
        onChange={(v) => set('blockedDescriptionWords', v)}
        disabled={save.saving}
      />

      <p className="field-help">
        Removing a word does not bring back postings it already rejected — those
        keep their score row and stay filtered. Rejected postings stay listed on
        the Postings tab with the word that rejected them, so you can see when a
        list is too aggressive.
      </p>

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

      <div className={s.field}>
        <label htmlFor="timezone">Timezone</label>
        <input id="timezone" value={draft.timezone}
          disabled={save.saving}
          onChange={(e) => set('timezone', e.target.value)} />
      </div>

      <div className={s.actions}>
        <button type="button" disabled={!dirty || save.saving}
          onClick={async () => { if (await save.run(draft)) onSaved(); }}>
          {save.saving ? 'Saving…' : 'Save profile'}
        </button>
        {save.error && <span className={s.state} role="alert">{save.error}</span>}
        {save.saved && !dirty && <span className={s.state}>Saved</span>}
      </div>
    </section>
  );
}
