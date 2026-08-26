import type { ApiState } from '../hooks/useApi';
import { saveCv } from '../api/settings';
import type { SettingsResponse } from '../api/types';
import { DocumentEditor } from './DocumentEditor';
import { ProfileForm } from './ProfileForm';
import { RubricEditor } from './RubricEditor';
import { SourcesTable } from './SourcesTable';

interface Props {
  /**
   * Owned by App so the Postings tab's stale badge sees a save immediately,
   * and so a tab switch does not refetch. Passing the whole ApiState keeps
   * `reload` bound to the same state the sections were seeded from.
   */
  settings: ApiState<SettingsResponse>;
}

export function SettingsPage({ settings }: Props) {
  if (settings.error) return <p className="state" role="alert">Error: {settings.error}</p>;

  // Gate on `data`, not on `loading`. Every section's onSaved calls reload(),
  // which sets loading = true; gating on it would unmount all four sections
  // mid-edit and remount them from the server, silently discarding whatever
  // the user had typed into the three they did not save.
  if (!settings.data) return <p className="state">Loading…</p>;

  const s = settings.data;

  return (
    <div className="settings">
      <p className="settings-version">
        Scoring settings version {s.version} — changes apply on the next run.
        Saving does not rescore what is already here; those rows are marked
        stale instead.
      </p>

      <ProfileForm initial={s.profile} version={s.version} onSaved={settings.reload} />

      <SourcesTable />

      <DocumentEditor
        id="cv"
        label="CV"
        blurb="The text every posting is scored against."
        version={s.version}
        initial={s.cv}
        onSave={(v) => saveCv(v)}
        onSaved={settings.reload}
      />

      <RubricEditor
        initialBody={s.rubricBody}
        initialWeights={s.rubricWeights}
        version={s.version}
        onSaved={settings.reload}
      />
    </div>
  );
}
