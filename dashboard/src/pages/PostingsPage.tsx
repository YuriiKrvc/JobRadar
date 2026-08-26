import { useDashboardData } from '../context/DashboardData';
import { Filters } from '../components/Filters';
import { PostingsTable } from '../components/PostingsTable';
import { SourceHealth } from '../components/SourceHealth';

export function PostingsPage() {
  const { postings, health, settings } = useDashboardData();

  return (
    <>
      <Filters rows={postings.data ?? []} />

      {postings.loading && <p className="state">Loading…</p>}
      {postings.error && <p className="state" role="alert">Error: {postings.error}</p>}
      {!postings.loading && !postings.error && (
        <PostingsTable
          rows={postings.data ?? []}
          currentVersion={settings.data?.version ?? null}
        />
      )}

      <SourceHealth rows={health.data ?? []} />
    </>
  );
}
