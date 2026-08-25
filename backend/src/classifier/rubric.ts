import type { SubScores, Verdict } from '../types';

export const WEIGHTS = {
  coreStack: 35,
  seniority: 20,
  domain: 15,
  logistics: 20,
  growth: 10,
} as const satisfies Record<keyof SubScores, number>;

export function weightedTotal(s: SubScores): number {
  let acc = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof SubScores)[]) {
    acc += s[key].score * WEIGHTS[key];
  }
  return Math.round(acc / 100);
}

export function toVerdict(total: number): Verdict {
  if (total >= 75) return 'STRONG';
  if (total >= 50) return 'MAYBE';
  return 'NO';
}
