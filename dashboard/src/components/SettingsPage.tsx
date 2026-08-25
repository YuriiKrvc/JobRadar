import { useApi } from '../hooks/useApi';
import { fetchSettings, saveCv } from '../api/settings';
import { DocumentEditor } from './DocumentEditor';
import { ProfileForm } from './ProfileForm';
import { SourcesTable } from './SourcesTable';

export function SettingsPage() {
  const settings = useApi(() => fetchSettings());

  if (settings.loading) return <p className="state">Loading…</p>;
  if (settings.error) return <p className="state" role="alert">Error: {settings.error}</p>;
  if (!settings.data) return null;

  const s = settings.data;

  return (
    <div className="settings">
      <p className="settings-version">
        Scoring settings version {s.version} — changes apply on the next run.
      </p>

      <ProfileForm initial={s.profile} onSaved={settings.reload} />

      <SourcesTable />

      <DocumentEditor
        id="cv"
        label="CV"
        initial={s.cv}
        onSave={(v) => saveCv(v)}
        onSaved={settings.reload}
      />
    </div>
  );
}
