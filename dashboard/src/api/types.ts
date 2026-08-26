export type Verdict = 'STRONG' | 'MAYBE' | 'NO';

export interface PostingRow {
  postingId: string;
  title: string;
  company: string;
  url: string;
  source: string;
  location: string | null;
  total: number;
  verdict: Verdict;
  reasoning: string;
  providerId: string;
  scoredAt: string;
  settingsVersion: string;
}

export interface HealthRow {
  source: string;
  status: string;
  ranAt: string;
  error: string | null;
}

export interface PostingFilters {
  verdict?: Verdict | '';
  source?: string;
  provider?: string;
  minTotal?: number;
  /** ISO date (yyyy-mm-dd) from the date input; the API coerces it. */
  since?: string;
  limit?: number;
}

export interface RubricWeights {
  coreStack: number;
  seniority: number;
  domain: number;
  logistics: number;
  growth: number;
}

export interface ProfileInput {
  excludedLocations: string[];
  allowedEmploymentTypes: string[];
  minSalaryUsd: number | null;
  timezone: string;
  blockedTitleWords: string[];
  blockedDescriptionWords: string[];
}

export interface SettingsResponse {
  cv: string;
  rubricBody: string;
  rubricWeights: RubricWeights;
  profile: ProfileInput;
  version: number;
  updatedAt: string;
}

export interface Selectors {
  item: string;
  link: string;
  title?: string;
  company?: string;
  location?: string;
  employmentType?: string;
  description?: string;
  detail?: string;
}

export interface SourceRow {
  id: string;
  name: string;
  url: string;
  selectors: Selectors;
  blockedTitleWords: string[];
  blockedDescriptionWords: string[];
  enabled: boolean;
  createdAt: string;
}

export type SourceInput = Omit<SourceRow, 'id' | 'enabled' | 'createdAt'>;
