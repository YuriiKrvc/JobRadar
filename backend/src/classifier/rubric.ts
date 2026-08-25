import type { RubricWeights } from '../settings/schema';
import type { SubScores, Verdict } from '../types';

export const DEFAULT_WEIGHTS: RubricWeights = {
  coreStack: 35,
  seniority: 20,
  domain: 15,
  logistics: 20,
  growth: 10,
};

export function weightedTotal(s: SubScores): number {
  let acc = 0;
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof SubScores)[]) {
    acc += s[key].score * DEFAULT_WEIGHTS[key];
  }
  return Math.round(acc / 100);
}

export function toVerdict(total: number): Verdict {
  if (total >= 75) return 'STRONG';
  if (total >= 50) return 'MAYBE';
  return 'NO';
}
