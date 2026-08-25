import { useState } from 'react';
import { fetchHealth, fetchPostings } from './api/client';
import { useApi } from './hooks/useApi';
import { Filters } from './components/Filters';
import { PostingsTable } from './components/PostingsTable';
import { SourceHealth } from './components/SourceHealth';
import type { PostingFilters } from './api/types';

export function App() {
  const [filters, setFilters] = useState<PostingFilters>({});

  const postings = useApi(() => fetchPostings(filters), [filters]);
  const health = useApi(() => fetchHealth());

  return (
    <>
      <h1>JobRadar</h1>

      <Filters value={filters} onChange={setFilters} rows={postings.data ?? []} />

      {postings.loading && <p className="state">Loading…</p>}
      {postings.error && <p className="state" role="alert">Error: {postings.error}</p>}
      {!postings.loading && !postings.error && <PostingsTable rows={postings.data ?? []} />}

      <SourceHealth rows={health.data ?? []} />
    </>
  );
}
