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
