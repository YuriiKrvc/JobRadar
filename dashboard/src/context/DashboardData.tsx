import { createContext, useContext, type ReactNode } from 'react';
import type { ApiState } from '../hooks/useApi';
import type { HealthRow, PostingRow, SettingsResponse } from '../api/types';
import type { UiFilters } from '../api/filters-url';

export interface DashboardData {
  postings: ApiState<PostingRow[]>;
  health: ApiState<HealthRow[]>;
  settings: ApiState<SettingsResponse>;
  ui: UiFilters;
  setUi: (next: UiFilters) => void;
}

const Context = createContext<DashboardData | null>(null);

export function DashboardDataProvider(
  { value, children }: { value: DashboardData; children: ReactNode },
) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * A context rather than <Outlet context> so a component test can wrap one
 * component in a provider instead of standing up a whole router.
 */
export function useDashboardData(): DashboardData {
  const value = useContext(Context);
  if (!value) throw new Error('useDashboardData used outside DashboardDataProvider');
  return value;
}
