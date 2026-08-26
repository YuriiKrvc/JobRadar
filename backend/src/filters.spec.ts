import { applyHardFilters, matchBlockedWord, applyTitleFilter } from './filters';
import type { RawPosting } from './types';
import type { Profile } from './settings/schema';

const profile: Profile = {
  excludedLocations: ['onsite: usa'],
  allowedEmploymentTypes: ['full-time'],
  minSalaryUsd: 4000,
  timezone: 'Europe/Kyiv',
  blockedTitleWords: [],
  blockedDescriptionWords: [],
};

function posting(over: Partial<RawPosting> = {}): RawPosting {
  return {
    id: 'x:1', source: 'x', externalId: '1', url: 'https://e.com/1',
    title: 'Node Engineer', company: 'Acme', location: 'Remote - Europe',
    employmentType: 'full-time', description: 'Salary $6000/mo', raw: {}, ...over,
  };
}

describe('applyHardFilters', () => {
  it('passes a posting that satisfies every constraint', () => {
    expect(applyHardFilters(posting(), profile, [])).toEqual({ passed: true });
  });

  it('rejects an excluded location, case-insensitively', () => {
    expect(applyHardFilters(posting({ location: 'Onsite: USA' }), profile, []))
      .toEqual({ passed: false, rule: 'location' });
  });

  it('rejects a disallowed employment type', () => {
    expect(applyHardFilters(posting({ employmentType: 'internship' }), profile, []))
      .toEqual({ passed: false, rule: 'employment-type' });
  });

  it('rejects a stated salary below the floor', () => {
    expect(applyHardFilters(posting({ description: 'We offer $2500 per month' }), profile, []))
      .toEqual({ passed: false, rule: 'salary' });
  });

  it('passes when no salary is stated at all', () => {
    expect(applyHardFilters(posting({ description: 'Great team, no numbers here' }), profile, []))
      .toEqual({ passed: true });
  });

  it('passes an unknown employment type when the profile lists none', () => {
    const open: Profile = { ...profile, allowedEmploymentTypes: [] };
    expect(applyHardFilters(posting({ employmentType: 'internship' }), open, []))
      .toEqual({ passed: true });
  });
});

describe('matchBlockedWord', () => {
  it('matches a whole word regardless of case', () => {
    expect(matchBlockedWord('Senior PHP Developer', ['php'])).toBe('php');
  });

  it('does not match a word embedded in a longer word', () => {
    expect(matchBlockedWord('phpstorm plugin author', ['php'])).toBeNull();
    expect(matchBlockedWord('Google Cloud engineer', ['go'])).toBeNull();
  });

  it('matches a multi-word phrase', () => {
    expect(matchBlockedWord('Relocation required to Berlin', ['relocation required']))
      .toBe('relocation required');
  });

  it('treats regex metacharacters in an entry as literals', () => {
    expect(matchBlockedWord('C++ systems role', ['c++'])).toBe('c++');
    expect(matchBlockedWord('c-plus-plus', ['c++'])).toBeNull();
  });

  // An entry that does not start with a letter or digit gets no leading
  // boundary, or `.net` could never match `ASP.NET` — the character before the
  // dot is a letter.
  it('matches an entry that begins with punctuation', () => {
    expect(matchBlockedWord('ASP.NET Core developer', ['.net'])).toBe('.net');
  });

  it('returns the first matching entry and ignores blanks', () => {
    expect(matchBlockedWord('Node and PHP', ['  ', 'php', 'node'])).toBe('php');
  });

  it('returns null for an empty list', () => {
    expect(matchBlockedWord('anything', [])).toBeNull();
  });
});

describe('applyTitleFilter', () => {
  const p = {
    id: 'x', source: 's', externalId: 'x', url: 'https://e.com/x',
    title: 'Senior PHP Developer', company: 'C', location: 'Remote',
    employmentType: 'full-time', description: 'body text', raw: {},
  };

  it('rejects a blocked title and names the word in the rule', () => {
    expect(applyTitleFilter(p, ['php'])).toEqual({ passed: false, rule: 'title-word:php' });
  });

  it('passes a title with no blocked word', () => {
    expect(applyTitleFilter(p, ['ruby'])).toEqual({ passed: true });
  });

  it('ignores words that appear only outside the title', () => {
    expect(applyTitleFilter(p, ['body'])).toEqual({ passed: true });
  });
});

describe('applyHardFilters description words', () => {
  const profile = {
    excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: null,
    timezone: 'Europe/Kyiv', blockedTitleWords: [], blockedDescriptionWords: [],
  };
  const p = {
    id: 'x', source: 's', externalId: 'x', url: 'https://e.com/x',
    title: 'Node Developer', company: 'C', location: 'Remote',
    employmentType: 'full-time', description: 'Relocation required to Berlin.', raw: {},
  };

  it('rejects a blocked description word and names it', () => {
    expect(applyHardFilters(p, profile, ['relocation required']))
      .toEqual({ passed: false, rule: 'description-word:relocation required' });
  });

  it('passes when no description word matches', () => {
    expect(applyHardFilters(p, profile, ['php'])).toEqual({ passed: true });
  });

  it('reports the location rule ahead of a description word', () => {
    const onsite = { ...p, location: 'Onsite: USA' };
    const strict = { ...profile, excludedLocations: ['onsite: usa'] };
    expect(applyHardFilters(onsite, strict, ['relocation required']))
      .toEqual({ passed: false, rule: 'location' });
  });
});
