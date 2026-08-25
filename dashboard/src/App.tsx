import { useState } from 'react';
import { fetchHealth, fetchPostings } from './api/client';
import { fetchSettings } from './api/settings';
import { useApi } from './hooks/useApi';
import { Filters } from './components/Filters';
import { PostingsTable } from './components/PostingsTable';
import { SourceHealth } from './components/SourceHealth';
import { SettingsPage } from './components/SettingsPage';
import type { PostingFilters } from './api/types';

type Tab = 'postings' | 'settings';

export function App() {
  const [tab, setTab] = useState<Tab>('postings');
  const [filters, setFilters] = useState<PostingFilters>({});

  const postings = useApi(() => fetchPostings(filters), [filters]);
  const health = useApi(() => fetchHealth());
  // Owned here, not inside SettingsPage: the stale-posting badge below needs
  // the current version, so a save in Settings has to be visible on the
  // Postings tab without a page reload. One fetch also serves both tabs.
  const settings = useApi(() => fetchSettings());

  // Any `settings` error row, not just "settings incomplete": a settings READ
  // failure (unseeded or degraded database) also logs here, and it is the case
  // where the user has the least other evidence of what is wrong.
  const settingsError = (health.data ?? []).find(
    (h) => h.source === 'settings' && h.status === 'error',
  );

  return (
    <>
      <h1>JobRadar</h1>

      {settingsError && (
        <p className="banner" role="status">
          JobRadar is not scoring yet —{' '}
          {settingsError.error ?? 'the last run could not read its settings'}.{' '}
          <button type="button" onClick={() => setTab('settings')}>Finish setup</button>
        </p>
      )}

      {/* Two screens do not justify a routing dependency. */}
      <nav className="tabs" role="tablist">
        {(['postings', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            className={tab === t ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t === 'postings' ? 'Postings' : 'Settings'}
          </button>
        ))}
      </nav>

      {tab === 'settings' ? <SettingsPage settings={settings} /> : (
        <>
          <Filters value={filters} onChange={setFilters} rows={postings.data ?? []} />

          {postings.loading && <p className="state">Loading…</p>}
          {postings.error && <p className="state" role="alert">Error: {postings.error}</p>}
          {!postings.loading && !postings.error && (
            <PostingsTable rows={postings.data ?? []} currentVersion={settings.data?.version ?? null} />
          )}

          <SourceHealth rows={health.data ?? []} />
        </>
      )}
    </>
  );
}
