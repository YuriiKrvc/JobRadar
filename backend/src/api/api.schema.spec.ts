import { PostingRowSchema, SubScoresSchema } from './api.schema';

const dimension = { score: 70, note: 'nine years on the stack' };
const subscores = {
  coreStack: dimension, seniority: dimension, domain: dimension,
  logistics: dimension, growth: dimension,
};

const row = {
  postingId: 'djinni:1', title: 'Senior Node Engineer', company: 'Acme',
  url: 'https://e.com/1', source: 'djinni', location: 'Remote',
  total: 82, verdict: 'STRONG', reasoning: 'stack matches',
  providerId: 'anthropic', settingsVersion: '3',
  scoredAt: '2026-08-25T10:00:00.000Z', subscores,
};

describe('PostingRowSchema', () => {
  it('accepts a row carrying all five sub-score dimensions', () => {
    expect(PostingRowSchema.parse(row).subscores.coreStack.score).toBe(70);
  });

  it('rejects a row missing a dimension', () => {
    const { growth, ...four } = subscores;
    expect(() => PostingRowSchema.parse({ ...row, subscores: four })).toThrow();
  });

  it('rejects a dimension without a note', () => {
    const broken = { ...subscores, domain: { score: 40 } };
    expect(() => PostingRowSchema.parse({ ...row, subscores: broken })).toThrow();
  });

  it('accepts the zeroed sub-scores a hard-filtered row carries', () => {
    const zero = { score: 0, note: 'hard filter' };
    const zeroed = {
      coreStack: zero, seniority: zero, domain: zero, logistics: zero, growth: zero,
    };
    expect(SubScoresSchema.parse(zeroed).logistics.note).toBe('hard filter');
  });
});
