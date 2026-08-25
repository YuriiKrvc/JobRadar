import { WEIGHTS, weightedTotal, toVerdict } from './rubric';
import type { SubScores } from '../types';

function subs(v: Partial<Record<keyof SubScores, number>> = {}): SubScores {
  const d = (score: number) => ({ score, note: 'n' });
  return {
    coreStack: d(v.coreStack ?? 0),
    seniority: d(v.seniority ?? 0),
    domain: d(v.domain ?? 0),
    logistics: d(v.logistics ?? 0),
    growth: d(v.growth ?? 0),
  };
}

describe('rubric', () => {
  it('weights sum to 100', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('returns 100 when every dimension is perfect', () => {
    expect(weightedTotal(subs({ coreStack: 100, seniority: 100, domain: 100, logistics: 100, growth: 100 }))).toBe(100);
  });

  it('returns 0 when every dimension is zero', () => {
    expect(weightedTotal(subs())).toBe(0);
  });

  it('weights coreStack most heavily', () => {
    expect(weightedTotal(subs({ coreStack: 100 }))).toBe(35);
    expect(weightedTotal(subs({ growth: 100 }))).toBe(10);
  });

  it('rounds to the nearest integer', () => {
    expect(Number.isInteger(weightedTotal(subs({ coreStack: 33, seniority: 47 })))).toBe(true);
  });

  it('bands verdicts at 75 and 50 inclusive', () => {
    expect(toVerdict(100)).toBe('STRONG');
    expect(toVerdict(75)).toBe('STRONG');
    expect(toVerdict(74)).toBe('MAYBE');
    expect(toVerdict(50)).toBe('MAYBE');
    expect(toVerdict(49)).toBe('NO');
    expect(toVerdict(0)).toBe('NO');
  });
});
