import { RubricWeightsSchema } from '../settings/schema';
import { DEFAULT_WEIGHTS, weightedTotal, toVerdict } from './rubric';
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
  // Not "they sum to 100": weightedTotal normalises by the actual sum, so that
  // is an incidental property of the shipped defaults and rebalancing them
  // would fail the assertion for no reason. What is load-bearing is that the
  // defaults are a valid RubricWeights value — five keys, no extras, in range,
  // at least one above zero — since they are inserted straight into
  // app_settings by the seeder without passing through the HTTP boundary.
  it('ships defaults that satisfy RubricWeightsSchema', () => {
    expect(() => RubricWeightsSchema.parse(DEFAULT_WEIGHTS)).not.toThrow();
  });

  it('returns 100 when every dimension is perfect', () => {
    expect(weightedTotal(subs({ coreStack: 100, seniority: 100, domain: 100, logistics: 100, growth: 100 }), DEFAULT_WEIGHTS)).toBe(100);
  });

  it('returns 0 when every dimension is zero', () => {
    expect(weightedTotal(subs(), DEFAULT_WEIGHTS)).toBe(0);
  });

  it('weights coreStack most heavily', () => {
    expect(weightedTotal(subs({ coreStack: 100 }), DEFAULT_WEIGHTS)).toBe(35);
    expect(weightedTotal(subs({ growth: 100 }), DEFAULT_WEIGHTS)).toBe(10);
  });

  it('rounds to the nearest integer', () => {
    expect(Number.isInteger(weightedTotal(subs({ coreStack: 33, seniority: 47 }), DEFAULT_WEIGHTS))).toBe(true);
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

const subs2 = (n: number) => ({
  coreStack: { score: n, note: '' }, seniority: { score: n, note: '' },
  domain: { score: n, note: '' }, logistics: { score: n, note: '' },
  growth: { score: n, note: '' },
});

describe('weightedTotal with custom weights', () => {
  it('normalises by the actual sum, not by 100', () => {
    const doubled = {
      coreStack: 70, seniority: 40, domain: 30, logistics: 40, growth: 20,
    };
    const s = {
      coreStack: { score: 90, note: '' }, seniority: { score: 80, note: '' },
      domain: { score: 60, note: '' }, logistics: { score: 100, note: '' },
      growth: { score: 70, note: '' },
    };
    // Proportional weights are the same rubric.
    expect(weightedTotal(s, doubled)).toBe(weightedTotal(s, DEFAULT_WEIGHTS));
  });

  it('honours a reweighting that does not sum to 100', () => {
    const s = {
      coreStack: { score: 100, note: '' }, seniority: { score: 0, note: '' },
      domain: { score: 0, note: '' }, logistics: { score: 0, note: '' },
      growth: { score: 0, note: '' },
    };
    const coreOnly = {
      coreStack: 10, seniority: 0, domain: 0, logistics: 0, growth: 0,
    };
    expect(weightedTotal(s, coreOnly)).toBe(100);
  });

  it('keeps every total inside 0-100 so the verdict bands still apply', () => {
    const lopsided = {
      coreStack: 500, seniority: 1, domain: 1, logistics: 1, growth: 1,
    };
    const t = weightedTotal(subs2(100), lopsided);
    expect(t).toBeLessThanOrEqual(100);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(toVerdict(t)).toBe('STRONG');
  });
});
