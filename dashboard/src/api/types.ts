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
}

export interface SettingsResponse {
  cv: string;
  rubricBody: string;
  rubricWeights: RubricWeights;
  profile: ProfileInput;
  version: number;
  updatedAt: string;
}

export type SourceKind = 'ats' | 'djinni' | 'dou';

export interface SourceRow {
  id: string;
  kind: SourceKind;
  board: string | null;
  slug: string | null;
  url: string | null;
  enabled: boolean;
  createdAt: string;
}

export type SourceInput =
  | { kind: 'ats'; board: 'greenhouse' | 'lever' | 'ashby'; slug: string }
  | { kind: 'djinni'; url: string }
  | { kind: 'dou'; url: string };
