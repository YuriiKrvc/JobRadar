import { useCallback, useMemo } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { fetchHealth, fetchPostings } from './api/client';
import { fetchSettings } from './api/settings';
import { useApi } from './hooks/useApi';
import { parseFilters, toApiFilters, toSearchParams, type UiFilters } from './api/filters-url';
import { DashboardDataProvider } from './context/DashboardData';
import { PostingsPage } from './pages/PostingsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const onSettings = pathname.startsWith('/settings');

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

  return (
    <DashboardDataProvider value={{ postings, health, settings, ui, setUi }}>
      <h1>JobRadar</h1>

      {settingsError && (
        <p className="banner" role="status">
          JobRadar is not scoring yet —{' '}
          {settingsError.error ?? 'the last run could not read its settings'}.{' '}
          <NavLink to="/settings">Finish setup</NavLink>
        </p>
      )}

      <nav className="tabs" role="tablist">
        <NavLink
          to="/" end role="tab" aria-selected={!onSettings}
          className={({ isActive }) => (isActive ? 'tab tab-active' : 'tab')}
        >
          Postings
        </NavLink>
        <NavLink
          to="/settings" role="tab" aria-selected={onSettings}
          className={({ isActive }) => (isActive ? 'tab tab-active' : 'tab')}
        >
          Settings
        </NavLink>
      </nav>

      <Routes>
        <Route path="/" element={<PostingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DashboardDataProvider>
  );
}
