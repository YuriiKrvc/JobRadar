import { useMemo } from 'react';
import { useDashboardData } from '../context/DashboardData';
import { DEFAULT_FILTERS } from '../api/filters-url';
import { isHardFiltered } from '../postings/derive';
import { Filters } from '../components/postings/Filters';
import { PostingsFeed } from '../components/postings/PostingsFeed';
import { EmptyState } from '../components/postings/EmptyState';
import { RejectedStrip } from '../components/postings/RejectedStrip';
import { SourceHealth } from '../components/SourceHealth';
import s from './PostingsPage.module.css';

export function PostingsPage() {
  const { postings, health, settings, ui, setUi } = useDashboardData();

  const rows = useMemo(() => postings.data ?? [], [postings.data]);
  const scoredCount = rows.filter((r) => !isHardFiltered(r)).length;
  const now = new Date();

  // Value comparison, not identity: parseFilters returns a fresh object every
  // time, so `ui === DEFAULT_FILTERS` would never be true.
  const filtersAreDefault = useMemo(
    () => JSON.stringify(ui) === JSON.stringify(DEFAULT_FILTERS), [ui],
  );

  const ready = !postings.loading && !postings.error;

  return (
    <section className={s.page}>
      <Filters rows={rows} resultCount={scoredCount} />

      {postings.loading && <p className={s.state}>Loading…</p>}
      {postings.error && <p className={s.state} role="alert">Error: {postings.error}</p>}

      {ready && scoredCount === 0 && (
        <EmptyState
          kind={rows.length === 0 && filtersAreDefault ? 'fresh' : 'filtered'}
          onClearFilters={() => setUi(DEFAULT_FILTERS)}
        />
      )}

      {ready && scoredCount > 0 && (
        <PostingsFeed
          rows={rows}
          currentVersion={settings.data?.version ?? null}
          weights={settings.data?.rubricWeights ?? null}
          now={now}
          descending={ui.sort === 'desc'}
        />
      )}

      {ready && (
        <RejectedStrip
          rows={rows.filter(isHardFiltered)}
          currentVersion={settings.data?.version ?? null}
          now={now}
        />
      )}

      <SourceHealth rows={health.data ?? []} />
    </section>
  );
}
