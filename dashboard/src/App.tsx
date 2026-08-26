import { useCallback, useMemo } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { fetchHealth, fetchPostings } from './api/client';
import { fetchSettings } from './api/settings';
import { useApi } from './hooks/useApi';
import { parseFilters, toApiFilters, toSearchParams, type UiFilters } from './api/filters-url';
import { groupByDay } from './postings/derive';
import { DashboardDataProvider } from './context/DashboardData';
import { Masthead } from './components/Masthead';
import { SetupBanner } from './components/SetupBanner';
import { PostingsPage } from './pages/PostingsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const [params, setParams] = useSearchParams();

  const ui = useMemo(() => parseFilters(params), [params]);
  const setUi = useCallback(
    (next: UiFilters) => setParams(toSearchParams(next)),
    [setParams],
  );

  // The query string is the single source of truth, so the fetch key is its
  // serialised form — a fresh object identity each render would otherwise
  // retrigger the effect forever.
  const apiFilters = useMemo(() => toApiFilters(ui, new Date()), [ui]);
  const fetchKey = useMemo(() => JSON.stringify(apiFilters), [apiFilters]);

  const postings = useApi(() => fetchPostings(apiFilters), [fetchKey]);
  const health = useApi(() => fetchHealth());
  // Owned here, not in SettingsPage: the stale-score badge on Postings needs
  // the current version, so a save in Settings has to be visible without a
  // reload. Keeping all three here also means switching routes never refetches.
  const settings = useApi(() => fetchSettings());

  // Any `settings` error row, not just "settings incomplete": a settings READ
  // failure (unseeded or degraded database) also logs here, and it is the case
  // where the user has the least other evidence of what is wrong.
  const settingsError = (health.data ?? []).find(
    (h) => h.source === 'settings' && h.status === 'error',
  );

  // Derived from the SAME day bucket the feed uses, so the masthead's "N new"
  // and the Today divider's count cannot disagree.
  const newCount = useMemo(() => {
    const groups = groupByDay(postings.data ?? [], new Date(), true);
    return groups[0]?.label === 'Today' ? groups[0].rows.length : 0;
  }, [postings.data]);

  return (
    <DashboardDataProvider value={{ postings, health, settings, ui, setUi }}>
      <Masthead
        runAt={health.data?.[0]?.ranAt ?? null}
        newCount={newCount}
        scoredCount={postings.data?.length ?? 0}
        version={settings.data?.version ?? null}
      />

      {settingsError && (
        <SetupBanner message={settingsError.error ?? 'the last run could not read its settings'} />
      )}

      <Routes>
        <Route path="/" element={<PostingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DashboardDataProvider>
  );
}
