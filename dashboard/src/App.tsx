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

  const runs = health.data ?? [];
  // The meta strip is built from what App already has: no new request.
  const lastRun = runs.length === 0 ? 'never'
    : new Date(runs.map((h) => h.ranAt).sort().at(-1)!).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      });
  const scored = (postings.data ?? []).length;

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-row">
          <div className="masthead-brand">JobRadar</div>
          <div className="masthead-tagline">Stop scrolling job boards. Read the shortlist.</div>

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
        </div>

        <div className="masthead-rule" />

        <div className="masthead-meta">
          <span>{new Date().toLocaleDateString(undefined, {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          })}</span>
          <span>Last run {lastRun} · {scored} posting{scored === 1 ? '' : 's'} scored</span>
          <span>Scoring settings v{settings.data?.version ?? '—'}</span>
        </div>
      </header>

      {settingsError && (
        <div className="banner" role="status">
          <div className="banner-label">NOT SCORING</div>
          <p>
            JobRadar is not scoring yet —{' '}
            {settingsError.error ?? 'the last run could not read its settings'}.{' '}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setTab('settings')}>
            Finish setup
          </button>
        </div>
      )}

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
    </div>
  );
}
