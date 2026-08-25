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
