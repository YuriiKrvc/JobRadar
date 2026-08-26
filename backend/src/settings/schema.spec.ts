import { ProfileSchema, ProfileBodySchema, RubricWeightsSchema, SourceInputSchema, SelectorsSchema } from './schema';

describe('ProfileSchema', () => {
  it('defaults the blocked-word lists for a profile written before they existed', () => {
    const parsed = ProfileSchema.parse({
      excludedLocations: [], allowedEmploymentTypes: [],
      minSalaryUsd: null, timezone: 'Europe/Kyiv',
    });
    expect(parsed.blockedTitleWords).toEqual([]);
    expect(parsed.blockedDescriptionWords).toEqual([]);
  });

  it('requires both blocked-word lists on the wire', () => {
    const body = {
      excludedLocations: [], allowedEmploymentTypes: [],
      minSalaryUsd: null, timezone: 'Europe/Kyiv',
    };
    expect(ProfileBodySchema.safeParse(body).success).toBe(false);
    expect(ProfileBodySchema.safeParse({
      ...body, blockedTitleWords: ['php'], blockedDescriptionWords: [],
    }).success).toBe(true);
  });
});

describe('RubricWeightsSchema', () => {
  const valid = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };

  it('accepts the shipped defaults', () => {
    expect(RubricWeightsSchema.parse(valid)).toEqual(valid);
  });

  it('accepts weights that do not sum to 100', () => {
    const w = { ...valid, coreStack: 70 };
    expect(RubricWeightsSchema.parse(w).coreStack).toBe(70);
  });

  it('rejects all-zero weights, which would divide by zero', () => {
    const zeroed = { coreStack: 0, seniority: 0, domain: 0, logistics: 0, growth: 0 };
    expect(() => RubricWeightsSchema.parse(zeroed)).toThrow(/above zero/);
  });

  it('rejects a negative weight', () => {
    expect(() => RubricWeightsSchema.parse({ ...valid, growth: -1 })).toThrow();
  });

  it('rejects a missing dimension', () => {
    const { growth, ...missing } = valid;
    expect(() => RubricWeightsSchema.parse(missing)).toThrow();
  });
});

describe('SourceInputSchema', () => {
  it('accepts an ats source with board and slug', () => {
    const input = { kind: 'ats', board: 'greenhouse', slug: 'acme' };
    expect(SourceInputSchema.parse(input)).toEqual(input);
  });

  it('accepts a djinni source with a url', () => {
    const input = { kind: 'djinni', url: 'https://djinni.co/jobs/keyword-node/' };
    expect(SourceInputSchema.parse(input)).toEqual(input);
  });

  it('rejects a djinni source carrying a slug', () => {
    expect(() => SourceInputSchema.parse({
      kind: 'djinni', url: 'https://djinni.co/jobs/', slug: 'acme',
    })).toThrow();
  });

  it('rejects an ats source with no slug', () => {
    expect(() => SourceInputSchema.parse({ kind: 'ats', board: 'greenhouse' })).toThrow();
  });

  it('rejects an unknown board', () => {
    expect(() => SourceInputSchema.parse({
      kind: 'ats', board: 'workday', slug: 'acme',
    })).toThrow();
  });

  it('rejects a url that is not a url', () => {
    expect(() => SourceInputSchema.parse({ kind: 'dou', url: 'not-a-url' })).toThrow();
  });
});

describe('SelectorsSchema', () => {
  it('requires item and link', () => {
    expect(SelectorsSchema.safeParse({ item: 'li' }).success).toBe(false);
    expect(SelectorsSchema.safeParse({ item: 'li', link: 'a' }).success).toBe(true);
  });

  it('rejects empty selector strings', () => {
    expect(SelectorsSchema.safeParse({ item: '', link: 'a' }).success).toBe(false);
  });

  it('rejects unknown keys so a typo is not silently ignored', () => {
    expect(SelectorsSchema.safeParse({ item: 'li', link: 'a', titel: 'h2' }).success).toBe(false);
  });
});
