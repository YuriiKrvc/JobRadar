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
  const settings = useApi(() => fetchSettings());

  const incomplete = (health.data ?? []).some(
    (h) => h.source === 'settings' && (h.error ?? '').includes('settings incomplete'),
  );

  return (
    <>
      <h1>JobRadar</h1>

      {incomplete && (
        <p className="banner" role="status">
          JobRadar is not scoring yet — it needs a CV and at least one source.{' '}
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

      {tab === 'settings' ? <SettingsPage /> : (
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
