import { useEffect, useState, type KeyboardEvent } from 'react';
import { saveProfile } from '../api/settings';
import { useSave } from '../hooks/useSave';
import { ChipInput } from './ChipInput';
import { SettingsSection } from './SettingsSection';
import type { ProfileInput } from '../api/types';
import css from './settings.module.css';

const KNOWN_EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'internship'];

interface Props {
  initial: ProfileInput;
  version: number;
  onSaved: () => void;
}

export function ProfileForm({ initial, version, onSaved }: Props) {
  const [draft, setDraft] = useState<ProfileInput>(initial);
  const [typeDraft, setTypeDraft] = useState('');
  const [typeHint, setTypeHint] = useState<string | null>(null);

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

  const custom = draft.allowedEmploymentTypes.filter((t) => !KNOWN_EMPLOYMENT_TYPES.includes(t));

  function toggleEmployment(type: string) {
    set('allowedEmploymentTypes', draft.allowedEmploymentTypes.includes(type)
      ? draft.allowedEmploymentTypes.filter((t) => t !== type)
      : [...draft.allowedEmploymentTypes, type]);
  }

  function commitEmployment(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = typeDraft.trim();
    if (next === '') return;
    // Clear only on a successful add: clearing first made a rejected duplicate
    // look like silent data loss. Same rule as ChipInput.
    if (draft.allowedEmploymentTypes.includes(next)) {
      setTypeHint(`"${next}" is already in the list.`);
      return;
    }
    setTypeHint(null);
    setTypeDraft('');
    set('allowedEmploymentTypes', [...draft.allowedEmploymentTypes, next]);
  }

  return (
    <SettingsSection
      id="profile" title="Profile & hard filters"
      blurb="Postings failing these never reach the model."
      version={version}
      state={{ dirty, saving: save.saving, saved: save.saved, error: save.error }}
      onSave={async () => { if (await save.run(draft)) onSaved(); }}
    >
      <div className={css.profileGrid}>
        <div className={css.profileCol}>
          <ChipInput
            id="excluded-locations" label="Excluded locations"
            help="A posting matching any of these is dropped before scoring."
            value={draft.excludedLocations}
            onChange={(v) => set('excludedLocations', v)}
            disabled={save.saving}
            placeholder="Add a location, then Enter"
          />

          <div className={css.field}>
            {/* htmlFor cannot bind to a div, so the group is named with
                aria-labelledby instead of an orphaned label. */}
            <span id="employment-types-label" className={css.groupLabel}>
              Allowed employment types
            </span>
            <div className={css.toggles} role="group" aria-labelledby="employment-types-label">
              {KNOWN_EMPLOYMENT_TYPES.map((t) => (
                <button
                  key={t} type="button" className={css.toggle}
                  aria-pressed={draft.allowedEmploymentTypes.includes(t)}
                  disabled={save.saving}
                  onClick={() => toggleEmployment(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {/* A value outside the four known ones is legal — ProfileSchema
                types these as free strings — so it is shown and removable
                rather than silently dropped on the next save. */}
            {custom.length > 0 && (
              <ul className={css.chips}>
                {custom.map((t) => (
                  <li key={t} className={css.chip}>
                    {t}
                    <button type="button" className={css.buttonBare} aria-label={`Remove ${t}`}
                      disabled={save.saving} onClick={() => toggleEmployment(t)}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <label htmlFor="employment-type-add" className={css.visuallyHidden}>
              Add an employment type
            </label>
            <input
              id="employment-type-add" className={`${css.input} ${css.chipInput}`}
              value={typeDraft} placeholder="Add a type, then Enter" disabled={save.saving}
              onChange={(e) => { setTypeDraft(e.target.value); setTypeHint(null); }}
              onKeyDown={commitEmployment}
            />
            {typeHint && <p className={css.inlineNote} role="status">{typeHint}</p>}
          </div>
        </div>

        <div className={css.profileAside}>
          <div className={css.field}>
            <label htmlFor="min-salary">Minimum salary, USD — blank means no floor</label>
            <input
              id="min-salary" className={css.input} type="number" min={1}
              placeholder="No minimum"
              value={draft.minSalaryUsd ?? ''}
              disabled={save.saving}
              // An empty field means "no minimum", which is null — not 0,
              // which ProfileSchema would reject as non-positive.
              onChange={(e) => set('minSalaryUsd', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>

          <div className={css.field}>
            <label htmlFor="timezone">Timezone</label>
            {/* A free string, not a select: ProfileSchema does not enumerate
                these, and a three-option select would lose anything else. */}
            <input id="timezone" className={css.input} value={draft.timezone}
              disabled={save.saving}
              onChange={(e) => set('timezone', e.target.value)} />
          </div>
        </div>

        <div className={css.profileBlocklists}>
          <div className={css.profileCol}>
            {/* The ChipInput's own <label> is the visible heading — styled in
                the heading serif below. A separate heading would duplicate
                the string. */}
            <ChipInput
              id="blocked-title-words" label="Blocked words — titles"
              help="Reject a posting outright if its title contains one of these words. Checked before the job page is downloaded, so it also saves a request. Whole words only, case-insensitive — php will not match phpstorm."
              value={draft.blockedTitleWords}
              onChange={(v) => set('blockedTitleWords', v)}
              disabled={save.saving}
              placeholder="Add a word, then Enter"
            />
          </div>
          <div className={css.profileCol}>
            <ChipInput
              id="blocked-description-words" label="Blocked words — descriptions"
              help="Checked after the job page is downloaded. Use it for deal-breakers in the body text, like “relocation required”. Whole words and phrases, case-insensitive."
              value={draft.blockedDescriptionWords}
              onChange={(v) => set('blockedDescriptionWords', v)}
              disabled={save.saving}
              placeholder="Add a word or phrase, then Enter"
            />
          </div>
        </div>

        <div className={css.oneWayDoor}>
          <div className={css.oneWayDoorLabel}>ONE-WAY DOOR</div>
          <p>
            Removing a blocked word does not bring back the postings it already
            rejected. Those were rejected at fetch time and will not be seen
            again unless the board re-lists them. Add words narrowly.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}
