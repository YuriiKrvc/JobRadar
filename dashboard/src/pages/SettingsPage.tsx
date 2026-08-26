import { saveCv } from '../api/settings';
import { useDashboardData } from '../context/DashboardData';
import { DocumentEditor } from '../components/DocumentEditor';
import { ProfileForm } from '../components/ProfileForm';
import { RubricEditor } from '../components/RubricEditor';
import { SourcesTable } from '../components/SourcesTable';
import css from '../components/settings.module.css';

export function SettingsPage() {
  /**
   * Owned by App so the Postings tab's stale badge sees a save immediately,
   * and so a route change does not refetch. Taking the whole ApiState keeps
   * `reload` bound to the same state the sections were seeded from.
   */
  const { settings } = useDashboardData();

  if (settings.error) return <p className={css.state} role="alert">Error: {settings.error}</p>;

  // Gate on `data`, not on `loading`. Every section's onSaved calls reload(),
  // which sets loading = true; gating on it would unmount all four sections
  // mid-edit and remount them from the server, silently discarding whatever
  // the user had typed into the three they did not save.
  if (!settings.data) return <p className={css.state}>Loading…</p>;

  const s = settings.data;

  return (
    <div className={css.page}>
      <p className={css.version}>
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

      <RubricEditor
        initialBody={s.rubricBody}
        initialWeights={s.rubricWeights}
        onSaved={settings.reload}
      />
    </div>
  );
}
