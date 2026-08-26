export type Verdict = 'STRONG' | 'MAYBE' | 'NO';

export interface Dimension {
  score: number;
  note: string;
}

export interface SubScores {
  coreStack: Dimension;
  seniority: Dimension;
  domain: Dimension;
  logistics: Dimension;
  growth: Dimension;
}

export interface RawPosting {
  id: string;
  source: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  employmentType: string | null;
  description: string;
  raw: unknown;
}

export interface JobSource {
  readonly id: string;
  listPostings(): Promise<RawPosting[]>;
  /**
   * Fetch the posting's own page and fill in its description. Optional because
   * only the selector-driven adapter needs it; the pipeline calls it after the
   * dedup gate, so each posting costs exactly one detail request, once.
   */
  hydrate?(posting: RawPosting): Promise<RawPosting>;
}

export type FetchFn = (url: string) => Promise<Response>;

export interface FitVerdict {
  total: number;
  verdict: Verdict;
  subscores: SubScores;
  reasoning: string;
  providerId: string;
  settingsVersion: string;
}
