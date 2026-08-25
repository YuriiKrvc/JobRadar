import { useState } from 'react';
import { fetchHealth, fetchPostings } from './api/client';
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

  return (
    <>
      <h1>JobRadar</h1>

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
          {!postings.loading && !postings.error && <PostingsTable rows={postings.data ?? []} />}

          <SourceHealth rows={health.data ?? []} />
        </>
      )}
    </>
  );
}
