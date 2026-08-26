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
  const valid = {
    name: 'Acme',
    url: 'https://acme.com/careers',
    selectors: { item: 'li.job', link: 'a' },
  };

  it('defaults both blocklists to empty', () => {
    expect(SourceInputSchema.parse(valid)).toEqual({
      ...valid, blockedTitleWords: [], blockedDescriptionWords: [],
    });
  });

  it('keeps the blocklists it is given', () => {
    const input = { ...valid, blockedTitleWords: ['intern'], blockedDescriptionWords: ['onsite'] };
    expect(SourceInputSchema.parse(input)).toEqual(input);
  });

  it('rejects an empty name', () => {
    expect(() => SourceInputSchema.parse({ ...valid, name: '' })).toThrow();
  });

  it('rejects a url that is not a url', () => {
    expect(() => SourceInputSchema.parse({ ...valid, url: 'not-a-url' })).toThrow();
  });

  it('rejects selectors missing item or link', () => {
    expect(() => SourceInputSchema.parse({ ...valid, selectors: { item: 'li' } })).toThrow();
  });

  // The old shape carried a kind discriminator; a client still sending it must
  // fail loudly rather than silently storing a source with no selectors.
  it('rejects an unknown key such as the old kind discriminator', () => {
    expect(() => SourceInputSchema.parse({ ...valid, kind: 'ats' })).toThrow();
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
