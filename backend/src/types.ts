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
