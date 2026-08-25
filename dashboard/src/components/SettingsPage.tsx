import { useApi } from '../hooks/useApi';
import { fetchSettings, saveCv } from '../api/settings';
import { DocumentEditor } from './DocumentEditor';

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
