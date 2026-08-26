import type { RubricWeights } from '../settings/schema';
import type { SubScores, Verdict } from '../types';

export const DEFAULT_WEIGHTS: RubricWeights = {
  coreStack: 35,
  seniority: 20,
  domain: 15,
  logistics: 20,
  growth: 10,
};

export function weightedTotal(s: SubScores, w: RubricWeights): number {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const key of Object.keys(w) as (keyof SubScores)[]) {
    acc += s[key].score * w[key];
  }
  // Dividing by the actual sum rather than 100 is what lets a weight be raised
  // without rebalancing the other four. sum > 0 is guaranteed by
  // RubricWeightsSchema: `.strict()` with all five keys required and a refine
  // for at least one above zero. The app_settings_weights_nonzero CHECK is a
  // backstop only — a weights object missing a key makes it evaluate to NULL,
  // which Postgres accepts.
  return Math.round(acc / sum);
}

export function toVerdict(total: number): Verdict {
  if (total >= 75) return 'STRONG';
  if (total >= 50) return 'MAYBE';
  return 'NO';
}
